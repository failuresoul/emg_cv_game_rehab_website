from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)

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
MAX_TARGET_NOTES = 64
MAX_TRIALS_PER_RUN = 500

NonNegative = Annotated[float, Field(ge=0)]
SummaryDetail = float | Annotated[str, Field(max_length=50)] | bool | None
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


#: The fields that place a target in the body frame. A target has all of them or none.
SPATIAL_TARGET_FIELDS = ("x_sw", "y_sw", "radius_sw", "direction_deg", "distance_frac", "sector")
TargetKind = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,29}$")]
TargetNote = Annotated[str, Field(min_length=1, max_length=20)]


class TrialTarget(BaseModel):
    """What a trial asked for.

    Reaching games give a place in the body frame (every spatial field). Hand games, which have no
    place, give a kind instead, for example {"kind": "bloom"} or
    {"kind": "sequence", "notes": ["index", "ring"]}. Fields left out are not saved or returned.
    """

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    #: What sort of target this is, such as "bloom" or "sequence". Required without a place.
    kind: TargetKind | None = None
    x_sw: float | None = None
    y_sw: float | None = None
    radius_sw: Annotated[float, Field(gt=0)] | None = None
    direction_deg: Annotated[float, Field(ge=0, lt=360)] | None = None
    #: Distance as a share of the calibrated reach radius in that direction.
    distance_frac: Annotated[float, Field(ge=0, le=2)] | None = None
    #: Direction and ring, for example "D3R2".
    sector: Annotated[str, Field(pattern=r"^D\d{1,2}R\d{1,2}$")] | None = None
    #: A sequence to play, such as finger names, in order.
    notes: Annotated[list[TargetNote], Field(min_length=1, max_length=MAX_TARGET_NOTES)] | None = (
        None
    )

    @model_validator(mode="after")
    def _spatial_or_kind(self) -> "TrialTarget":
        given = [name for name in SPATIAL_TARGET_FIELDS if getattr(self, name) is not None]
        if given and len(given) != len(SPATIAL_TARGET_FIELDS):
            missing = [name for name in SPATIAL_TARGET_FIELDS if name not in given]
            raise ValueError(f"a placed target needs every spatial field; missing {missing}")
        if not given and self.kind is None:
            raise ValueError("a target without a place needs a kind")
        return self

    @property
    def is_spatial(self) -> bool:
        return self.x_sw is not None

    @model_serializer(mode="wrap")
    def _drop_empty(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        return {key: value for key, value in data.items() if value is not None}


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
    #: Hand-opening games: spawn to the start of the hold that made the flower bloom.
    time_to_open_ms: NonNegative | None = None
    #: Hand-opening games: the highest openness, from 0 (fist) to 1 (fully open).
    peak_openness: Share | None = None
    #: Hand-opening games: standard deviation of openness during the successful hold.
    hold_stability: Share | None = None
    #: Hand-opening games: closing phase start to the start of the grip hold that succeeded.
    time_to_close_ms: NonNegative | None = None
    #: Hand-opening games: the highest grip level in the closing phase.
    peak_grip: Share | None = None
    #: Hand-opening games: how fast the hand opened, in openness level per second.
    openness_rise_rate: NonNegative | None = None
    #: Games with phases: which phase ran out of time; empty for a success.
    failed_phase: Literal["open", "close"] | None = None


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
    #: Figures only one game has, such as the highest balloon popped. Up to 20, each a number,
    #: text (up to 50 characters), true/false or null.
    details: dict[str, SummaryDetail] = Field(default_factory=dict, max_length=20)


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
