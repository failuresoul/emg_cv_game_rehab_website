from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.game import NonNegative, Share, TrialOutcome

Cue = Literal["posture", "encourage", "rest", "finish_soon", "finish"]
FailureType = Literal["reach_fail", "activation_fail", "miss"]


class LastTrial(BaseModel):
    """The trial just played, as the engine and the safety rules need it."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    trial_no: Annotated[int, Field(ge=1, le=500)]
    outcome: TrialOutcome
    #: Which kind of failure it was, when the outcome alone does not say; the outcome if left out.
    failure_type: FailureType | None = None
    compensated: bool = False
    movement_ms: NonNegative | None = None
    #: For games without a movement time: start to end of the trial.
    completion_ms: NonNegative | None = None
    #: Grip and activation games: the highest level reached, 0-1.
    activation_peak: Share | None = None
    #: Where the target was (spatial games), so L2 credits the sector actually played.
    direction_deg: Annotated[float, Field(ge=0, lt=360)] | None = None
    distance_frac: Annotated[float, Field(ge=0, le=2)] | None = None
    #: Fruit catch: which side the fruit fell on.
    side: Literal["out", "across"] | None = None


class EngineNextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: int
    #: None for the first trial of the run.
    last_trial: LastTrial | None = None


class EngineNextResponse(BaseModel):
    #: Every setting of the next trial.
    params: dict[str, float]
    #: The difficulty as a level from 1 to 10, for the patient.
    level: Annotated[int, Field(ge=1, le=10)]
    cue: Cue | None
    #: The engine's decision in plain words (admin and research only; not for patients).
    decision: str
    safety_override: str | None
    engine: str
    #: Where the next target goes, when the engine chooses it (L2, spatial games); else None.
    direction_deg: float | None = None
    distance_frac: float | None = None
    #: The target's workspace sector, such as "D2R3" (or "out-R2" in Fruit catch).
    sector: str | None = None
    side: Literal["out", "across"] | None = None
