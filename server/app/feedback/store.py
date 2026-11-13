"""Stored reports (LlmReport) and ratings: requesting, running, finishing and listing them."""

import time
from collections.abc import Sequence
from typing import cast

from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_
from sqlmodel import Session, col, func, select

from app.feedback.llm import LLMProvider
from app.feedback.names import FeedbackLanguage
from app.feedback.service import ReportResult, generate_report_from_facts
from app.models import LlmReport, PatientProfile, ReportRating
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.feedback_report import (
    FINISHED_STATUSES,
    AdminReportDetail,
    AdminReportItem,
    PatientReportItem,
    ReportMetaRead,
    ReportRead,
    ReportStatus,
    patient_view,
)
from app.schemas.common import Language
from app.schemas.metrics import SessionFacts
from app.services.session_facts import build_facts

IN_PROGRESS: tuple[ReportStatus, ...] = ("queued", "running")
PREVIEW_CHARS = 140


class RatingNotAllowedError(Exception):
    pass


class DuplicateRatingError(Exception):
    pass


class ReportNotFinishedError(Exception):
    pass


# Requesting


def current(db: Session, session_id: int, language: str) -> LlmReport | None:
    """The session's current (not superseded) report in this language."""
    return db.exec(
        select(LlmReport)
        .where(
            LlmReport.session_id == session_id,
            LlmReport.language == language,
            col(LlmReport.superseded).is_(False),
        )
        .order_by(col(LlmReport.id).desc())
    ).first()


def request_report(
    db: Session, session_id: int, language: str, regenerate: bool = False
) -> tuple[LlmReport, bool]:
    """The report to show or wait for, and whether a new job was created.

    A finished report is reused unless `regenerate`; a report being written is always reused
    (never two jobs for one report); a failed one is replaced. A replaced report is kept,
    marked superseded.
    """
    existing = current(db, session_id, language)
    if existing is not None:
        if existing.status in IN_PROGRESS:
            return existing, False
        if existing.status in FINISHED_STATUSES and not regenerate:
            return existing, False
        existing.superseded = True
        db.add(existing)
    report = LlmReport(session_id=session_id, language=language, status="queued")
    db.add(report)
    try:
        db.commit()
    except IntegrityError:
        # Another request made it first: use that one.
        db.rollback()
        found = current(db, session_id, language)
        assert found is not None
        return found, False
    db.refresh(report)
    return report, True


#: Jobs that still count: current reports, and the reports of review sets (kept superseded so
#: they are never a patient's).
_LIVE = or_(col(LlmReport.superseded).is_(False), col(LlmReport.review_set_id).is_not(None))


def recover(db: Session) -> list[tuple[int, bool]]:
    """At start-up: jobs cut off by a stop are queued again. (id, is a review job), oldest
    first."""
    rows = db.exec(
        select(LlmReport)
        .where(col(LlmReport.status).in_(IN_PROGRESS), _LIVE)
        .order_by(col(LlmReport.id))
    ).all()
    for row in rows:
        row.status = "queued"
        db.add(row)
    db.commit()
    return [(row.id, row.review_set_id is not None) for row in rows if row.id is not None]


def count_waiting(db: Session) -> int:
    return db.exec(
        select(func.count())
        .select_from(LlmReport)
        .where(col(LlmReport.status).in_(IN_PROGRESS), _LIVE)
    ).one()


# Running


def _wait_for_end(db: Session, record: SessionRecord, wait_s: float) -> None:
    """The questionnaire comes just before the session ends: give the end a moment, so the
    facts include the duration and the next session's plan."""
    deadline = time.monotonic() + wait_s
    while record.status == "active" and time.monotonic() < deadline:
        time.sleep(0.25)
        db.refresh(record)


