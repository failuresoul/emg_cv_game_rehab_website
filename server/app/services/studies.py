"""Research mode: controlled comparisons of the engine conditions (L0, L1, L2).

- **Within-subject:** each participant plays every condition, in an order from a balanced Latin
  square (Williams design): every condition comes in every position equally often, and follows
  every other condition equally often. With an odd number of conditions the square is followed
  by its mirror image, so a full set is 2 x n participants. Participants take the rows in turn.
- **Between-subject:** each participant plays one condition, from balanced randomisation in
  permuted blocks: every block of n participants has each condition once, shuffled with the
  study's seed, so the groups never differ by more than one.

While a patient is enrolled in an active study, each new session gets the next condition: it
replaces the programme's engine for every game of the session, and the session plays the
study's fixed games. The patient is never told the condition: the browser behaves the same in
every condition (the server sets the difficulty; the same messages, level display and cues).
The programme's highest levels and the safety rules still apply.
"""

import math
import random
import secrets
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from statistics import fmean, stdev
from typing import Any

from scipy import stats as scipy_stats
from sqlmodel import Session, col, select

from app.engine.sim.measures import challenge_error, rolling_success, time_in_zone
from app.models import (
    AdaptationLog,
    GameRun,
    LlmReport,
    PatientProfile,
    ReportRating,
    SessionFeedback,
    Study,
    StudyParticipant,
    Trial,
)
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.study import (
    ConditionResult,
    Estimate,
    ParticipantProgress,
    ParticipantRead,
    StudyCreate,
    StudyProgress,
    StudyRead,
    StudyResults,
    StudyUpdate,
)
from app.services.exports import _write
from app.services.levels import level_of_state

#: draft -> active -> closed, never back.
TRANSITIONS = {"draft": {"active", "closed"}, "active": {"closed"}, "closed": set()}


class StudyError(Exception):
    """A request the study's state does not allow (409), with a message for the admin."""


class NoConsentError(StudyError):
    pass


# ---- Assignment ---------------------------------------------------------------------------------


def williams_orders(conditions: Sequence[str]) -> list[list[str]]:
    """A balanced Latin square: n rows for an even n, 2n (the square and its mirror) for an odd
    n. Each condition takes each position equally often and follows each other condition equally
    often."""
    n = len(conditions)
    sequence = [0]
    low, high, take_low = 1, n - 1, True
    while len(sequence) < n:
        if take_low:
            sequence.append(low)
            low += 1
        else:
            sequence.append(high)
            high -= 1
        take_low = not take_low
    rows = [[(index + shift) % n for index in sequence] for shift in range(n)]
    if n % 2 == 1:
        rows += [list(reversed(row)) for row in rows]
    return [[conditions[index] for index in row] for row in rows]


def condition_order(conditions: Sequence[str], position: int) -> list[str]:
    """The within-subject order of the participant enrolled at `position` (0, 1, ...)."""
    rows = williams_orders(conditions)
    return rows[position % len(rows)]


