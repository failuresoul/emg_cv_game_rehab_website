from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentPatient, SessionDep, TzOffset
from app.schemas.patient import (
    OwnProfileUpdate,
    PatientDashboard,
    PatientProfileRead,
    TodayPlanStep,
)
from app.schemas.programme import PatientProgrammeRead
from app.schemas.emg import EmgCalibrationRead
from app.schemas.metrics import MetricSeries
from app.schemas.progress import PatientProgress
from app.schemas.session import CalibrationRead, LastSession, SessionDetail, SessionSummary
from app.schemas.warmup import ExerciseId, WarmupResultRead
from app.services import emg, games, patients, progress, sessions, warmup
from app.services import programme as programmes
from app.services.metrics_catalog import get_metric

router = APIRouter(prefix="/patient", tags=["patient"])

TODAY_PLAN = [
    TodayPlanStep(step="camera_check", minutes=1),
    TodayPlanStep(step="calibration", minutes=2),
    TodayPlanStep(step="warmup", minutes=10),
    TodayPlanStep(step="games", minutes=15),
    TodayPlanStep(step="feedback", minutes=2),
]


@router.get("/dashboard")
def dashboard(
    patient: CurrentPatient, session: SessionDep, tz_offset_minutes: TzOffset = 0
) -> PatientDashboard:
    assert patient.id is not None
    record = sessions.get_last_session_record(session, patient.id)
    last_session: LastSession | None = None
    if record is not None:
        assert record.id is not None
        last_session = sessions.to_last_session(
            record,
            warmup.get_summary(session, record.id),
            games.last_session_games(session, record.id),
        )
    return PatientDashboard(
        profile=patients.profile_read(session, patient),
        today_plan=TODAY_PLAN,
        last_session=last_session,
        latest_calibration=sessions.get_latest_calibration_summary(session, patient.id),
        last_warmup=warmup.get_last_warmup(session, patient.id),
        streak_days=progress.get_streak(session, patient.id, tz_offset_minutes),
    )


@router.get("/progress")
def get_progress(
    patient: CurrentPatient, session: SessionDep, tz_offset_minutes: TzOffset = 0
) -> PatientProgress:
    """Streak, this week, the last 28 days and one point per completed session."""
    return progress.get_progress(session, patient, tz_offset_minutes)


@router.get("/progress/metrics")
def get_progress_metrics(
    patient: CurrentPatient,
    session: SessionDep,
    ids: Annotated[
        str | None,
        Query(
            max_length=200,
            description="Comma-separated catalogue ids, such as K1,K6; every measure if left out",
        ),
    ] = None,
) -> list[MetricSeries]:
    """Each measure over the patient's own completed sessions, oldest first; trial measures have
    one series per game. Unknown ids are 422."""
    wanted = None
    if ids is not None:
        wanted = [item.strip() for item in ids.split(",") if item.strip()]
        unknown = [item for item in wanted if get_metric(item) is None]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown metric ids: {', '.join(unknown)}",
            )
    assert patient.id is not None
    return progress.metric_series(session, patient.id, wanted)


@router.get("/calibration/latest")
def latest_calibration(patient: CurrentPatient, session: SessionDep) -> CalibrationRead:
    assert patient.id is not None
    calibration = sessions.get_latest_calibration(session, patient.id)
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No calibration yet")
    return CalibrationRead.model_validate(calibration)


@router.patch("/profile")
def update_own_profile(
    payload: OwnProfileUpdate, patient: CurrentPatient, session: SessionDep
) -> PatientProfileRead:
    """The patient's own language (the interface and their feedback reports follow it) and
    whether numbers use Bengali digits."""
    if payload.language is not None:
        patient.language = payload.language
    if payload.bengali_digits is not None:
        patient.bengali_digits = payload.bengali_digits
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patients.profile_read(session, patient)


@router.get("/programme")
def get_own_programme(patient: CurrentPatient, session: SessionDep) -> PatientProgrammeRead:
    """What the browser needs from the patient's programme. Read-only: only an admin changes
    it."""
    return programmes.to_patient_read(session, programmes.programme_for(session, patient))


@router.get("/emg-calibration/latest")
def latest_emg_calibration(patient: CurrentPatient, session: SessionDep) -> EmgCalibrationRead:
    """The patient's latest muscle-sensor calibration, or 404."""
    assert patient.id is not None
    calibration = emg.latest_calibration(session, patient.id)
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No EMG calibration yet")
    return EmgCalibrationRead.model_validate(calibration)


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
