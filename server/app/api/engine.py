from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentPatient, SessionDep
from app.schemas.engine import EngineNextRequest, EngineNextResponse
from app.services import adaptation, games

router = APIRouter(prefix="/engine", tags=["engine"])


@router.post("/next")
def next_trial(
    payload: EngineNextRequest, session: SessionDep, patient: CurrentPatient
) -> EngineNextResponse:
    """The next trial's settings for the patient's own run, after learning from the last trial
    and applying the safety rules. The first call (no last trial) starts the run where the
    patient left off, eased a little in a new session. Sending the same trial again gives the
    same answer."""
    assert patient.id is not None
    run = games.get_own_run(session, patient.id, payload.run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game run not found")
    try:
        answer = adaptation.next_step(session, patient, run, payload.last_trial)
    except adaptation.RunEndedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Game run has already ended"
        ) from None
    if run.study_id is not None:
        # Research mode: the decision log keeps everything; the patient learns nothing of the
        # condition (the level and cues look the same in every condition).
        answer = answer.model_copy(update={"engine": None, "decision": "", "safety_override": None})
    return answer
