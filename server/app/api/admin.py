from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import col, select

from app.api.deps import SessionDep, TzOffset, require_admin
from app.models import PatientProfile, User
from app.models import Session as SessionRecord
from app.schemas.emg import EmgCalibrationRead
from app.schemas.game import MetricsRecomputeRead
from app.schemas.game_setting import AdminGameRead, GameSettingUpdate
from app.schemas.metrics import GameLevel, PatientLevels, PatientMetrics
from app.schemas.patient import AdminStats, PatientCreate, PatientRead, PatientUpdate
from app.schemas.plan import LatestPlan, PlanOverrideRead, SessionPlan
from app.schemas.programme import ProgrammeChangeRead, ProgrammeRead, ProgrammeUpdate
from app.schemas.session import (
    AdminCalibrationRead,
    AdminRecentSession,
    AdminSessionDetail,
    SessionSummary,
)
from app.schemas.progress import PatientProgress
from app.schemas.alert import AlertAction, AlertRead, AlertSeverity, AlertStatus, AlertType
from app.schemas.warmup import AdminWarmupHistory, ExerciseId
from app.services import alerts
from app.services import programme as programmes
from app.services import (
    emg,
    exports,
    game_settings,
    levels,
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
CurrentAdmin = Annotated[User, Depends(require_admin)]


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
    return patients.to_patient_read(session, profile, user)


@router.patch("/patients/{patient_id}")
def update_patient(
    patient_id: int, payload: PatientUpdate, session: SessionDep, admin: CurrentAdmin
) -> PatientRead:
    profile, user = _get_patient_or_404(session, patient_id)
    try:
        return patients.update_patient(session, profile, user, payload, admin_id=admin.id)
    except patients.DuplicateEmailError:
        raise _duplicate_email() from None
    except (programmes.LibraryDisabledError, ValueError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from None


@router.get("/patients/{patient_id}/programme")
def get_programme(patient_id: int, session: SessionDep) -> ProgrammeRead:
    """The patient's programme: games and their highest levels, session length, warm-up, AI
    engine, muscle-sensor site, weekly goal and notes."""
    profile, _ = _get_patient_or_404(session, patient_id)
    return programmes.to_read(session, programmes.programme_for(session, profile))


@router.put("/patients/{patient_id}/programme")
def put_programme(
    patient_id: int, payload: ProgrammeUpdate, session: SessionDep, admin: CurrentAdmin
) -> ProgrammeRead:
    """Replaces the programme; each changed field is kept in the history with the reason."""
    profile, _ = _get_patient_or_404(session, patient_id)
    programme = programmes.programme_for(session, profile)
    try:
        programmes.update(session, programme, payload, admin.id, payload.reason)
    except programmes.LibraryDisabledError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from None
    return programmes.to_read(session, programme)


@router.get("/patients/{patient_id}/programme/history")
def get_programme_history(patient_id: int, session: SessionDep) -> list[ProgrammeChangeRead]:
    """Every change of the programme, newest first."""
    profile, _ = _get_patient_or_404(session, patient_id)
    assert profile.id is not None
    return programmes.history(session, profile.id)


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


@router.get("/patients/{patient_id}/levels")
def get_patient_levels(patient_id: int, session: SessionDep) -> PatientLevels:
    """The patient's engine mode and current difficulty level in each game played with it."""
    profile, _ = _get_patient_or_404(session, patient_id)
    return PatientLevels(
        engine_mode=programmes.programme_for(session, profile).engine_mode,  # type: ignore[arg-type]
        games=[
            GameLevel(
                game_id=row.game_id,
                engine=row.engine,
                level=levels.level_of_state(row.state),
                d={key: float(value) for key, value in (row.state.get("d") or {}).items()},
                trials_seen=row.trials_seen,
                updated_at=row.updated_at,
            )
            for row in levels.patient_engine_states(session, profile)
        ],
    )


@router.get("/patients/{patient_id}/plan")
def get_patient_plan(patient_id: int, session: SessionDep) -> LatestPlan:
    """The patient's most recent session with a plan, its reasons and any changes they made."""
    profile, _ = _get_patient_or_404(session, patient_id)
    record = session.exec(
        select(SessionRecord)
        .where(SessionRecord.patient_id == profile.id, col(SessionRecord.plan).is_not(None))
        .order_by(col(SessionRecord.started_at).desc())
    ).first()
    if record is None:
        return LatestPlan(session_id=None, started_at=None, session_status=None, plan=None, overrides=[])
    return LatestPlan(
        session_id=record.id,
        started_at=record.started_at,
        session_status=record.status,
        plan=SessionPlan.model_validate(record.plan),
        overrides=[PlanOverrideRead.model_validate(item) for item in record.plan_overrides or []],
    )


@router.get("/patients/{patient_id}/calibrations")
def list_patient_calibrations(patient_id: int, session: SessionDep) -> list[AdminCalibrationRead]:
    _get_patient_or_404(session, patient_id)
    return [
        AdminCalibrationRead.model_validate(calibration)
        for calibration in sessions.list_calibrations(session, patient_id)
    ]


@router.get("/patients/{patient_id}/emg-calibrations")
def list_patient_emg_calibrations(patient_id: int, session: SessionDep) -> list[EmgCalibrationRead]:
    """The patient's muscle-sensor calibrations, newest first."""
    _get_patient_or_404(session, patient_id)
    return [
        EmgCalibrationRead.model_validate(calibration)
        for calibration in emg.list_calibrations(session, patient_id)
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
def list_alerts(
    session: SessionDep,
    status_: Annotated[list[AlertStatus] | None, Query(alias="status")] = None,
    type_: Annotated[list[AlertType] | None, Query(alias="type")] = None,
    severity: Annotated[list[AlertSeverity] | None, Query()] = None,
    patient: int | None = None,
    session_id: int | None = None,
) -> list[AlertRead]:
    """Every alert, newest first. Each filter may be repeated (?status=open&status=acknowledged)."""
    found = alerts.list_alerts(
        session,
        status=status_,
        type=type_,
        severity=severity,
        patient_id=patient,
        session_id=session_id,
    )
    return alerts.to_reads(session, found)


def _alert_action(
    session: SessionDep, alert_id: int, admin: User, payload: AlertAction | None, resolve: bool
) -> AlertRead:
    try:
        alert = alerts.get(session, alert_id)
        note = payload.note if payload else None
        if resolve:
            alert = alerts.resolve(session, alert, admin.id, note)
        else:
            alert = alerts.acknowledge(session, alert, admin.id, note)
    except alerts.AlertNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found") from None
    except alerts.AlertStateError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from None
    return alerts.to_reads(session, [alert])[0]


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int, session: SessionDep, admin: CurrentAdmin, payload: AlertAction | None = None
) -> AlertRead:
    """Open -> acknowledged (seen, being dealt with), with an optional note."""
    return _alert_action(session, alert_id, admin, payload, resolve=False)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(
    alert_id: int, session: SessionDep, admin: CurrentAdmin, payload: AlertAction | None = None
) -> AlertRead:
    """Open or acknowledged -> resolved (final), with an optional note."""
    return _alert_action(session, alert_id, admin, payload, resolve=True)


@router.post("/sessions/{session_id}/alerts/resolve")
def resolve_session_alerts(
    session_id: int, session: SessionDep, admin: CurrentAdmin, payload: AlertAction | None = None
) -> list[AlertRead]:
    """Resolves every unresolved alert of a session (the session page's "Mark reviewed")."""
    try:
        resolved = alerts.resolve_session(session, session_id, admin.id, payload.note if payload else None)
    except alerts.AlertNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No unresolved alerts for this session"
        ) from None
    return alerts.to_reads(session, resolved)


@router.get("/stats")
def stats(session: SessionDep) -> AdminStats:
    """The overview's counts. Loading the overview also runs the daily alert checks."""
    alerts.quietly(alerts.daily_checks, session)
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


def _csv(content: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/patients/{patient_id}/export.csv", response_class=Response)
def export_patient_metrics(patient_id: int, session: SessionDep) -> Response:
    """The patient's session measures, one row each (long format), by patient code only."""
    profile, _ = _get_patient_or_404(session, patient_id)
    content = exports.patient_metrics_csv(session, profile)
    return _csv(content, f"{profile.patient_code}-metrics.csv")


@router.get("/export/trials.csv", response_class=Response)
def export_trials(session: SessionDep) -> Response:
    """Every trial of every patient, one row each, by patient code only."""
    return _csv(exports.trials_csv(session), "muvi-rehab-trials.csv")
