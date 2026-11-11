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
MAX_TARGET_POINTS = 200
MAX_TRIALS_PER_RUN = 500

NonNegative = Annotated[float, Field(ge=0)]
SummaryDetail = float | Annotated[str, Field(max_length=50)] | bool | None
Share = Annotated[float, Field(ge=0, le=1)]
Percent = Annotated[float, Field(ge=0, le=100)]
Degrees = Annotated[float, Field(ge=0, le=180)]
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
#: [x_sw, y_sw]: a point in the body frame.
PointSw = tuple[float, float]
PositiveSw = Annotated[float, Field(gt=0, le=5)]


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
    #: A drawn target's shape, such as "s_curve" for a path to follow.
    shape: TargetKind | None = None
    #: A drawn target's points in SW, such as a path to follow, in order.
    points: (
        Annotated[list[tuple[float, float]], Field(min_length=2, max_length=MAX_TARGET_POINTS)]
        | None
    ) = None
    #: A target's place in a row, from 0, such as a wall stripe's.
    index: Annotated[int, Field(ge=0, le=MAX_TRIALS_PER_RUN, strict=True)] | None = None
    #: A target's height or size as a share, such as a stripe's share of the elbow range.
    target_frac: Share | None = None
    #: Carrying games: where the object is picked up and where it is put down, in SW.
    pick: PointSw | None = None
    place: PointSw | None = None
    #: Carrying games: the object's radius and the box's width, in SW.
    object_radius_sw: PositiveSw | None = None
    box_size_sw: PositiveSw | None = None
    #: Level games: the middle and the width of the band of levels to hold, from 0 to 1.
    center: Share | None = None
    width: Share | None = None

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


Finger = Literal["index", "middle", "ring", "little"]
Count = Annotated[int, Field(ge=0, le=MAX_TARGET_NOTES)]


class FingerTally(BaseModel):
    """One finger's notes in a melody: how many it played, of how many it was asked for."""

    model_config = ConfigDict(extra="forbid")

    hits: Count
    attempts: Count

    @model_validator(mode="after")
    def _hits_within_attempts(self) -> "FingerTally":
        if self.hits > self.attempts:
            raise ValueError("hits cannot exceed attempts")
        return self


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
    failed_phase: Literal["open", "close", "hold", "relax"] | None = None
    #: Tracing games: mean distance from the moving guide, in SW.
    mean_tracking_error_sw: NonNegative | None = None
    #: Tracing games: mean distance from the path, in SW.
    mean_path_error_sw: NonNegative | None = None
    #: Tracing games: share of the trace inside the corridor, 0-100.
    time_in_corridor_pct: Percent | None = None
    #: Tracing games: mean delay behind the guide, in ms; negative when ahead of it.
    lag_ms: float | None = None
    #: Tracing games: share of the path followed inside the corridor, 0-100.
    coverage_pct: Percent | None = None
    #: Smoothness of the fingertip's speed (SPARC): 0 or less, closer to 0 is smoother.
    sparc: Annotated[float, Field(le=0)] | None = None
    #: Elbow games: most straight minus most bent elbow angle reached, in degrees.
    achieved_range_deg: Degrees | None = None
    #: Elbow games: the most bent elbow angle reached (the smallest), in degrees.
    max_bend_deg: Degrees | None = None
    #: Elbow games: the most straight elbow angle reached (the largest), in degrees.
    max_straight_deg: Degrees | None = None
    #: Elbow games: sweeps that reached the target, and those that did not.
    full_sweeps: Annotated[int, Field(ge=0, le=1000)] | None = None
    partial_sweeps: Annotated[int, Field(ge=0, le=1000)] | None = None
    #: Elbow games: mean duration of the full sweeps, in ms.
    mean_sweep_ms: NonNegative | None = None
    #: Smoothness of the elbow's angular speed (SPARC): 0 or less.
    angular_sparc: Annotated[float, Field(le=0)] | None = None
    #: Elbow games: the most the upper arm moved from its start during a sweep, in degrees.
    upper_arm_motion_deg: Degrees | None = None
    #: Carrying games: spawn to the hand first reaching the object, in ms.
    reach_ms: NonNegative | None = None
    #: Carrying games: object first reached to the first grasp, in ms.
    grasp_latency_ms: NonNegative | None = None
    #: Carrying games: the last grasp to the release in the box, in ms.
    transport_ms: NonNegative | None = None
    #: Carrying games: straight distance over path length of the carry that succeeded, 0-1.
    transport_path_efficiency: Share | None = None
    #: Carrying games: times the object was let go outside the box.
    drops: Annotated[int, Field(ge=0, le=1000, strict=True)] | None = None
    #: Carrying games: distance from the box's centre at the release, in SW.
    release_error_sw: NonNegative | None = None
    #: Holding games: spawn to the level first entering the band, in ms.
    time_to_band_ms: NonNegative | None = None
    #: Holding games: share of the holding phase spent inside the band, 0-100.
    time_in_band_pct: Percent | None = None
    #: Holding games: the longest stretch inside the band without leaving it, in ms.
    longest_continuous_hold_ms: NonNegative | None = None
    #: Holding games: times the level went above the band, and the most it went above, 0-1.
    overshoot_count: Annotated[int, Field(ge=0, le=1000, strict=True)] | None = None
    max_overshoot: Share | None = None
    #: Holding games: standard deviation of the level while inside the band, 0-1.
    steadiness: Share | None = None
    #: Holding games: the relax prompt to the level first falling below the relax level, in ms.
    relaxation_ms: NonNegative | None = None
    #: Where the level came from in this trial: the camera, the keyboard or a muscle sensor.
    input_source: InputSource | None = None
    #: Sequence games: notes in the melody, and how each ended. hits + wrong_finger + missed is
    #: notes_total.
    notes_total: Count | None = None
    hits: Count | None = None
    #: Notes not played, with only wrong fingers touched in their window.
    wrong_finger: Count | None = None
    #: Notes with no touch at all.
    missed: Count | None = None
    hit_rate: Share | None = None
    #: Mean of |touch - arrival| over the notes played, in ms.
    mean_timing_error_ms: NonNegative | None = None
    per_finger: dict[Finger, FingerTally] | None = None

    @model_validator(mode="after")
    def _notes_add_up(self) -> "TrialMetrics":
        parts = (self.hits, self.wrong_finger, self.missed)
        if self.notes_total is not None and all(part is not None for part in parts):
            if sum(part for part in parts if part is not None) != self.notes_total:
                raise ValueError("hits, wrong_finger and missed must add up to notes_total")
        return self


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
    #: The server's own measures and the data quality; null until computed.
    metrics_server: dict[str, Any] | None = None
    data_quality: dict[str, Any] | None = None
    created_at: UtcDatetime


class MetricsRecomputeRead(BaseModel):
    """What an admin's recomputation of the server's trial measures covered."""

    sessions: int
    runs: int
    trials: int
    #: Trials where a server measure differs from the client's by more than 10%.
    mismatched_trials: int
    #: Session metric rows saved (one per catalogue measure, and per game for trial measures).
    session_metrics: int = 0


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
