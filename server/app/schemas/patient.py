from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

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

    @model_validator(mode="after")
    def reject_null_for_required_fields(self) -> Self:
        nullable = {"months_since_stroke", "notes"}
        for field in self.model_fields_set - nullable:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
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
    notes: str | None
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
    open_alerts: int = 0


class TodayPlanStep(BaseModel):
    step: str
    minutes: int


class PatientDashboard(BaseModel):
    profile: PatientProfileRead
    today_plan: list[TodayPlanStep]
    last_session: None = None
    streak_days: int = 0
