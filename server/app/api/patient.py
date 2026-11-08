from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentPatient, SessionDep
from app.schemas.patient import PatientDashboard, PatientProfileRead, TodayPlanStep
from app.schemas.session import CalibrationRead, LastSession, SessionDetail, SessionSummary
from app.schemas.warmup import ExerciseId, WarmupResultRead
from app.services import sessions, warmup

router = APIRouter(prefix="/patient", tags=["patient"])

TODAY_PLAN = [
    TodayPlanStep(step="camera_check", minutes=1),
    TodayPlanStep(step="calibration", minutes=2),
    TodayPlanStep(step="warmup", minutes=6),
    TodayPlanStep(step="games", minutes=15),
    TodayPlanStep(step="feedback", minutes=2),
]


@router.get("/dashboard")
def dashboard(patient: CurrentPatient, session: SessionDep) -> PatientDashboard:
    assert patient.id is not None
    record = sessions.get_last_session_record(session, patient.id)
    last_session: LastSession | None = None
    if record is not None:
        assert record.id is not None
        last_session = sessions.to_last_session(record, warmup.get_summary(session, record.id))
    return PatientDashboard(
        profile=PatientProfileRead.model_validate(patient),
        today_plan=TODAY_PLAN,
        last_session=last_session,
        latest_calibration=sessions.get_latest_calibration_summary(session, patient.id),
    )


@router.get("/calibration/latest")
def latest_calibration(patient: CurrentPatient, session: SessionDep) -> CalibrationRead:
    assert patient.id is not None
    calibration = sessions.get_latest_calibration(session, patient.id)
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No calibration yet")
    return CalibrationRead.model_validate(calibration)


@router.get("/sessions")
def list_sessions(patient: CurrentPatient, session: SessionDep) -> list[SessionSummary]:
    assert patient.id is not None
    return sessions.list_sessions(session, patient.id)


@router.get("/sessions/{session_id}")
def get_session(session_id: int, patient: CurrentPatient, session: SessionDep) -> SessionDetail:
    assert patient.id is not None
    record = sessions.get_own_session(session, patient.id, session_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return sessions.get_session_detail(session, record)


@router.get("/warmup/history")
def warmup_history(
    patient: CurrentPatient,
    session: SessionDep,
    exercise_id: ExerciseId,
    limit: Annotated[int, Query(ge=1, le=50)] = 5,
) -> list[WarmupResultRead]:
    """Latest non-skipped results for one exercise, newest first. Used by personalisation."""
    assert patient.id is not None
    return [
        WarmupResultRead.model_validate(result)
        for result in warmup.get_history(session, patient.id, exercise_id, limit)
    ]
