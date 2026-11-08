from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import UtcDatetime

ExerciseId = Literal[
    "shoulder_flexion",
    "shoulder_abduction",
    "elbow_flexion",
    "forward_reach",
    "hand_open_close",
    "thumb_opposition",
]
WarmupPreset = Literal["standard", "gentle", "personal"]
# Angles in degrees; hand distances as a ratio of palm length.
ThresholdUnit = Literal["deg", "palm_ratio"]
MeasureSource = Literal["3d", "2d"]
TrunkReference = Literal["hip", "vertical", "n/a"]

Count = Annotated[int, Field(ge=0)]
Milliseconds = Annotated[float, Field(ge=0)]


class WarmupThresholds(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    low: float
    high: float
    unit: ThresholdUnit

    @model_validator(mode="after")
    def low_must_be_below_high(self) -> Self:
        if not self.low < self.high:
            raise ValueError("low must be below high")
        return self


class WarmupPersonalisation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    previous_high: float | None
    new_high: float
    reason: str = Field(min_length=1, max_length=200)


class WarmupRep(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    index: int = Field(ge=1)
    peak: float
    duration_ms: Milliseconds
    compensated: bool = False
    compensation_type: str | None = Field(default=None, max_length=50)


class WarmupResultCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    exercise_id: ExerciseId
    preset: WarmupPreset
    thresholds: WarmupThresholds
    personalisation: WarmupPersonalisation | None = None
    full_reps: Count
    partial_reps: Count
    target_reps: int = Field(ge=1)
    # Empty when nothing was recorded, for example a skipped exercise.
    best_peak: float | None = None
    mean_duration_ms: float | None = Field(default=None, ge=0)
    active_time_ms: Milliseconds
    paused_time_ms: Milliseconds
    measure_source: MeasureSource | None = None
    trunk_reference: TrunkReference | None = None
    compensated_reps: Count = 0
    compensation_rate: float = Field(default=0.0, ge=0, le=1)
    reps: list[WarmupRep] = Field(default_factory=list, max_length=500)
    skipped: bool = False

    @model_validator(mode="after")
    def compensated_reps_within_reps(self) -> Self:
        if self.compensated_reps > self.full_reps + self.partial_reps:
            raise ValueError("compensated_reps cannot exceed full_reps + partial_reps")
        return self


class WarmupResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    exercise_id: ExerciseId
    preset: WarmupPreset
    thresholds: WarmupThresholds
    personalisation: WarmupPersonalisation | None
    full_reps: int
    partial_reps: int
    target_reps: int
    best_peak: float | None
    mean_duration_ms: float | None
    active_time_ms: float
    paused_time_ms: float
    measure_source: MeasureSource | None
    trunk_reference: TrunkReference | None
    compensated_reps: int
    compensation_rate: float
    reps: list[WarmupRep]
    skipped: bool
    created_at: UtcDatetime


class WarmupSummary(BaseModel):
    """Skipped exercises are left out of every figure."""

    exercises_done: int
    total_reps: int
    mean_compensation_rate: float | None


class AdminWarmupPoint(BaseModel):
    session_id: int
    date: UtcDatetime
    preset: WarmupPreset
    best_peak: float | None
    target_high: float
    full_reps: int
    compensation_rate: float


class AdminWarmupHistory(BaseModel):
    exercise_id: ExerciseId
    points: list[AdminWarmupPoint]
