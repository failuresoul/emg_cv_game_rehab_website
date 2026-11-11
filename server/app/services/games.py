from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import Calibration, GameRun, PatientProfile, Trial, User
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.game import (
    GameRunDetail,
    GameRunEnd,
    GameRunRead,
    GameRunStart,
    LastSessionGame,
    TrialCreate,
    TrialRead,
)
from app.schemas.metrics import SessionMetricRead
from app.schemas.session import (
    AdminRecentSession,
    AdminSessionDetail,
    CalibrationRead,
    SessionRead,
)
from app.schemas.warmup import WarmupResultRead
from app.services import levels, session_feedback, session_metrics, trial_metrics, warmup
from app.services.game_summary import finished_games_for_sessions
from app.services.sessions import SessionEndedError, abort_active_runs, duration_seconds


class GameRunEndedError(Exception):
    pass


class DuplicateTrialError(Exception):
    pass


class TrialConflictError(Exception):
    """Another request saved the same trial at the same moment."""


def get_own_run(session: Session, patient_id: int, run_id: int) -> GameRun | None:
    """Another patient's run looks the same as one that does not exist."""
    run = session.get(GameRun, run_id)
    if run is None:
        return None
    record = session.get(SessionRecord, run.session_id)
    return run if record is not None and record.patient_id == patient_id else None


def list_session_runs(session: Session, session_id: int) -> list[GameRun]:
    statement = (
        select(GameRun)
        .where(GameRun.session_id == session_id)
        .order_by(col(GameRun.started_at), col(GameRun.id))
    )
    return list(session.exec(statement).all())


def list_run_trials(session: Session, run_id: int) -> list[Trial]:
    statement = select(Trial).where(Trial.game_run_id == run_id).order_by(col(Trial.trial_no))
    return list(session.exec(statement).all())


def start_run(session: Session, record: SessionRecord, payload: GameRunStart) -> GameRun:
    """Only one game is played at a time, so any run still open in the session is aborted."""
    if record.status != "active":
        raise SessionEndedError
    assert record.id is not None
    abort_active_runs(session, record.id)
    run = GameRun(**payload.model_dump(), session_id=record.id)
    # The engine is the patient's, whatever the browser says.
    profile = session.get(PatientProfile, record.patient_id)
    if profile is not None:
        run.engine = profile.engine_mode
    session.add(run)
    session.commit()
    return run


def _count_trials(session: Session, run_id: int) -> int:
    statement = select(func.count()).select_from(Trial).where(Trial.game_run_id == run_id)
    return session.exec(statement).one()


def save_trials(session: Session, run: GameRun, payload: Sequence[TrialCreate]) -> GameRun:
    """Inserts each trial, or replaces the row already saved under its trial_no."""
    if run.status != "active":
        raise GameRunEndedError
    numbers = [item.trial_no for item in payload]
    if len(set(numbers)) != len(numbers):
        raise DuplicateTrialError
    assert run.id is not None

    statement = select(Trial).where(
        Trial.game_run_id == run.id, col(Trial.trial_no).in_(numbers)
    )
    existing = {trial.trial_no: trial for trial in session.exec(statement).all()}
    for item in payload:
        values = item.model_dump()
        row = existing.get(item.trial_no)
        if row is None:
            session.add(Trial(**values, game_run_id=run.id))
            continue
        for key, value in values.items():
            setattr(row, key, value)
        row.created_at = utc_now()
        session.add(row)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise TrialConflictError from None
    run.trials_done = _count_trials(session, run.id)
    session.add(run)
    session.commit()
    return run


def end_run(session: Session, run: GameRun, payload: GameRunEnd) -> GameRun:
    if run.status != "active":
        raise GameRunEndedError
    assert run.id is not None
    run.status = payload.status
    run.ended_at = utc_now()
    run.score = payload.score
    run.summary = payload.summary.model_dump() if payload.summary else None
    run.trials_done = _count_trials(session, run.id)
    session.add(run)
    session.commit()
    # The server's own measures of every trial, from the RAW data (never fails the request).
    trial_metrics.recompute_run(session, run)
    session.refresh(run)
    return run


def last_session_games(session: Session, session_id: int) -> list[LastSessionGame]:
    """Finished runs of one session, in the order they were played."""
    return finished_games_for_sessions(session, [session_id]).get(session_id, [])


def list_recent_sessions(session: Session, limit: int) -> list[AdminRecentSession]:
    """Every patient's sessions, newest first."""
    statement = (
        select(SessionRecord, PatientProfile, User)
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        .join(User, col(User.id) == col(PatientProfile.user_id))
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
        .limit(limit)
    )
    rows = session.exec(statement).all()
    games = finished_games_for_sessions(session, [record.id for record, _, _ in rows if record.id])
    return [
        AdminRecentSession(
            id=record.id,
            patient_id=record.patient_id,
            patient_code=profile.patient_code,
            patient_name=user.full_name,
            started_at=record.started_at,
            status=SessionRead.model_validate(record).status,
            duration_seconds=duration_seconds(record),
            games=games.get(record.id, []),
        )
        for record, profile, user in rows
        if record.id is not None
    ]


def get_admin_session_detail(session: Session, record: SessionRecord) -> AdminSessionDetail:
    assert record.id is not None
    profile = session.get(PatientProfile, record.patient_id)
    assert profile is not None
    user = session.get(User, profile.user_id)
    assert user is not None
    calibration = session.exec(
        select(Calibration).where(Calibration.session_id == record.id)
    ).first()
    runs = list_session_runs(session, record.id)
    adaptation = levels.logs_for_runs(session, [run.id for run in runs if run.id is not None])
    feedback = session_feedback.get_feedback(session, record.id)
    trials_by_run: dict[int, list[TrialRead]] = defaultdict(list)
    if runs:
        statement = (
            select(Trial)
            .where(col(Trial.game_run_id).in_([run.id for run in runs]))
            .order_by(col(Trial.game_run_id), col(Trial.trial_no))
        )
        for trial in session.exec(statement).all():
            trials_by_run[trial.game_run_id].append(TrialRead.model_validate(trial))
    return AdminSessionDetail(
        **SessionRead.model_validate(record).model_dump(),
        patient_code=profile.patient_code,
        patient_name=user.full_name,
        duration_seconds=duration_seconds(record),
        calibration=CalibrationRead.model_validate(calibration) if calibration else None,
        warmup_results=[
            WarmupResultRead.model_validate(result)
            for result in warmup.list_session_results(session, record.id)
        ],
        games=[
            GameRunDetail(
                **GameRunRead.model_validate(run).model_dump(),
                trials=trials_by_run.get(run.id, []) if run.id is not None else [],
                adaptation=[levels.to_read(log) for log in adaptation.get(run.id or 0, [])],
            )
            for run in runs
        ],
        feedback=session_feedback.to_read(feedback, record) if feedback else None,
        flags=record.flags or [],
        needs_review=record.needs_review,
        reviewed_at=record.reviewed_at,
        review_note=record.review_note,
        session_metrics=[
            SessionMetricRead.model_validate(row)
            for row in session_metrics.list_session_metrics(session, record.id)
        ],
    )