def finish(db: Session, report: LlmReport, result: ReportResult, facts: dict[str, object]) -> None:
    meta = result.meta
    report.status = "fallback" if meta.fallback_used else "done"
    report.report = result.report.model_dump()
    report.safety_notices = result.safety_notices
    report.facts = facts
    report.candidates = result.candidates
    report.model = meta.model
    report.prompt_version = meta.prompt_version
    report.strategy = meta.strategy
    report.latency_ms = meta.latency_ms
    report.prompt_tokens = meta.prompt_tokens
    report.output_tokens = meta.output_tokens
    report.retries = meta.retries
    report.fallback_used = meta.fallback_used
    report.validation_errors = meta.validation_errors
    report.raw_output = result.raw_output
    report.error = meta.provider_error
    report.finished_at = utc_now()
    db.add(report)
    db.commit()


def run_report(
    db: Session,
    report_id: int,
    provider: LLMProvider,
    end_wait_s: float,
    deadline_s: float,
) -> None:
    """One job: facts -> report (model, validator, retries, template) -> stored. Never raises:
    an unexpected error marks the report failed."""
    report = db.get(LlmReport, report_id)
    if report is None or report.status != "queued":
        return
    if report.superseded and report.review_set_id is None:
        return
    report.status = "running"
    db.add(report)
    db.commit()
    try:
        record = db.get(SessionRecord, report.session_id)
        if record is None:
            raise LookupError(f"There is no session {report.session_id}.")
        if report.review_set_id is not None and report.facts is not None:
            # A review set's report: the same facts as its template twin.
            facts = SessionFacts.model_validate(report.facts)
        else:
            _wait_for_end(db, record, end_wait_s)
            facts = build_facts(db, record)
        result = generate_report_from_facts(
            facts,
            language=cast(FeedbackLanguage, report.language),
            provider=provider,
            deadline_s=deadline_s,
        )
        finish(db, report, result, facts.model_dump(mode="json"))
    except Exception as error:  # noqa: BLE001  (a job must never take the worker down)
        db.rollback()
        report = db.get(LlmReport, report_id)
        if report is not None:
            report.status = "failed"
            report.error = f"{type(error).__name__}: {error}"[:500]
            report.finished_at = utc_now()
            db.add(report)
            db.commit()


# Reading


def to_read(report: LlmReport, for_admin: bool) -> ReportRead:
    assert report.id is not None
    finished = report.status in FINISHED_STATUSES
    return ReportRead(
        job_id=report.id,
        session_id=report.session_id,
        language=cast(Language, report.language),
        status=cast(ReportStatus, report.status),
        report=(report.report if for_admin else patient_view(report.report)) if finished else None,
        safety_notices=report.safety_notices if finished else None,
        meta=(
            ReportMetaRead(
                model=report.model,
                prompt_version=report.prompt_version,
                latency_ms=report.latency_ms,
                retries=report.retries,
                fallback_used=report.fallback_used,
            )
            if finished
            else None
        ),
        created_at=report.created_at,
        finished_at=report.finished_at,
    )


def to_admin_detail(report: LlmReport) -> AdminReportDetail:
    return AdminReportDetail(
        **to_read(report, for_admin=True).model_dump(),
        superseded=report.superseded,
        facts=report.facts,
        candidates=report.candidates,
        validation_errors=report.validation_errors,
        raw_output=report.raw_output,
        error=report.error,
        strategy=report.strategy,
        prompt_tokens=report.prompt_tokens,
        output_tokens=report.output_tokens,
    )


def _session_numbers(db: Session, patient_id: int) -> dict[int, int]:
    """Each session's place among the patient's sessions (all statuses), from 1."""
    ids = db.exec(
        select(SessionRecord.id)
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(SessionRecord.started_at), col(SessionRecord.id))
    ).all()
    return {session_id: number for number, session_id in enumerate(ids, start=1) if session_id}


