from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.models import Calibration, PatientProfile
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.session import (
    CalibrationCreate,
    LastSession,
    LatestCalibration,
    SessionRead,
    SessionStart,
    SessionSummary,
)

ACTIVE_SESSION_LIFETIME = timedelta(hours=2)


class SessionEndedError(Exception):
    pass


class DuplicateCalibrationError(Exception):
    pass


class AffectedSideMismatchError(Exception):
    pass


def _duration_seconds(record: SessionRecord) -> float | None:
    if record.ended_at is None:
        return None
    return (as_utc(record.ended_at) - as_utc(record.started_at)).total_seconds()


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


def end_session(session: Session, record: SessionRecord, status: str) -> SessionRecord:
    if record.status != "active":
        raise SessionEndedError
    record.status = status
    record.ended_at = utc_now()
    session.add(record)
    session.commit()
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
    return [
        SessionSummary(
            **SessionRead.model_validate(record).model_dump(),
            duration_seconds=_duration_seconds(record),
            hull_area_sw2=hull_area,
        )
        for record, hull_area in session.exec(statement).all()
    ]


def get_last_session(session: Session, patient_id: int) -> LastSession | None:
    statement = (
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    record = session.exec(statement).first()
    if record is None:
        return None
    read = SessionRead.model_validate(record)
    return LastSession(
        date=read.started_at,
        status=read.status,
        duration_seconds=_duration_seconds(record),
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