def randomised_condition(conditions: Sequence[str], seed: int, position: int) -> str:
    """The between-subject condition of the participant at `position`: permuted blocks of one
    of each condition, shuffled with the study's seed."""
    n = len(conditions)
    block = list(conditions)
    random.Random(seed * 10_007 + position // n).shuffle(block)
    return block[position % n]


# ---- Studies ------------------------------------------------------------------------------------


def to_read(session: Session, study: Study) -> StudyRead:
    count = len(
        session.exec(select(StudyParticipant.id).where(StudyParticipant.study_id == study.id)).all()
    )
    return StudyRead.model_validate(study).model_copy(update={"participants": count})


def list_studies(session: Session) -> list[Study]:
    return list(session.exec(select(Study).order_by(col(Study.created_at).desc())).all())


def create(session: Session, payload: StudyCreate) -> Study:
    data = payload.model_dump()
    seed = data.pop("seed")
    study = Study(**data, seed=seed if seed is not None else secrets.randbelow(2**31))
    session.add(study)
    session.commit()
    session.refresh(study)
    return study


def update(session: Session, study: Study, payload: StudyUpdate) -> Study:
    changes = payload.model_dump(exclude_unset=True)
    status = changes.pop("status", None)
    design_fields = {"design", "conditions", "sessions_per_condition", "games"} & set(changes)
    if design_fields and study.status != "draft":
        raise StudyError("The design can only change while the study is a draft")
    if design_fields and _participants(session, study):
        raise StudyError("The design cannot change once participants are enrolled")
    for name, value in changes.items():
        setattr(study, name, value)
    if status is not None and status != study.status:
        if status not in TRANSITIONS[study.status]:
            raise StudyError(f"A {study.status} study cannot become {status}")
        study.status = status
    study.updated_at = utc_now()
    session.add(study)
    session.commit()
    session.refresh(study)
    return study


def delete(session: Session, study: Study) -> None:
    if study.status != "draft" or _participants(session, study):
        raise StudyError("Only a draft study without participants can be deleted")
    session.delete(study)
    session.commit()


def _participants(session: Session, study: Study) -> list[StudyParticipant]:
    return list(
        session.exec(
            select(StudyParticipant)
            .where(StudyParticipant.study_id == study.id)
            .order_by(col(StudyParticipant.position))
        ).all()
    )


# ---- Participants -------------------------------------------------------------------------------


def current_participation(
    session: Session, patient_id: int, statuses: Iterable[str] = ("active",)
) -> tuple[Study, StudyParticipant] | None:
    """The patient's enrolment (not withdrawn) in a study with one of `statuses`."""
    row = session.exec(
        select(Study, StudyParticipant)
        .join(StudyParticipant, col(StudyParticipant.study_id) == col(Study.id))
        .where(
            StudyParticipant.patient_id == patient_id,
            col(StudyParticipant.withdrawn_at).is_(None),
            col(Study.status).in_(list(statuses)),
        )
    ).first()
    return (row[0], row[1]) if row else None


def enrol(session: Session, study: Study, profile: PatientProfile) -> StudyParticipant:
    """Enrols a consenting patient, with the next Latin square row or randomisation slot."""
    assert study.id is not None and profile.id is not None
    if study.status == "closed":
        raise StudyError("The study is closed")
    if profile.research_consent_at is None:
        raise NoConsentError(f"{profile.patient_code} has no research consent recorded")
    existing = session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id, StudyParticipant.patient_id == profile.id
        )
    ).first()
    if existing is not None:
        raise StudyError(f"{profile.patient_code} is already in this study")
    other = current_participation(session, profile.id, ("draft", "active"))
    if other is not None:
        raise StudyError(f"{profile.patient_code} is already in another study ({other[0].name})")
    position = len(_participants(session, study))
    participant = StudyParticipant(study_id=study.id, patient_id=profile.id, position=position)
    if study.design == "within_subject":
        participant.condition_order = condition_order(study.conditions, position)
    else:
        participant.assigned_condition = randomised_condition(study.conditions, study.seed, position)
    session.add(participant)
    session.commit()
    session.refresh(participant)
    return participant


def withdraw(session: Session, participant: StudyParticipant) -> StudyParticipant:
    """From now on the patient's sessions follow their programme again. Data already collected
    stays in the study's results."""
    if participant.withdrawn_at is None:
        participant.withdrawn_at = utc_now()
        session.add(participant)
        session.commit()
        session.refresh(participant)
    return participant


def get_participant(session: Session, study: Study, participant_id: int) -> StudyParticipant | None:
    participant = session.get(StudyParticipant, participant_id)
    return participant if participant is not None and participant.study_id == study.id else None


def participant_read(participant: StudyParticipant, code: str) -> ParticipantRead:
    assert participant.id is not None
    return ParticipantRead(
        id=participant.id,
        patient_id=participant.patient_id,
        patient_code=code,
        position=participant.position,
        condition_order=participant.condition_order,  # type: ignore[arg-type]
        assigned_condition=participant.assigned_condition,  # type: ignore[arg-type]
        current_index=participant.current_index,
        enrolled_at=participant.enrolled_at,
        withdrawn_at=participant.withdrawn_at,
    )


