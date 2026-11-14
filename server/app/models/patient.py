from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class PatientProfile(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    patient_code: str = Field(unique=True, index=True)  # "P001", "P002", ...
    affected_side: str  # "left" | "right"
    dominant_side: str  # "left" | "right"
    age_band: str  # "18-29" | "30-39" | "40-49" | "50-59" | "60-69" | "70+"
    months_since_stroke: int | None = None
    language: str = "en"  # "en" | "bn"
    notes: str | None = None
    #: Sessions per week the patient aims for; the therapist sets it.
    weekly_goal: int = 5
    #: Made by scripts/seed_demo_data.py, with synthetic sessions; --clear removes it.
    is_demo: bool = False
    #: Which parameter engine sets the games' difficulty: "L0" fixed defaults, "L1" staircase,
    #: "L2" (Day 13; behaves like L1 until then).
    engine_mode: str = "L1"
    #: The highest difficulty (0-1) the engine may reach, by game id; a game left out may reach
    #: 1.0. The admin sets it (Day 17).
    max_difficulty: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: The date the patient's research consent was recorded; None without consent. Only
    #: consenting patients can be enrolled in a study.
    research_consent_at: date | None = Field(default=None, sa_type=Date)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
