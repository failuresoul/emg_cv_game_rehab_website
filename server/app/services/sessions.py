from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.models import Calibration, GameRun, PatientProfile
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.session import (
    CalibrationCreate,
    CalibrationRead,
    DeviceInfo,
    LastSession,
    LatestCalibration,
    SessionDetail,
    SessionProgressUpdate,
    SessionRead,
    SessionStart,
    SessionSummary,
)
from app.schemas.game import LastSessionGame
from app.schemas.warmup import WarmupSummary
from app.services import session_metrics
from app.services.game_summary import finished_games_for_sessions
from app.services.warmup_summary import summaries_for_sessions

ACTIVE_SESSION_LIFETIME = timedelta(hours=2)


class SessionEndedError(Exception):
    pass


class DuplicateCalibrationError(Exception):
    pass


class AffectedSideMismatchError(Exception):
    pass


def duration_seconds(record: SessionRecord) -> float | None:
    if record.ended_at is None:
        return None
    return (as_utc(record.ended_at) - as_utc(record.started_at)).total_seconds()


def _summary(
    record: SessionRecord,
    hull_area: float | None,
    warmup_summary: WarmupSummary | None = None,
    games: list[LastSessionGame] | None = None,
) -> SessionSummary:
    return SessionSummary(
        **SessionRead.model_validate(record).model_dump(),
        duration_seconds=duration_seconds(record),
        hull_area_sw2=hull_area,
        warmup_summary=warmup_summary,
        games=games or [],
    )


def abort_active_runs(session: Session, session_id: int) -> None:
    """Mark game runs left open (a closed tab, a crash) as aborted. The caller commits.

    ended_at stays empty: nobody knows when an abandoned run really stopped.
    """
    statement = select(GameRun).where(GameRun.session_id == session_id, GameRun.status == "active")
    for run in session.exec(statement).all():
        run.status = "aborted"
        session.add(run)


def get_active_session(session: Session, patient_id: int) -> SessionRecord | None:
    """Return the patient's active session, marking any older than the lifetime as aborted."""
    statement = (
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id, SessionRecord.status == "active")
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    cutoff = utc_now() - ACTIVE_SESSION_LIFETIME
    current: SessionRecord | None = None
    expired = False
    for record in session.exec(statement).all():
        if as_utc(record.started_at) <= cutoff:
            # ended_at stays empty: nobody knows when an abandoned session really stopped.
            record.status = "aborted"
            session.add(record)
            if record.id is not None:
                abort_active_runs(session, record.id)
            expired = True
        elif current is None:
            current = record
    if expired:
        session.commit()
    return current


def start_session(
    session: Session, patient_id: int, payload: SessionStart | None
) -> tuple[SessionRecord, bool]:
    """Return the session to use and whether it was newly created."""
    current = get_active_session(session, patient_id)
    if current is not None:
        return current, False

    record = SessionRecord(
        patient_id=patient_id,
        device_info=(
            payload.device_info.model_dump() if payload and payload.device_info else None
        ),
        notes=payload.notes if payload else None,
    )
    session.add(record)
    session.commit()
    return record, True


def get_own_session(session: Session, patient_id: int, session_id: int) -> SessionRecord | None:
    """Another patient's session looks the same as one that does not exist."""
    record = session.get(SessionRecord, session_id)
    return record if record is not None and record.patient_id == patient_id else None


def update_device_info(
    session: Session, record: SessionRecord, device_info: DeviceInfo
) -> SessionRecord:
    """FPS and GPU/CPU are only known once the camera has been running."""
    record.device_info = device_info.model_dump()
    session.add(record)
    session.commit()
    return record


def update_progress(
    session: Session, record: SessionRecord, payload: SessionProgressUpdate
) -> SessionRecord:
    """Saves the step and the game queue. Only for an active session."""
    if record.status != "active":
        raise SessionEndedError
    if payload.current_step is not None:
        record.current_step = payload.current_step
    if payload.game_queue is not None:
        record.game_queue = payload.game_queue.model_dump()
    session.add(record)
    session.commit()
    return record