def sessions_done(session: Session, study_id: int, patient_id: int) -> dict[str, int]:
    """Completed sessions of the study per condition."""
    done: dict[str, int] = defaultdict(int)
    for record in session.exec(
        select(SessionRecord).where(
            SessionRecord.study_id == study_id,
            SessionRecord.patient_id == patient_id,
            SessionRecord.status == "completed",
        )
    ).all():
        if record.study_condition:
            done[record.study_condition] += 1
    return dict(done)


def next_condition(study: Study, participant: StudyParticipant, done: dict[str, int]) -> str | None:
    """The condition the participant's next session plays; None when complete, withdrawn, or the
    study is not active."""
    if participant.withdrawn_at is not None or study.status != "active":
        return None
    order = (
        participant.condition_order
        if study.design == "within_subject"
        else [participant.assigned_condition]
    ) or []
    return next(
        (c for c in order if c is not None and done.get(c, 0) < study.sessions_per_condition),
        None,
    )


def assign_session(session: Session, record: SessionRecord) -> None:
    """Gives a new session its study and condition while the patient's study is active.
    Changes the record without committing."""
    found = current_participation(session, record.patient_id)
    if found is None:
        return
    study, participant = found
    assert study.id is not None
    condition = next_condition(study, participant, sessions_done(session, study.id, record.patient_id))
    if condition is None:
        return
    record.study_id = study.id
    record.study_condition = condition
    if participant.condition_order:
        participant.current_index = participant.condition_order.index(condition)
    session.add(participant)


def study_of(session: Session, record: SessionRecord) -> Study | None:
    return session.get(Study, record.study_id) if record.study_id is not None else None


def study_games_for(session: Session, patient_id: int) -> list[str]:
    """The games of the patient's active study, for the games the patient may play."""
    found = current_participation(session, patient_id)
    return list(found[0].games) if found else []


# ---- Progress -----------------------------------------------------------------------------------


def _codes(session: Session, patient_ids: Iterable[int]) -> dict[int, str]:
    ids = list(set(patient_ids))
    if not ids:
        return {}
    rows = session.exec(select(PatientProfile).where(col(PatientProfile.id).in_(ids))).all()
    return {row.id: row.patient_code for row in rows if row.id is not None}


def progress(session: Session, study: Study) -> StudyProgress:
    assert study.id is not None
    participants = _participants(session, study)
    codes = _codes(session, (p.patient_id for p in participants))
    rows = []
    for participant in participants:
        done = sessions_done(session, study.id, participant.patient_id)
        upcoming = next_condition(study, participant, done)
        order = participant.condition_order or [participant.assigned_condition or ""]
        complete = all(done.get(c, 0) >= study.sessions_per_condition for c in order if c)
        rows.append(
            ParticipantProgress(
                **participant_read(participant, codes.get(participant.patient_id, "?")).model_dump(),
                sessions_done={c: done.get(c, 0) for c in study.conditions},
                next_condition=upcoming,  # type: ignore[arg-type]
                complete=complete,
            )
        )
    return StudyProgress(
        study_id=study.id,
        sessions_per_condition=study.sessions_per_condition,
        conditions=study.conditions,  # type: ignore[arg-type]
        participants=rows,
    )


# ---- Results ------------------------------------------------------------------------------------


def estimate(values: Sequence[float]) -> Estimate:
    """The mean over participants, with a 95% t interval from two participants on."""
    found = [value for value in values if value is not None and math.isfinite(value)]
    n = len(found)
    if n == 0:
        return Estimate(mean=None, ci_low=None, ci_high=None, n=0)
    mean = fmean(found)
    if n < 2:
        return Estimate(mean=round(mean, 4), ci_low=None, ci_high=None, n=1)
    half = float(scipy_stats.t.ppf(0.975, n - 1)) * stdev(found) / math.sqrt(n)
    return Estimate(
        mean=round(mean, 4), ci_low=round(mean - half, 4), ci_high=round(mean + half, 4), n=n
    )


def _mean(values: Iterable[float | None]) -> float | None:
    found = [value for value in values if value is not None]
    return fmean(found) if found else None


