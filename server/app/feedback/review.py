"""Blind human evaluation of the feedback: the LLM report against the template report.

A review set picks sessions, writes both versions of each report from the same facts, shuffles
them and gives each an anonymous code. Raters see one report at a time with the facts and a
rubric; they never see which version it is. Results compare the versions per dimension, with
the share judged unsafe and the agreement between raters (weighted Cohen's kappa).
See docs/llm-evaluation.md (research question RQ5).
"""

import csv
import io
import random
import secrets
import statistics
from collections import defaultdict
from collections.abc import Sequence
from itertools import combinations
from typing import Any, Literal, cast

from sqlmodel import Session, col, select

from app.feedback import prompt
from app.feedback.fallback import build_fallback
from app.feedback.names import FeedbackLanguage
from app.feedback.rules import candidates, notice_texts, red_flags
from app.models import LlmReport, PatientProfile, ReportRating, ReviewItem, ReviewSet
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.feedback_report import patient_view
from app.services.session_facts import build_facts

DIMENSIONS = ("accuracy", "safety", "helpfulness", "clarity", "tone")
VERSIONS = ("llm", "template")
#: Letters and digits that cannot be confused with each other, read aloud or on screen.
CODE_ALPHABET = "ACDEFHJKMNPRTUVWXY34679"
CODE_LENGTH = 5
#: The ratings' scale for the kappa.
SCALE = (1, 2, 3, 4, 5)

Weights = Literal["quadratic", "linear", "none"]


class NoSessionsError(Exception):
    pass


class SetNotReadyError(Exception):
    pass


# Creating a set


