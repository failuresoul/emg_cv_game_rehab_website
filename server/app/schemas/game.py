from typing import Annotated, Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import UtcDatetime

GameId = Literal[
    "reach_activate",
    "balloon_pop",
    "fruit_catch",
    "bloom",
    "finger_piano",
    "path_trace",
    "paint_wall",
    "pick_place",
    "grip_hold",
]
GAME_IDS: tuple[str, ...] = get_args(GameId)
GameEngine = Literal["L0", "L1", "L2"]
InputSource = Literal["cv_grip", "keyboard", "emg"]
GameRunStatus = Literal["active", "completed", "aborted"]
#: "miss" is for games where a target leaves by itself, such as a balloon floating away.
TrialOutcome = Literal["success", "reach_fail", "activation_fail", "miss", "aborted"]

MAX_TRIALS_PER_BATCH = 50
MAX_TRAJECTORY_POINTS = 2000
MAX_TRIALS_PER_RUN = 500

NonNegative = Annotated[float, Field(ge=0)]
Share = Annotated[float, Field(ge=0, le=1)]
#: [t_ms, x_sw, y_sw]. t_ms is relative to the trial's spawn.
TrajectoryPoint = tuple[float, float, float]


class GameRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    game_id: GameId
    engine: GameEngine = "L0"
    input_source: InputSource
    params_initial: dict[str, Any] = Field(default_factory=dict)
    trials_planned: int = Field(ge=1, le=MAX_TRIALS_PER_RUN)


class TrialTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    x_sw: float
    y_sw: float
    radius_sw: float = Field(gt=0)
    direction_deg: float = Field(ge=0, lt=360)
    #: Distance as a share of the calibrated reach radius in that direction.
    distance_frac: float = Field(ge=0, le=2)
    #: Direction and ring, for example "D3R2".
    sector: str = Field(pattern=r"^D\d{1,2}R\d{1,2}$")


class TrialTimings(BaseModel):
    """Milliseconds relative to spawn. Empty when the trial never reached that moment."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    spawn: NonNegative = 0.0
    move_onset: NonNegative | None = None
    enter: NonNegative | None = None
    dwell_done: NonNegative | None = None
    activation_start: NonNegative | None = None
    activation_done: NonNegative | None = None
    end: NonNegative | None = None


class TrialMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    reaction_ms: NonNegative | None = None
    movement_ms: NonNegative | None = None
    path_length_sw: NonNegative | None = None
    straight_dist_sw: NonNegative | None = None
    path_efficiency: Share | None = None
    peak_speed_sw_s: NonNegative | None = None
    activation_latency_ms: NonNegative | None = None
    activation_peak: Share | None = None
    #: The highest the affected arm was raised during the trial, from the body (0 is down).
    peak_arm_elevation_deg: Annotated[float, Field(ge=0, le=180)] | None = None
    #: Side-to-side games: how far the hand had to move at the start, along x.
    lateral_distance_sw: NonNegative | None = None
    #: Side-to-side games: straight sideways distance over sideways path length, 0–1.
    lateral_path_efficiency: Share | None = None
    #: Side-to-side games: how far the hand went past the target before coming back.
    overshoot_sw: NonNegative | None = None
    #: Side-to-side games: "out" away from the body, "across" towards the other side.
    side: Literal["out", "across"] | None = None


class TrialCompensation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    flagged: bool = False
    type: str | None = Field(default=None, max_length=50)
    #: Largest value of each compensation measure during the trial, for example trunk_lean.
    max_values: dict[str, float] = Field(default_factory=dict, max_length=20)


class TrialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    trial_no: int = Field(ge=1, le=MAX_TRIALS_PER_RUN)
    params: dict[str, Any] = Field(default_factory=dict)
    target: TrialTarget | None = None
    outcome: TrialOutcome
    timings: TrialTimings = Field(default_factory=TrialTimings)
    metrics: TrialMetrics = Field(default_factory=TrialMetrics)
    compensation: TrialCompensation = Field(default_factory=TrialCompensation)
    trajectory: list[TrajectoryPoint] = Field(
        default_factory=list, max_length=MAX_TRAJECTORY_POINTS
    )


class TrialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_run_id: int
    trial_no: int
    params: dict[str, Any]
    target: TrialTarget | None
    outcome: TrialOutcome
    timings: TrialTimings
    metrics: TrialMetrics
    compensation: TrialCompensation
    trajectory: list[TrajectoryPoint]
    created_at: UtcDatetime


class GameSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    successes: int = Field(ge=0)
    success_rate: Share
    mean_movement_ms: NonNegative | None = None
    mean_path_efficiency: Share | None = None
    compensated_trials: int = Field(ge=0)


class GameRunEnd(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    status: Literal["completed", "aborted"]
    score: NonNegative
    summary: GameSummary | None = None


class GameRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    game_id: GameId
    engine: GameEngine
    input_source: InputSource
    params_initial: dict[str, Any]
    started_at: UtcDatetime
    ended_at: UtcDatetime | None
    status: GameRunStatus
    trials_planned: int
    trials_done: int
    score: float | None
    summary: GameSummary | None


class GameRunDetail(GameRunRead):
    trials: list[TrialRead]


class LastSessionGame(BaseModel):
    game_id: GameId
    score: float | None
    success_rate: float | None