@dataclass
class _ParticipantData:
    sessions: list[SessionRecord]
    runs: list[GameRun]
    trials: dict[int, list[Trial]]
    levels: dict[int, list[int]]


def _rating_mean(scores: dict[str, Any]) -> float | None:
    values = [float(v) for v in (scores or {}).values() if isinstance(v, int | float)]
    return fmean(values) if values else None


def results(session: Session, study: Study) -> StudyResults:
    """Per condition: trials, success, challenge error, time in zone, compensation, level, the
    questionnaire's enjoyment and fatigue, and the participants' report ratings. Every measure is
    first worked out per participant, then averaged across participants with a 95% CI. Completed
    sessions only; data from participants who later withdrew is kept."""
    assert study.id is not None
    records = list(
        session.exec(
            select(SessionRecord).where(
                SessionRecord.study_id == study.id, SessionRecord.status == "completed"
            )
        ).all()
    )
    session_ids = [r.id for r in records if r.id is not None]
    runs = (
        list(session.exec(select(GameRun).where(col(GameRun.session_id).in_(session_ids))).all())
        if session_ids
        else []
    )
    run_ids = [r.id for r in runs if r.id is not None]
    trials: dict[int, list[Trial]] = defaultdict(list)
    levels: dict[int, list[int]] = defaultdict(list)
    if run_ids:
        for trial in session.exec(
            select(Trial).where(col(Trial.game_run_id).in_(run_ids)).order_by(col(Trial.trial_no))
        ).all():
            if trial.outcome != "aborted":
                trials[trial.game_run_id].append(trial)
        for log in session.exec(
            select(AdaptationLog).where(col(AdaptationLog.game_run_id).in_(run_ids))
        ).all():
            if log.trial_no >= 1:
                levels[log.game_run_id].append(level_of_state(log.state_after))
    feedback = (
        {
            row.session_id: row
            for row in session.exec(
                select(SessionFeedback).where(col(SessionFeedback.session_id).in_(session_ids))
            ).all()
        }
        if session_ids
        else {}
    )
    ratings: dict[int, list[float]] = defaultdict(list)
    if session_ids:
        for rating, report in session.exec(
            select(ReportRating, LlmReport)
            .join(LlmReport, col(LlmReport.id) == col(ReportRating.report_id))
            .where(
                col(LlmReport.session_id).in_(session_ids),
                ReportRating.rater == "participant",
                col(ReportRating.review_set_id).is_(None),
            )
        ).all():
            value = _rating_mean(rating.scores)
            if value is not None:
                ratings[report.session_id].append(value)

    runs_by_session: dict[int, list[GameRun]] = defaultdict(list)
    for run in runs:
        runs_by_session[run.session_id].append(run)

    out: list[ConditionResult] = []
    for condition in study.conditions:
        by_patient: dict[int, list[SessionRecord]] = defaultdict(list)
        for record in records:
            if record.study_condition == condition:
                by_patient[record.patient_id].append(record)
        per: dict[str, list[float]] = defaultdict(list)
        total_trials = 0
        for patient_records in by_patient.values():
            patient_runs = sorted(
                (run for r in patient_records for run in runs_by_session.get(r.id or -1, [])),
                key=lambda run: (as_utc(run.started_at), run.id or 0),
            )
            all_trials = [t for run in patient_runs for t in trials.get(run.id or -1, [])]
            total_trials += len(all_trials)
            if all_trials:
                per["success"].append(sum(t.outcome == "success" for t in all_trials) / len(all_trials))
                per["compensation"].append(
                    sum(bool((t.compensation or {}).get("flagged")) for t in all_trials) / len(all_trials)
                )
            errors, zones = [], []
            for run in patient_runs:
                rolling = rolling_success([t.outcome == "success" for t in trials.get(run.id or -1, [])])
                error, zone = challenge_error(rolling), time_in_zone(rolling)
                if error is not None and zone is not None:
                    errors.append(error)
                    zones.append(zone)
            if errors:
                per["challenge"].append(fmean(errors))
                per["zone"].append(fmean(zones))
            run_levels = [level for run in patient_runs for level in levels.get(run.id or -1, [])]
            if run_levels:
                per["level"].append(fmean(run_levels))
            answers = [feedback[r.id] for r in patient_records if r.id in feedback]
            enjoyment = _mean(a.enjoyment_1_5 for a in answers)
            fatigue = _mean(a.fatigue_0_10 for a in answers)
            if enjoyment is not None:
                per["enjoyment"].append(enjoyment)
            if fatigue is not None:
                per["fatigue"].append(fatigue)
            rated = [value for r in patient_records for value in ratings.get(r.id or -1, [])]
            if rated:
                per["rating"].append(fmean(rated))
        out.append(
            ConditionResult(
                condition=condition,  # type: ignore[arg-type]
                participants=len(by_patient),
                sessions=sum(len(v) for v in by_patient.values()),
                trials=total_trials,
                success_rate=estimate(per["success"]),
                challenge_error=estimate(per["challenge"]),
                time_in_zone=estimate(per["zone"]),
                compensation_rate=estimate(per["compensation"]),
                mean_level=estimate(per["level"]),
                enjoyment=estimate(per["enjoyment"]),
                fatigue=estimate(per["fatigue"]),
                report_rating=estimate(per["rating"]),
            )
        )
    return StudyResults(study_id=study.id, design=study.design, conditions=out)  # type: ignore[arg-type]


