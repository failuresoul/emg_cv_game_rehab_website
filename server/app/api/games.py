from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, status

from app.api.deps import CurrentPatient, SessionDep
from app.models import GameRun
from app.models import Session as SessionRecord
from app.schemas.game import (
    MAX_TRIALS_PER_BATCH,
    GameRunEnd,
    GameRunRead,
    GameRunStart,
    TrialCreate,
)
from app.services import games, sessions

router = APIRouter(tags=["games"])


def _get_own_session_or_404(
    session: SessionDep, patient: CurrentPatient, session_id: int
) -> SessionRecord:
    assert patient.id is not None
    record = sessions.get_own_session(session, patient.id, session_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return record


def _get_own_run_or_404(session: SessionDep, patient: CurrentPatient, run_id: int) -> GameRun:
    assert patient.id is not None
    run = games.get_own_run(session, patient.id, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game run not found")
    return run


def _run_ended() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Game run has already ended")


@router.post("/sessions/{session_id}/games", status_code=status.HTTP_201_CREATED)
def start_game(
    session_id: int, payload: GameRunStart, session: SessionDep, patient: CurrentPatient
) -> GameRunRead:
    """Any run still open in this session is marked aborted: one game is played at a time."""
    record = _get_own_session_or_404(session, patient, session_id)
    try:
        run = games.start_run(session, record, payload)
    except sessions.SessionEndedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Session has already ended"
        ) from None
    return GameRunRead.model_validate(run)


@router.get("/sessions/{session_id}/games")
def list_games(session_id: int, session: SessionDep, patient: CurrentPatient) -> list[GameRunRead]:
    record = _get_own_session_or_404(session, patient, session_id)
    assert record.id is not None
    return [GameRunRead.model_validate(run) for run in games.list_session_runs(session, record.id)]


@router.post("/games/{run_id}/trials")
def save_trials(
    run_id: int,
    payload: Annotated[list[TrialCreate], Body(min_length=1, max_length=MAX_TRIALS_PER_BATCH)],
    session: SessionDep,
    patient: CurrentPatient,
) -> GameRunRead:
    """Saving a trial_no again replaces the earlier trial. Returns the run with trials_done."""
    run = _get_own_run_or_404(session, patient, run_id)
    try:
        run = games.save_trials(session, run, payload)
    except games.GameRunEndedError:
        raise _run_ended() from None
    except games.DuplicateTrialError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Each trial_no may appear only once",
        ) from None
    except games.TrialConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Trials were saved at the same time"
        ) from None
    return GameRunRead.model_validate(run)


@router.post("/games/{run_id}/end")
def end_game(
    run_id: int, payload: GameRunEnd, session: SessionDep, patient: CurrentPatient
) -> GameRunRead:
    run = _get_own_run_or_404(session, patient, run_id)
    try:
        return GameRunRead.model_validate(games.end_run(session, run, payload))
    except games.GameRunEndedError:
        raise _run_ended() from None
