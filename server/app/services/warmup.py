from collections import defaultdict

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import Session as SessionRecord
from app.models import WarmupResult
from app.models.user import utc_now
from app.schemas.warmup import (
    AdminWarmupHistory,
    AdminWarmupPoint,
    ExerciseId,
    WarmupResultCreate,
    WarmupResultRead,
    WarmupSummary,
)
from app.services.sessions import SessionEndedError


class DuplicateExerciseError(Exception):
    pass


class WarmupConflictError(Exception):
    """Another request saved the same exercise at the same moment."""


def list_session_results(session: Session, session_id: int) -> list[WarmupResult]:
    statement = (
        select(WarmupResult)
        .where(WarmupResult.session_id == session_id)
        .order_by(col(WarmupResult.id))
    )
    return list(session.exec(statement).all())


def save_results(
    session: Session, record: SessionRecord, payload: list[WarmupResultCreate]
) -> list[WarmupResult]:
    """Inserts each exercise, or replaces the row already saved for it in this session."""
    if record.status != "active":
        raise SessionEndedError
    exercise_ids = [item.exercise_id for item in payload]
    if len(set(exercise_ids)) != len(exercise_ids):
        raise DuplicateExerciseError
    assert record.id is not None

    existing = {result.exercise_id: result for result in list_session_results(session, record.id)}
    for item in payload:
        values = item.model_dump()
        row = existing.get(item.exercise_id)
        if row is None:
            session.add(WarmupResult(**values, session_id=record.id))
            continue
        for key, value in values.items():
            setattr(row, key, value)
        row.created_at = utc_now()
        session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise WarmupConflictError from None
    return list_session_results(session, record.id)


def get_history(
    session: Session, patient_id: int, exercise_id: ExerciseId, limit: int
) -> list[WarmupResult]:
    """The patient's latest results for one exercise, newest first, without skipped ones."""
    statement = (
        select(WarmupResult)
        .join(SessionRecord, col(WarmupResult.session_id) == col(SessionRecord.id))
        .where(
            SessionRecord.patient_id == patient_id,
            WarmupResult.exercise_id == exercise_id,
            col(WarmupResult.skipped).is_(False),
        )
        .order_by(col(WarmupResult.created_at).desc(), col(WarmupResult.id).desc())
        .limit(limit)
    )
    return list(session.exec(statement).all())


def get_admin_history(
    session: Session, patient_id: int, exercise_id: ExerciseId | None
) -> list[AdminWarmupHistory]:
    """Per exercise, oldest first so it can be charted. Skipped exercises are left out."""
    statement = (
        select(WarmupResult)
        .join(SessionRecord, col(WarmupResult.session_id) == col(SessionRecord.id))
        .where(SessionRecord.patient_id == patient_id, col(WarmupResult.skipped).is_(False))
        .order_by(col(WarmupResult.created_at), col(WarmupResult.id))
    )
    if exercise_id is not None:
        statement = statement.where(WarmupResult.exercise_id == exercise_id)

    grouped: dict[ExerciseId, list[AdminWarmupPoint]] = defaultdict(list)
    for row in session.exec(statement).all():
        read = WarmupResultRead.model_validate(row)
        grouped[read.exercise_id].append(
            AdminWarmupPoint(
                session_id=read.session_id,
                date=read.created_at,
                preset=read.preset,
                best_peak=read.best_peak,
                target_high=read.thresholds.high,
                full_reps=read.full_reps,
                compensation_rate=read.compensation_rate,
            )
        )
    return [
        AdminWarmupHistory(exercise_id=exercise, points=points)
        for exercise, points in sorted(grouped.items())
    ]


def get_summary(session: Session, session_id: int) -> WarmupSummary | None:
    """None if the session has no warm-up results at all."""
    results = list_session_results(session, session_id)
    if not results:
        return None
    done = [result for result in results if not result.skipped]
    return WarmupSummary(
        exercises_done=len(done),
        total_reps=sum(result.full_reps for result in done),
        mean_compensation_rate=(
            sum(result.compensation_rate for result in done) / len(done) if done else None
        ),
    )