def end_session(session: Session, record: SessionRecord, status: str) -> SessionRecord:
    if record.status != "active":
        raise SessionEndedError
    record.status = status
    record.ended_at = utc_now()
    session.add(record)
    if record.id is not None:
        abort_active_runs(session, record.id)
    session.commit()
    if record.id is not None:
        # The session's summary of every catalogue measure (never fails the request).
        session_metrics.compute_quietly(session, record.id)
        session.refresh(record)
    return record


def save_calibration(
    session: Session,
    record: SessionRecord,
    profile: PatientProfile,
    payload: CalibrationCreate,
) -> Calibration:
    if record.status != "active":
        raise SessionEndedError
    # The body frame is built from this side, so a mismatch would mirror every saved point.
    if payload.affected_side != profile.affected_side:
        raise AffectedSideMismatchError
    assert record.id is not None

    existing = select(Calibration).where(Calibration.session_id == record.id)
    if session.exec(existing).first() is not None:
        raise DuplicateCalibrationError

    calibration = Calibration(**payload.model_dump(), session_id=record.id)
    session.add(calibration)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DuplicateCalibrationError from None
    return calibration


def _patient_calibrations(patient_id: int) -> SelectOfScalar[Calibration]:
    return (
        select(Calibration)
        .join(SessionRecord, col(Calibration.session_id) == col(SessionRecord.id))
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(Calibration.created_at).desc(), col(Calibration.id).desc())
    )


def get_latest_calibration(session: Session, patient_id: int) -> Calibration | None:
    return session.exec(_patient_calibrations(patient_id)).first()


def list_calibrations(session: Session, patient_id: int) -> list[Calibration]:
    return list(session.exec(_patient_calibrations(patient_id)).all())


def list_sessions(session: Session, patient_id: int) -> list[SessionSummary]:
    statement = (
        select(SessionRecord, Calibration.hull_area_sw2)
        .join(
            Calibration,
            col(Calibration.session_id) == col(SessionRecord.id),
            isouter=True,
        )
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    rows = session.exec(statement).all()
    ids = [record.id for record, _ in rows if record.id is not None]
    warmups = summaries_for_sessions(session, ids)
    games = finished_games_for_sessions(session, ids)
    return [
        _summary(
            record,
            hull_area,
            warmups.get(record.id) if record.id else None,
            games.get(record.id) if record.id else None,
        )
        for record, hull_area in rows
    ]


def get_session_detail(session: Session, record: SessionRecord) -> SessionDetail:
    calibration = session.exec(
        select(Calibration).where(Calibration.session_id == record.id)
    ).first()
    assert record.id is not None
    warmup = summaries_for_sessions(session, [record.id]).get(record.id)
    games = finished_games_for_sessions(session, [record.id]).get(record.id)
    summary = _summary(record, calibration.hull_area_sw2 if calibration else None, warmup, games)
    return SessionDetail(
        **summary.model_dump(),
        calibration=CalibrationRead.model_validate(calibration) if calibration else None,
    )


def get_last_session_record(session: Session, patient_id: int) -> SessionRecord | None:
    statement = (
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    return session.exec(statement).first()


def to_last_session(
    record: SessionRecord,
    warmup_summary: WarmupSummary | None = None,
    games: list[LastSessionGame] | None = None,
) -> LastSession:
    read = SessionRead.model_validate(record)
    return LastSession(
        date=read.started_at,
        status=read.status,
        duration_seconds=duration_seconds(record),
        warmup_summary=warmup_summary,
        games=games or [],
    )


def get_latest_calibration_summary(session: Session, patient_id: int) -> LatestCalibration | None:
    calibration = get_latest_calibration(session, patient_id)
    return LatestCalibration.model_validate(calibration) if calibration else None


def count_sessions_today(session: Session) -> int:
    """Sessions started since midnight UTC."""
    midnight = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    statement = (
        select(func.count())
        .select_from(SessionRecord)
        .where(col(SessionRecord.started_at) >= midnight)
    )
    return session.exec(statement).one()