def new_code(rng: random.Random, used: set[str]) -> str:
    """A random code, unique in the set. Random by design: nothing about the version or the
    session can be read from it."""
    while True:
        code = "".join(rng.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in used:
            used.add(code)
            return code


def choose_sessions(db: Session, size: int, rng: random.Random) -> list[SessionRecord]:
    """Up to `size` completed sessions, half from real patients and half from demo patients
    when both exist (the rest from whichever has more)."""
    rows = db.exec(
        select(SessionRecord, PatientProfile)
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        .where(SessionRecord.status == "completed")
        .order_by(col(SessionRecord.id))
    ).all()
    real = [record for record, profile in rows if not profile.is_demo]
    demo = [record for record, profile in rows if profile.is_demo]
    rng.shuffle(real)
    rng.shuffle(demo)
    take_real = min(len(real), max(size // 2, size - len(demo)))
    chosen = real[:take_real] + demo[: size - take_real]
    return sorted(chosen, key=lambda record: record.id or 0)


def create_review_set(
    db: Session,
    size: int,
    language: FeedbackLanguage,
    created_by: int,
    name: str | None = None,
    seed: int | None = None,
) -> tuple[ReviewSet, list[int]]:
    """The set, and the LLM report jobs to queue. The template versions are written now."""
    seed = secrets.randbelow(2**31) if seed is None else seed
    rng = random.Random(seed)
    sessions = choose_sessions(db, size, rng)
    if not sessions:
        raise NoSessionsError
    review = ReviewSet(
        name=name or f"Review {utc_now():%Y-%m-%d %H:%M}",
        language=language,
        sessions=len(sessions),
        seed=seed,
        created_by=created_by,
    )
    db.add(review)
    db.flush()
    assert review.id is not None

    pairs: list[tuple[SessionRecord, str, LlmReport]] = []
    for record in sessions:
        facts = build_facts(db, record)
        snapshot = facts.model_dump(mode="json")
        seen = prompt.facts_seen(facts)
        found = candidates(facts)
        flags = red_flags(facts, language)
        template = LlmReport(
            session_id=record.id or 0,
            language=language,
            status="fallback",
            superseded=True,
            review_set_id=review.id,
            report=build_fallback(facts, seen, found, flags, language).model_dump(),
            safety_notices=notice_texts(flags),
            facts=snapshot,
            candidates=[candidate.as_dict() for candidate in found],
            fallback_used=True,
            strategy="template",
            finished_at=utc_now(),
        )
        model = LlmReport(
            session_id=record.id or 0,
            language=language,
            status="queued",
            superseded=True,
            review_set_id=review.id,
            facts=snapshot,
        )
        db.add(template)
        db.add(model)
        pairs += [(record, "template", template), (record, "llm", model)]
    db.flush()

    rng.shuffle(pairs)
    used: set[str] = set()
    for position, (record, version, report) in enumerate(pairs, start=1):
        assert report.id is not None and record.id is not None
        db.add(
            ReviewItem(
                review_set_id=review.id,
                code=new_code(rng, used),
                position=position,
                session_id=record.id,
                version=version,
                report_id=report.id,
            )
        )
    db.commit()
    db.refresh(review)
    jobs = [report.id for _, version, report in pairs if version == "llm" and report.id is not None]
    return review, jobs


# Reading a set


def items_with_reports(db: Session, review_id: int) -> list[tuple[ReviewItem, LlmReport]]:
    rows = db.exec(
        select(ReviewItem, LlmReport)
        .join(LlmReport, col(LlmReport.id) == col(ReviewItem.report_id))
        .where(ReviewItem.review_set_id == review_id)
        .order_by(col(ReviewItem.position))
    ).all()
    return [(item, report) for item, report in rows]


def is_ready(report: LlmReport) -> bool:
    return report.status in ("done", "fallback")


def set_status(items: Sequence[tuple[ReviewItem, LlmReport]]) -> str:
    """"building" while any report is still being written; then "ready"."""
    waiting = any(report.status in ("queued", "running") for _, report in items)
    return "building" if waiting else "ready"


def rated_codes(db: Session, review_id: int, user_id: int) -> set[str]:
    rows = db.exec(
        select(ReviewItem.code)
        .join(ReportRating, col(ReportRating.report_id) == col(ReviewItem.report_id))
        .where(
            ReviewItem.review_set_id == review_id,
            ReportRating.review_set_id == review_id,
            ReportRating.rater_user_id == user_id,
        )
    ).all()
    return set(rows)


def blind_facts(facts: dict[str, Any] | None) -> dict[str, Any]:
    """The facts sheet for raters: everything the report may say, without the patient's code
    or the session's id."""
    sheet = dict(facts or {})
    for name in ("session_id", "patient_code"):
        sheet.pop(name, None)
    return sheet


def blind_report(report: LlmReport) -> dict[str, Any] | None:
    """What a rater sees of a report: the patient's text only. No model, prompt, timings,
    strategy, or anything else that could tell the version."""
    return patient_view(report.report)


# Results


def weighted_kappa(
    first: Sequence[int],
    second: Sequence[int],
    categories: Sequence[int] = SCALE,
    weights: Weights = "quadratic",
) -> float | None:
    """Cohen's kappa between two raters' scores of the same items, with quadratic (default),
    linear or no weights. None when it is undefined (fewer than two items, or no possible
    disagreement because every score is the same category)."""
    if len(first) != len(second):
        raise ValueError("Both raters must score the same items")
    if len(first) < 2:
        return None
    index = {category: number for number, category in enumerate(categories)}
    k = len(categories)
    n = len(first)

    def weight(i: int, j: int) -> float:
        if weights == "none":
            return 0.0 if i == j else 1.0
        distance = abs(i - j) / (k - 1)
        return distance**2 if weights == "quadratic" else distance

    observed = [[0.0] * k for _ in range(k)]
    for a, b in zip(first, second, strict=True):
        observed[index[a]][index[b]] += 1
    rows = [sum(row) for row in observed]
    columns = [sum(observed[i][j] for i in range(k)) for j in range(k)]
    disagreement = sum(weight(i, j) * observed[i][j] for i in range(k) for j in range(k))
    expected = sum(weight(i, j) * rows[i] * columns[j] / n for i in range(k) for j in range(k))
    if expected == 0:
        return None
    return round(1 - disagreement / expected, 4)


def _ratings(db: Session, review_id: int) -> list[tuple[ReviewItem, LlmReport, ReportRating]]:
    rows = db.exec(
        select(ReviewItem, LlmReport, ReportRating)
        .join(LlmReport, col(LlmReport.id) == col(ReviewItem.report_id))
        .join(ReportRating, col(ReportRating.report_id) == col(ReviewItem.report_id))
        .where(ReviewItem.review_set_id == review_id, ReportRating.review_set_id == review_id)
        .order_by(col(ReviewItem.position), col(ReportRating.id))
    ).all()
    return [(item, report, rating) for item, report, rating in rows]


def _summary(rows: list[tuple[ReviewItem, LlmReport, ReportRating]]) -> dict[str, Any]:
    means: dict[str, float | None] = {}
    sds: dict[str, float | None] = {}
    for dimension in DIMENSIONS:
        values = [r.scores[dimension] for _, _, r in rows if dimension in r.scores]
        means[dimension] = round(statistics.fmean(values), 2) if values else None
        sds[dimension] = round(statistics.stdev(values), 2) if len(values) > 1 else None
    judged = [r.unsafe for _, _, r in rows if r.unsafe is not None]
    return {
        "items": len({item.id for item, _, _ in rows}),
        "ratings": len(rows),
        "means": means,
        "sds": sds,
        "unsafe_pct": round(100 * sum(judged) / len(judged), 1) if judged else None,
    }


def results(db: Session, review_id: int) -> dict[str, Any]:
    """Means per version and dimension, % unsafe, and weighted kappa for each pair of raters
    who rated the same items. "llm_model_written" leaves out LLM items where the model failed
    and the template was used instead."""
    rows = _ratings(db, review_id)
    items = items_with_reports(db, review_id)
    by_version = {
        version: _summary([row for row in rows if row[0].version == version]) for version in VERSIONS
    }
    by_version["llm_model_written"] = _summary(
        [row for row in rows if row[0].version == "llm" and not row[1].fallback_used]
    )

    scores: dict[int, dict[int, ReportRating]] = defaultdict(dict)
    raters: dict[int, str] = {}
    for item, _, rating in rows:
        assert item.id is not None
        scores[rating.rater_user_id][item.id] = rating
        raters[rating.rater_user_id] = rating.rater
    agreement = []
    for first, second in combinations(sorted(scores), 2):
        shared = sorted(set(scores[first]) & set(scores[second]))
        if len(shared) < 2:
            continue
        for dimension in DIMENSIONS:
            pairs = [
                (scores[first][i].scores.get(dimension), scores[second][i].scores.get(dimension))
                for i in shared
            ]
            a = [x for x, y in pairs if x is not None and y is not None]
            b = [y for x, y in pairs if x is not None and y is not None]
            agreement.append(
                {
                    "dimension": dimension,
                    "rater_a": first,
                    "rater_b": second,
                    "items": len(a),
                    "kappa": weighted_kappa(cast(list[int], a), cast(list[int], b)),
                }
            )
        unsafe = [
            (scores[first][i].unsafe, scores[second][i].unsafe)
            for i in shared
            if scores[first][i].unsafe is not None and scores[second][i].unsafe is not None
        ]
        agreement.append(
            {
                "dimension": "unsafe",
                "rater_a": first,
                "rater_b": second,
                "items": len(unsafe),
                "kappa": weighted_kappa(
                    [int(bool(a)) for a, _ in unsafe], [int(bool(b)) for _, b in unsafe], (0, 1), "none"
                ),
            }
        )
    return {
        "review_set_id": review_id,
        "status": set_status(items),
        "items": len(items),
        "llm_fallbacks": sum(
            1 for item, report in items if item.version == "llm" and report.fallback_used
        ),
        "versions": by_version,
        "raters": [
            {"user_id": user_id, "rater": raters[user_id], "ratings": len(scores[user_id])}
            for user_id in sorted(scores)
        ],
        "agreement": agreement,
    }


CSV_COLUMNS = [
    "review_set_id", "code", "position", "version", "model_written", "model", "session_id",
    "patient_code", "rater_user_id", "rater", *DIMENSIONS, "unsafe", "unsupported_text",
    "comment", "rated_at",
]  # fmt: skip


def export_csv(db: Session, review_id: int) -> str:
    """Every rating with its item's version, for analysis (patients by code only)."""
    rows = _ratings(db, review_id)
    codes = {
        record_id: code
        for record_id, code in db.exec(
            select(SessionRecord.id, PatientProfile.patient_code).join(
                PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id)
            )
        ).all()
    }
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for item, report, rating in rows:
        writer.writerow(
            {
                "review_set_id": review_id,
                "code": item.code,
                "position": item.position,
                "version": item.version,
                "model_written": item.version == "llm" and not report.fallback_used,
                "model": report.model or "",
                "session_id": item.session_id,
                "patient_code": codes.get(item.session_id, ""),
                "rater_user_id": rating.rater_user_id,
                "rater": rating.rater,
                **{dimension: rating.scores.get(dimension, "") for dimension in DIMENSIONS},
                "unsafe": "" if rating.unsafe is None else rating.unsafe,
                "unsupported_text": rating.unsupported_text or "",
                "comment": rating.comment or "",
                "rated_at": rating.created_at.isoformat(),
            }
        )
    return buffer.getvalue()
