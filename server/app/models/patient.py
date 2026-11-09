from datetime import datetime

from sqlalchemy import DateTime
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
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
