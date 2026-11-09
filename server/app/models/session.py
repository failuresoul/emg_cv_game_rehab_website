from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class Session(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patientprofile.id", index=True)
    started_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    ended_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    status: str = "active"  # "active" | "completed" | "aborted"
    device_info: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    notes: str | None = None
    # Safety flags from the cool-down questionnaire; see app/services/safety.py.
    flags: list[str] = Field(default_factory=list, sa_type=JSON)
    needs_review: bool = False
    reviewed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    review_note: str | None = None


class Calibration(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", unique=True)
    affected_side: str  # "left" | "right"
    shoulder_width_px: float
    directions_deg: list[float] = Field(sa_type=JSON)
    reach_radii_sw: list[float] = Field(sa_type=JSON)
    reach_points_sw: list[list[float]] = Field(sa_type=JSON)
    hull_sw: list[list[float]] = Field(sa_type=JSON)
    hull_area_sw2: float
    quality: dict[str, Any] = Field(sa_type=JSON)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
