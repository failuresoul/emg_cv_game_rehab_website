"""Muscle-sensor calibrations: saving one per session, the latest, and a patient's list."""

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import EmgCalibration
from app.models import Session as SessionRecord
from app.schemas.emg import EmgCalibrationCreate, threshold_mv


class DuplicateEmgCalibrationError(Exception):
    pass


class SessionEndedError(Exception):
    pass


def save_calibration(
    session: Session, record: SessionRecord, payload: EmgCalibrationCreate
) -> EmgCalibration:
    """One per session, while it is active. The threshold is computed here, not trusted."""
    assert record.id is not None
    if record.status != "active":
        raise SessionEndedError
    calibration = EmgCalibration(
        **payload.model_dump(),
        session_id=record.id,
        threshold_mv=threshold_mv(payload.rest_mean_mv, payload.rest_sd_mv),
    )
    session.add(calibration)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DuplicateEmgCalibrationError from None
    session.refresh(calibration)
    return calibration


def _patient_calibrations(patient_id: int):  # type: ignore[no-untyped-def]
    return (
        select(EmgCalibration)
        .join(SessionRecord, col(SessionRecord.id) == col(EmgCalibration.session_id))
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(EmgCalibration.created_at).desc(), col(EmgCalibration.id).desc())
    )


def latest_calibration(session: Session, patient_id: int) -> EmgCalibration | None:
    return session.exec(_patient_calibrations(patient_id)).first()


def list_calibrations(session: Session, patient_id: int) -> list[EmgCalibration]:
    return list(session.exec(_patient_calibrations(patient_id)).all())
