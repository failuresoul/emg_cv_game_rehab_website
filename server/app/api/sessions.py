from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Response, status

from app.api.deps import CurrentPatient, CurrentUser, SessionDep
from app.models import PatientProfile
from app.models import Session as SessionRecord
from app.schemas.session import (
    CalibrationCreate,
    CalibrationRead,
    DeviceInfo,
    SessionEnd,
    SessionProgressUpdate,
    SessionRead,
    SessionStart,
)
from app.schemas.metrics import SessionFacts
from app.schemas.progress import SessionReport
from app.schemas.session_feedback import SessionFeedbackCreate, SessionFeedbackRead
from app.schemas.warmup import WarmupResultCreate, WarmupResultRead
from app.services import progress, session_facts, session_feedback, sessions, warmup

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


@router.patch("/{session_id}/device-info")
def update_device_info(
    session_id: int, payload: DeviceInfo, session: SessionDep, patient: CurrentPatient
) -> SessionRead:
    record = _get_own_session_or_404(session, patient, session_id)
    return SessionRead.model_validate(sessions.update_device_info(session, record, payload))


@router.patch("/{session_id}/progress")
def update_progress(
    session_id: int, payload: SessionProgressUpdate, session: SessionDep, patient: CurrentPatient
) -> SessionRead:
    """Saves where the patient is, so a refresh or a later return resumes at the same step."""
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        return SessionRead.model_validate(sessions.update_progress(session, record, payload))
    except sessions.SessionEndedError:
        raise _session_ended() from None


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


@router.post("/{session_id}/warmup")
def save_warmup(
    session_id: int,
    payload: Annotated[list[WarmupResultCreate], Body(min_length=1, max_length=20)],
    session: SessionDep,
    patient: CurrentPatient,
) -> list[WarmupResultRead]:
    """Saving an exercise again replaces its earlier result. Returns all of the session's results."""
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        results = warmup.save_results(session, record, payload)
    except sessions.SessionEndedError:
        raise _session_ended() from None
    except warmup.DuplicateExerciseError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Each exercise_id may appear only once",
        ) from None
    except warmup.WarmupConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Warm-up was saved at the same time"
        ) from None
    return [WarmupResultRead.model_validate(result) for result in results]


@router.get("/{session_id}/warmup")
def get_warmup(
    session_id: int, session: SessionDep, patient: CurrentPatient
) -> list[WarmupResultRead]:
    record = _get_own_session_or_404(session, patient, session_id)
    assert record.id is not None
    return [
        WarmupResultRead.model_validate(result)
        for result in warmup.list_session_results(session, record.id)
    ]


@router.post("/{session_id}/questionnaire", status_code=status.HTTP_201_CREATED)
def save_questionnaire(
    session_id: int, payload: SessionFeedbackCreate, session: SessionDep, patient: CurrentPatient
) -> SessionFeedbackRead:
    """Saves the cool-down questionnaire once, and returns the safety flags it raised."""
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        feedback = session_feedback.save_feedback(session, record, payload)
    except session_feedback.DuplicateFeedbackError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Questionnaire already submitted"
        ) from None
    return session_feedback.to_read(feedback, record)


@router.get("/{session_id}/questionnaire")
def get_questionnaire(
    session_id: int, session: SessionDep, patient: CurrentPatient
) -> SessionFeedbackRead:
    record = _get_own_session_or_404(session, patient, session_id)
    assert record.id is not None
    feedback = session_feedback.get_feedback(session, record.id)
    if feedback is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not submitted"
        )
    return session_feedback.to_read(feedback, record)


@router.get("/{session_id}/summary")
def get_summary(session_id: int, session: SessionDep, patient: CurrentPatient) -> SessionReport:
    """The end-of-session summary, with figures from earlier sessions to compare against."""
    record = _get_own_session_or_404(session, patient, session_id)
    return progress.get_session_report(session, record)


@router.get("/{session_id}/facts")
def get_session_facts(session_id: int, session: SessionDep, user: CurrentUser) -> SessionFacts:
    """The session's facts for the feedback module (docs/session-facts.md): codes and numbers,
    never a name or an email. The patient's own sessions, or any session for an admin."""
    record = session.get(SessionRecord, session_id)
    if record is not None and user.role != "admin":
        owner = session.get(PatientProfile, record.patient_id)
        if owner is None or owner.user_id != user.id:
            record = None
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session_facts.build_facts(session, record)