# ---- Export -------------------------------------------------------------------------------------

EXPORT_COLUMNS = (
    "study_id",
    "design",
    "patient_code",
    "position",
    "condition",
    "session_index",
    "session_id",
    "session_date",
    "run_id",
    "game_id",
    "engine",
    "trial_no",
    "outcome",
    "compensated",
    "level_after",
    "enjoyment_1_5",
    "fatigue_0_10",
)


def export_csv(session: Session, study: Study) -> str:
    """One row per trial of the study's completed sessions, patients by code only."""
    assert study.id is not None
    participants = {p.patient_id: p for p in _participants(session, study)}
    records = sorted(
        session.exec(
            select(SessionRecord).where(
                SessionRecord.study_id == study.id, SessionRecord.status == "completed"
            )
        ).all(),
        key=lambda r: (r.patient_id, as_utc(r.started_at), r.id or 0),
    )
    codes = _codes(session, {*participants, *(r.patient_id for r in records)})
    rows: list[dict[str, Any]] = []
    index: dict[int, int] = defaultdict(int)
    for record in records:
        index[record.patient_id] += 1
        answers = session.exec(
            select(SessionFeedback).where(SessionFeedback.session_id == record.id)
        ).first()
        runs = session.exec(
            select(GameRun).where(GameRun.session_id == record.id).order_by(col(GameRun.started_at))
        ).all()
        for run in runs:
            after = {
                log.trial_no: level_of_state(log.state_after)
                for log in session.exec(
                    select(AdaptationLog).where(AdaptationLog.game_run_id == run.id)
                ).all()
            }
            for trial in session.exec(
                select(Trial).where(Trial.game_run_id == run.id).order_by(col(Trial.trial_no))
            ).all():
                participant = participants.get(record.patient_id)
                rows.append(
                    {
                        "study_id": study.id,
                        "design": study.design,
                        "patient_code": codes.get(record.patient_id, ""),
                        "position": participant.position if participant else None,
                        "condition": record.study_condition,
                        "session_index": index[record.patient_id],
                        "session_id": record.id,
                        "session_date": as_utc(record.started_at).date().isoformat(),
                        "run_id": run.id,
                        "game_id": run.game_id,
                        "engine": run.engine,
                        "trial_no": trial.trial_no,
                        "outcome": trial.outcome,
                        "compensated": bool((trial.compensation or {}).get("flagged")),
                        "level_after": after.get(trial.trial_no),
                        "enjoyment_1_5": answers.enjoyment_1_5 if answers else None,
                        "fatigue_0_10": answers.fatigue_0_10 if answers else None,
                    }
                )
    return _write(EXPORT_COLUMNS, rows)
