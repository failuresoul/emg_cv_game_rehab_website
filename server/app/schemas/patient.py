from datetime import date
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import (
    AgeBand,
    FullName,
    Language,
    MonthsSinceStroke,
    NormalizedEmail,
    Password,
    Side,
    UtcDatetime,
)
from app.schemas.alert import AlertCounts
from app.schemas.session import LastSession, LatestCalibration
from app.schemas.warmup import LastWarmup

DEFAULT_WEEKLY_GOAL = 5
TextSize = Literal["normal", "large", "xlarge"]
WeeklyGoal = Annotated[int, Field(ge=1, le=14, strict=True)]


class PatientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    full_name: FullName
    password: Password
    affected_side: Side
    dominant_side: Side
    age_band: AgeBand
    months_since_stroke: MonthsSinceStroke | None = None
    language: Language = "en"
    notes: str | None = None
    weekly_goal: WeeklyGoal = DEFAULT_WEEKLY_GOAL


class PatientRegister(BaseModel):
    """Self sign-up. Notes are left out because they belong to the therapist."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    full_name: FullName
    password: Password
    affected_side: Side
    dominant_side: Side
    age_band: AgeBand
    months_since_stroke: MonthsSinceStroke | None = None
    language: Language = "en"


class PatientUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail | None = None
    full_name: FullName | None = None
    password: Password | None = None
    affected_side: Side | None = None
    dominant_side: Side | None = None
    age_band: AgeBand | None = None
    months_since_stroke: MonthsSinceStroke | None = None
    language: Language | None = None
    notes: str | None = None
    weekly_goal: WeeklyGoal | None = None
    #: Which engine sets the games' difficulty: L0 fixed, L1 staircase, L2 Bayesian.
    engine_mode: Literal["L0", "L1", "L2"] | None = None
    #: The date research consent was recorded; null when there is none (or it was withdrawn).
    research_consent_at: date | None = None

    @model_validator(mode="after")
    def reject_null_for_required_fields(self) -> Self:
        nullable = {"months_since_stroke", "notes", "research_consent_at"}
        if self.research_consent_at is not None and self.research_consent_at > date.today():
            raise ValueError("research_consent_at cannot be in the future")
        for field in self.model_fields_set - nullable:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class OwnProfileUpdate(BaseModel):
    """What patients change themselves: the interface language (reports follow it) and digits."""

    model_config = ConfigDict(extra="forbid")

    language: Language | None = None
    bengali_digits: bool | None = None
    text_size: TextSize | None = None
    high_contrast: bool | None = None
    reduce_motion: bool | None = None
    sound_on: bool | None = None
    voice_on: bool | None = None

    @model_validator(mode="after")
    def something_to_change(self) -> Self:
        if not self.model_fields_set or all(
            getattr(self, name) is None for name in self.model_fields_set
        ):
            raise ValueError("Send at least one setting to change")
        return self


class PatientProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    patient_code: str
    affected_side: Side
    dominant_side: Side
    age_band: AgeBand
    months_since_stroke: int | None
    language: Language
    #: Numbers in Bengali digits in the Bangla interface (the patient's own setting).
    bengali_digits: bool = False
    #: Display settings, the patient's own.
    text_size: TextSize = "normal"
    high_contrast: bool = False
    reduce_motion: bool = False
    sound_on: bool = True
    voice_on: bool = False
    notes: str | None
    weekly_goal: int
    #: A demo patient with synthetic data, from scripts/seed_demo_data.py.
    is_demo: bool = False
    #: Which parameter engine sets the games' difficulty: L0 fixed, L1 staircase, L2 Bayesian.
    engine_mode: Literal["L0", "L1", "L2"] = "L1"
    #: The date research consent was recorded; null without consent.
    research_consent_at: date | None = None
    created_at: UtcDatetime


class PatientUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    email: str
    full_name: str
    is_active: bool
    last_login_at: UtcDatetime | None


class PatientRead(PatientProfileRead):
    user: PatientUserRead


class AdminStats(BaseModel):
    total_patients: int
    active_patients: int
    sessions_today: int = 0
    #: Alerts with status "open".
    open_alerts: int = 0
    alerts: AlertCounts = Field(default_factory=AlertCounts)


class TodayPlanStep(BaseModel):
    step: str
    minutes: int


class PatientDashboard(BaseModel):
    profile: PatientProfileRead
    today_plan: list[TodayPlanStep]
    last_session: LastSession | None = None
    latest_calibration: LatestCalibration | None = None
    last_warmup: LastWarmup | None = None
    streak_days: int = 0