def patient_reports(db: Session, patient_id: int) -> list[PatientReportItem]:
    """The patient's current reports, newest session first. Failed ones are left out."""
    rows = db.exec(
        select(LlmReport, SessionRecord)
        .join(SessionRecord, col(SessionRecord.id) == col(LlmReport.session_id))
        .where(
            SessionRecord.patient_id == patient_id,
            col(LlmReport.superseded).is_(False),
            LlmReport.status != "failed",
        )
        .order_by(col(SessionRecord.started_at).desc(), col(LlmReport.id).desc())
    ).all()
    numbers = _session_numbers(db, patient_id)
    items = []
    for report, record in rows:
        assert report.id is not None and record.id is not None
        summary = str((report.report or {}).get("patient_summary") or "")
        preview = summary if len(summary) <= PREVIEW_CHARS else summary[:PREVIEW_CHARS].rsplit(" ", 1)[0] + "…"
        items.append(
            PatientReportItem(
                job_id=report.id,
                session_id=record.id,
                session_no=numbers.get(record.id, 0),
                date=record.started_at,
                language=cast(Language, report.language),
                status=cast(ReportStatus, report.status),
                preview=preview,
                has_safety_notice=bool(report.safety_notices),
            )
        )
    return items


def _admin_items(db: Session, rows: Sequence[tuple[LlmReport, SessionRecord, PatientProfile]]) -> list[AdminReportItem]:
    ids = [report.id for report, _, _ in rows if report.id is not None]
    counts: dict[int, int] = {}
    if ids:
        for report_id, count in db.exec(
            select(ReportRating.report_id, func.count())
            .where(col(ReportRating.report_id).in_(ids))
            .group_by(col(ReportRating.report_id))
        ).all():
            counts[report_id] = count
    items = []
    for report, record, profile in rows:
        assert report.id is not None and profile.id is not None
        items.append(
            AdminReportItem(
                job_id=report.id,
                session_id=report.session_id,
                patient_id=profile.id,
                patient_code=profile.patient_code,
                language=cast(Language, report.language),
                status=cast(ReportStatus, report.status),
                superseded=report.superseded,
                model=report.model,
                prompt_version=report.prompt_version,
                latency_ms=report.latency_ms,
                retries=report.retries,
                fallback_used=report.fallback_used,
                error=report.error,
                validation_errors=[errors[:3] for errors in report.validation_errors],
                ratings=counts.get(report.id, 0),
                created_at=report.created_at,
                finished_at=report.finished_at,
            )
        )
    return items


def _admin_query():  # type: ignore[no-untyped-def]
    return (
        select(LlmReport, SessionRecord, PatientProfile)
        .join(SessionRecord, col(SessionRecord.id) == col(LlmReport.session_id))
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        # Review sets' reports are not reports anyone was given.
        .where(col(LlmReport.review_set_id).is_(None))
        .order_by(col(LlmReport.created_at).desc(), col(LlmReport.id).desc())
    )


def admin_patient_reports(db: Session, patient_id: int) -> list[AdminReportItem]:
    """Every version of the patient's reports, newest first."""
    return _admin_items(db, db.exec(_admin_query().where(PatientProfile.id == patient_id)).all())


def admin_reports(db: Session, status: ReportStatus | None = None, limit: int = 200) -> list[AdminReportItem]:
    """Reports across patients for monitoring, newest first, optionally of one status."""
    statement = _admin_query().limit(limit)
    if status is not None:
        statement = statement.where(LlmReport.status == status)
    return _admin_items(db, db.exec(statement).all())


# Ratings


def add_rating(
    db: Session,
    report: LlmReport,
    rater: str,
    rater_user_id: int,
    scores: dict[str, int],
    comment: str | None,
) -> ReportRating:
    """One rating per person per report, of a finished report."""
    assert report.id is not None
    if report.status not in FINISHED_STATUSES:
        raise ReportNotFinishedError
    already = db.exec(
        select(ReportRating).where(
            ReportRating.report_id == report.id, ReportRating.rater_user_id == rater_user_id
        )
    ).first()
    if already is not None:
        raise DuplicateRatingError
    rating = ReportRating(
        report_id=report.id, rater=rater, rater_user_id=rater_user_id, scores=scores, comment=comment
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    return rating


def ratings_for(db: Session, report_id: int) -> list[ReportRating]:
    return list(
        db.exec(
            select(ReportRating).where(ReportRating.report_id == report_id).order_by(col(ReportRating.id))
        ).all()
    )
