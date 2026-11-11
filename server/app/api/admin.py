from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import SessionDep, TzOffset, require_admin
from app.models import PatientProfile, User
from app.models import Session as SessionRecord
from app.schemas.game import MetricsRecomputeRead
from app.schemas.game_setting import AdminGameRead, GameSettingUpdate
from app.schemas.metrics import PatientMetrics
from app.schemas.patient import AdminStats, PatientCreate, PatientRead, PatientUpdate
from app.schemas.session import (
    AdminCalibrationRead,
    AdminRecentSession,
    AdminSessionDetail,
    SessionSummary,
)
from app.schemas.progress import PatientProgress
from app.schemas.session_feedback import AdminAlert, AlertReview
from app.schemas.warmup import AdminWarmupHistory, ExerciseId
from app.services import (
    game_settings,
    games,
    patients,
    progress,
    session_feedback,
    session_metrics,
    sessions,
    trial_metrics,
    warmup,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _get_patient_or_404(session: SessionDep, patient_id: int) -> tuple[PatientProfile, User]:
    patient = patients.get_patient(session, patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return patient


def _duplicate_email() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")


@router.get("/patients")
def list_patients(session: SessionDep, search: str | None = None) -> list[PatientRead]:
    return patients.list_patients(session, search)


@router.post("/patients", status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate, session: SessionDep) -> PatientRead:
    try:
        return patients.create_patient(session, payload)
    except patients.DuplicateEmailError:
        raise _duplicate_email() from None


@router.get("/patients/{patient_id}")
def get_patient(patient_id: int, session: SessionDep) -> PatientRead:
    profile, user = _get_patient_or_404(session, patient_id)
    return patients.to_patient_read(profile, user)


@router.patch("/patients/{patient_id}")
def update_patient(patient_id: int, payload: PatientUpdate, session: SessionDep) -> PatientRead:
    profile, user = _get_patient_or_404(session, patient_id)
    try:
        return patients.update_patient(session, profile, user, payload)
    except patients.DuplicateEmailError:
        raise _duplicate_email() from None


@router.post("/patients/{patient_id}/deactivate")
def deactivate_patient(patient_id: int, session: SessionDep) -> PatientRead:
    profile, user = _get_patient_or_404(session, patient_id)
    return patients.set_patient_active(session, profile, user, False)


@router.post("/patients/{patient_id}/activate")
def activate_patient(patient_id: int, session: SessionDep) -> PatientRead:
    profile, user = _get_patient_or_404(session, patient_id)
    return patients.set_patient_active(session, profile, user, True)


@router.get("/patients/{patient_id}/sessions")
def list_patient_sessions(patient_id: int, session: SessionDep) -> list[SessionSummary]:
    _get_patient_or_404(session, patient_id)
    return sessions.list_sessions(session, patient_id)


@router.get("/patients/{patient_id}/progress")
def get_patient_progress(
    patient_id: int, session: SessionDep, tz_offset_minutes: TzOffset = 0
) -> PatientProgress:
    """As GET /api/patient/progress, for one patient."""
    profile, _ = _get_patient_or_404(session, patient_id)
    return progress.get_progress(session, profile, tz_offset_minutes)


@router.get("/patients/{patient_id}/metrics")
def get_patient_metrics(patient_id: int, session: SessionDep) -> PatientMetrics:
    """Each catalogue measure: baseline, latest, change against the (provisional) MDC and
    status, with every series behind them."""
    profile, _ = _get_patient_or_404(session, patient_id)
    assert profile.id is not None
    return progress.patient_metrics(session, profile.id)


@router.get("/patients/{patient_id}/calibrations")
def list_patient_calibrations(patient_id: int, session: SessionDep) -> list[AdminCalibrationRead]:
    _get_patient_or_404(session, patient_id)
    return [
        AdminCalibrationRead.model_validate(calibration)
        for calibration in sessions.list_calibrations(session, patient_id)
    ]


@router.get("/patients/{patient_id}/warmup")
def list_patient_warmup(
    patient_id: int, session: SessionDep, exercise_id: ExerciseId | None = None
) -> list[AdminWarmupHistory]:
    """Per exercise, oldest first, without skipped exercises."""
    _get_patient_or_404(session, patient_id)
    return warmup.get_admin_history(session, patient_id, exercise_id)


@router.get("/sessions")
def list_recent_sessions(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[AdminRecentSession]:
    """Every patient's sessions, newest first, with their finished games."""
    return games.list_recent_sessions(session, limit)


@router.get("/sessions/{session_id}")
def get_session_detail(session_id: int, session: SessionDep) -> AdminSessionDetail:
    """Everything recorded in one session, including every trial's trajectory."""
    record = session.get(SessionRecord, session_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return games.get_admin_session_detail(session, record)


@router.get("/alerts")
def list_alerts(session: SessionDep, reviewed: bool | None = None) -> list[AdminAlert]:
    """Sessions whose questionnaire raised a safety flag, newest first."""
    return session_feedback.list_alerts(session, reviewed)


@router.post("/alerts/{session_id}/review")
def review_alert(
    session_id: int, session: SessionDep, payload: AlertReview | None = None
) -> AdminAlert:
    try:
        return session_feedback.review_alert(
            session, session_id, payload.note if payload else None
        )
    except session_feedback.AlertNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        ) from None
    except session_feedback.AlreadyReviewedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Alert already reviewed"
        ) from None


@router.get("/stats")
def stats(session: SessionDep) -> AdminStats:
    return patients.get_stats(session)


def _unknown_game() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")


@router.get("/games")
def list_game_settings(session: SessionDep) -> list[AdminGameRead]:
    """Every game's spec with the admin's setting, in the registry's order."""
    return game_settings.list_admin(session)


@router.put("/games/{game_id}")
def update_game_setting(
    game_id: str, payload: GameSettingUpdate, session: SessionDep
) -> AdminGameRead:
    """Replaces the game's setting. Each default must be a setting of the game, within its range."""
    try:
        return game_settings.update(session, game_id, payload)
    except game_settings.UnknownGameError:
        raise _unknown_game() from None
    except game_settings.InvalidSettingError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from None


@router.post("/games/{game_id}/reset")
def reset_game_setting(game_id: str, session: SessionDep) -> AdminGameRead:
    """Back to the game's own defaults and trials, enabled."""
    try:
        return game_settings.reset(session, game_id)
    except game_settings.UnknownGameError:
        raise _unknown_game() from None


@router.post("/metrics/recompute")
def recompute_metrics(session: SessionDep, session_id: int | None = None) -> MetricsRecomputeRead:
    """Recomputes the server's measures of every trial, then each session's catalogue measures,
    of one session or of every session when `session_id` is left out. Safe to run again: the
    results are replaced."""
    try:
        result = trial_metrics.recompute(session, session_id)
    except trial_metrics.SessionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        ) from None
    rows = session_metrics.compute_for_sessions(
        session, None if session_id is None else [session_id]
    )
    return MetricsRecomputeRead(
        sessions=result.sessions,
        runs=result.runs,
        trials=result.trials,
        mismatched_trials=result.mismatched_trials,
        session_metrics=rows,
    )
