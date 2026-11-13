from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
    model_validator,
    SerializerFunctionWrapHandler,
)

from app.schemas.emg import EmgDeviceInfo
from app.schemas.common import Side, UtcDatetime
from app.schemas.game import GameId, GameRunDetail, LastSessionGame
from app.schemas.metrics import SessionMetricRead
from app.schemas.session_feedback import SafetyFlag, SessionFeedbackRead
from app.schemas.warmup import WarmupResultRead, WarmupSummary

SessionStatus = Literal["active", "completed", "aborted"]
SessionStep = Literal[
    "setup", "emg", "calibrate", "warmup", "plan", "game", "cooldown", "summary"
]
MAX_QUEUED_GAMES = 20
Point = tuple[float, float]
ReachRadius = Annotated[float, Field(ge=0.2, le=3.0)]

DIRECTIONS_DEG = [0, 45, 90, 135, 180, 225, 270, 315]
DIRECTION_COUNT = len(DIRECTIONS_DEG)


class DeviceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    browser: str | None = None
    fps: float | None = None
    delegate: Literal["GPU", "CPU"] | None = None
    #: The muscle sensor, when the session uses it.
    emg: EmgDeviceInfo | None = None

    @model_serializer(mode="wrap")
    def _leave_out_no_sensor(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """Sessions without the muscle sensor keep their old shape: {browser, fps, delegate}."""
        data: dict[str, Any] = handler(self)
        if data.get("emg") is None:
            data.pop("emg", None)
        return data


class SessionStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_info: DeviceInfo | None = None
    notes: str | None = None


class SessionEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "aborted"]


class GameQueueState(BaseModel):
    """Today's games in order, and the one being played: index equals len(games) once done."""

    model_config = ConfigDict(extra="forbid")

    games: list[GameId] = Field(min_length=1, max_length=MAX_QUEUED_GAMES)
    index: int = Field(ge=0, strict=True)
    #: Trials per game from the plan, when it set them (5-40); the Game Library's otherwise.
    trials: dict[GameId, Annotated[int, Field(ge=5, le=40)]] | None = None

    @model_serializer(mode="wrap")
    def _leave_out_empty_trials(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """Queues without planned trials keep their old shape: {games, index}."""
        data: dict[str, Any] = handler(self)
        if data.get("trials") is None:
            data.pop("trials", None)
        return data

    @model_validator(mode="after")
    def index_within_queue(self) -> Self:
        if self.index > len(self.games):
            raise ValueError("index must be at most the number of games")
        return self


class SessionProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_step: SessionStep | None = None
    game_queue: GameQueueState | None = None

    @model_validator(mode="after")
    def something_to_update(self) -> Self:
        if self.current_step is None and self.game_queue is None:
            raise ValueError("Send current_step, game_queue or both")
        return self


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    started_at: UtcDatetime
    ended_at: UtcDatetime | None
    status: SessionStatus
    device_info: DeviceInfo | None
    notes: str | None
    current_step: SessionStep = "setup"
    game_queue: GameQueueState | None = None


class SessionSummary(SessionRead):
    duration_seconds: float | None
    hull_area_sw2: float | None
    warmup_summary: WarmupSummary | None = None
    #: Finished game runs, in the order they were played.
    games: list[LastSessionGame] = Field(default_factory=list)


class LastSession(BaseModel):
    date: UtcDatetime
    status: SessionStatus
    duration_seconds: float | None
    warmup_summary: WarmupSummary | None = None
    #: Finished game runs, in the order they were played.
    games: list[LastSessionGame] = Field(default_factory=list)


class CalibrationQuality(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    valid: list[bool] = Field(min_length=DIRECTION_COUNT, max_length=DIRECTION_COUNT)
    retries: int = Field(ge=0)
    max_trunk_displacement_sw: float = Field(ge=0)


class CalibrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    affected_side: Side
    shoulder_width_px: float = Field(gt=0)
    directions_deg: list[float]
    reach_radii_sw: list[ReachRadius] = Field(
        min_length=DIRECTION_COUNT, max_length=DIRECTION_COUNT
    )
    reach_points_sw: list[Point] = Field(min_length=DIRECTION_COUNT, max_length=DIRECTION_COUNT)
    hull_sw: list[Point] = Field(min_length=3)
    hull_area_sw2: float = Field(gt=0)
    quality: CalibrationQuality

    @field_validator("directions_deg")
    @classmethod
    def directions_must_be_the_eight_standard_angles(cls, value: list[float]) -> list[float]:
        if value != DIRECTIONS_DEG:
            raise ValueError(f"directions_deg must be {DIRECTIONS_DEG}")
        return value


class CalibrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    affected_side: Side
    shoulder_width_px: float
    directions_deg: list[float]
    reach_radii_sw: list[float]
    reach_points_sw: list[Point]
    hull_sw: list[Point]
    hull_area_sw2: float
    quality: CalibrationQuality
    created_at: UtcDatetime


class SessionDetail(SessionSummary):
    calibration: CalibrationRead | None


class AdminCalibrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    created_at: UtcDatetime
    reach_radii_sw: list[float]
    hull_sw: list[Point]
    hull_area_sw2: float


class LatestCalibration(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    hull_sw: list[Point]
    hull_area_sw2: float


class AdminSessionDetail(SessionRead):
    """Everything recorded in one session, including every trial's trajectory."""

    patient_code: str
    patient_name: str
    duration_seconds: float | None
    calibration: CalibrationRead | None
    warmup_results: list[WarmupResultRead]
    games: list[GameRunDetail]
    #: The cool-down questionnaire, or null if it was not submitted.
    feedback: SessionFeedbackRead | None = None
    flags: list[SafetyFlag] = Field(default_factory=list)
    needs_review: bool = False
    reviewed_at: UtcDatetime | None = None
    review_note: str | None = None
    #: The session's catalogue measures, by metric id then game; empty until computed.
    session_metrics: list[SessionMetricRead] = Field(default_factory=list)


class AdminRecentSession(BaseModel):
    """A row of the admin overview's recent sessions."""

    id: int
    patient_id: int
    patient_code: str
    patient_name: str
    started_at: UtcDatetime
    status: SessionStatus
    duration_seconds: float | None
    #: Finished game runs, in the order they were played.
    games: list[LastSessionGame]
