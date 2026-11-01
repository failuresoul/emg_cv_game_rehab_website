from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import CurrentPatient, SessionDep
from app.models import Session as SessionRecord
from app.schemas.session import CalibrationCreate, CalibrationRead, SessionEnd, SessionRead, SessionStart
from app.services import sessions

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _get_own_session_or_404(
    session: SessionDep, patient: CurrentPatient, session_id: int
) -> SessionRecord:
    assert patient.id is not None
    record = sessions.get_own_session(session, patient.id, session_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return record


def _session_ended() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session has already ended")


@router.post("", status_code=status.HTTP_201_CREATED)
def start_session(
    response: Response,
    session: SessionDep,
    patient: CurrentPatient,
    payload: SessionStart | None = None,
) -> SessionRead:
    """Returns 201 for a new session, or 200 when resuming the active one."""
    assert patient.id is not None
    record, created = sessions.start_session(session, patient.id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return SessionRead.model_validate(record)


@router.get("/current")
def current_session(session: SessionDep, patient: CurrentPatient) -> SessionRead:
    assert patient.id is not None
    record = sessions.get_active_session(session, patient.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session")
    return SessionRead.model_validate(record)


@router.post("/{session_id}/end")
def end_session(
    session_id: int, payload: SessionEnd, session: SessionDep, patient: CurrentPatient
) -> SessionRead:
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        return SessionRead.model_validate(sessions.end_session(session, record, payload.status))
    except sessions.SessionEndedError:
        raise _session_ended() from None


@router.post("/{session_id}/calibration", status_code=status.HTTP_201_CREATED)
def save_calibration(
    session_id: int, payload: CalibrationCreate, session: SessionDep, patient: CurrentPatient
) -> CalibrationRead:
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        calibration = sessions.save_calibration(session, record, patient, payload)
    except sessions.SessionEndedError:
        raise _session_ended() from None
    except sessions.DuplicateCalibrationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Session already has a calibration"
        ) from None
    except sessions.AffectedSideMismatchError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="affected_side does not match the patient's profile",
        ) from None
    return CalibrationRead.model_validate(calibration)
