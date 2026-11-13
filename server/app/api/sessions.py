import logging
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Response, status

from app.api.deps import CurrentPatient, CurrentUser, SessionDep
from app.feedback import store as feedback_store
from app.feedback.jobs import report_jobs
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
from app.schemas.emg import EmgCalibrationCreate, EmgCalibrationRead
from app.schemas.metrics import SessionFacts
from app.schemas.plan import PlanOverrideCreate, PlanOverrideRead, PlanOverrides, SessionPlan
from app.schemas.progress import SessionReport
from app.schemas.session_feedback import SessionFeedbackCreate, SessionFeedbackRead
from app.schemas.warmup import WarmupResultCreate, WarmupResultRead
from app.models.user import utc_now
from app.services import emg, planner, progress, session_facts, session_feedback, sessions, warmup

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


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


@router.post("/{session_id}/emg-calibration", status_code=status.HTTP_201_CREATED)
def save_emg_calibration(
    session_id: int, payload: EmgCalibrationCreate, session: SessionDep, patient: CurrentPatient
) -> EmgCalibrationRead:
    """The muscle sensor's rest level, MVC and checks; once per session, while it is active."""
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        calibration = emg.save_calibration(session, record, payload)
    except emg.SessionEndedError:
        raise _session_ended() from None
    except emg.DuplicateEmgCalibrationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Session already has an EMG calibration"
        ) from None
    return EmgCalibrationRead.model_validate(calibration)


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
    # The session's measures are computed; queue its report in the patient's language.
    _queue_report(session, record, patient.language)
    return session_feedback.to_read(feedback, record)


def _queue_report(session: SessionDep, record: SessionRecord, language: str) -> None:
    """Never fails the questionnaire: a report that cannot be queued can be asked for later."""
    assert record.id is not None
    try:
        report, created = feedback_store.request_report(session, record.id, language)
    except Exception:  # noqa: BLE001
        logger.exception("Could not queue the report for session %s", record.id)
        session.rollback()
        return
    if created and report.id is not None:
        report_jobs.enqueue(report.id)


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


def _session_for_user(session: SessionDep, user: CurrentUser, session_id: int) -> SessionRecord:
    """The session, for its patient or an admin; 404 for anyone else."""
    record = session.get(SessionRecord, session_id)
    if record is not None and user.role != "admin":
        owner = session.get(PatientProfile, record.patient_id)
        if owner is None or owner.user_id != user.id:
            record = None
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return record


@router.get("/{session_id}/plan")
def get_plan(session_id: int, session: SessionDep, user: CurrentUser) -> SessionPlan:
    """Today's games in order, with reasons: planned once, from the sessions before this one,
    and kept with the session."""
    record = _session_for_user(session, user, session_id)
    try:
        return planner.stored_plan(session, record)
    except planner.NoPlanError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This session has no plan"
        ) from None


@router.post("/{session_id}/plan/override", status_code=status.HTTP_201_CREATED)
def override_plan(
    session_id: int, payload: PlanOverrideCreate, session: SessionDep, patient: CurrentPatient
) -> PlanOverrides:
    """Records the games the patient kept and their order, for analysis. The plan itself is not
    changed."""
    record = _get_own_session_or_404(session, patient, session_id)
    if record.status != "active":
        raise _session_ended()
    planned = [game.game_id for game in planner.stored_plan(session, record).games]
    kept = [game for game in planned if game in payload.games]
    entry = PlanOverrideRead(
        at=utc_now(),
        planned=planned,  # type: ignore[arg-type]
        games=payload.games,
        removed=[game for game in planned if game not in payload.games],  # type: ignore[misc]
        added=[game for game in payload.games if game not in planned],
        reordered=[game for game in payload.games if game in planned] != kept,
    )
    record.plan_overrides = [*(record.plan_overrides or []), entry.model_dump(mode="json")]
    session.add(record)
    session.commit()
    session.refresh(record)
    return PlanOverrides(
        overrides=[PlanOverrideRead.model_validate(item) for item in record.plan_overrides]
    )
