from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class Alert(SQLModel, table=True):
    """Something an admin should look at: a safety answer, a sharp decline, missed sessions,
    repeated device problems, or (system-wide) too many template reports.

    `cause_key` names what raised it, such as "questionnaire:42:pain", and is unique, so each
    generator can run any number of times without making the same alert twice.
    """

    id: int | None = Field(default=None, primary_key=True)
    #: None for a system alert (llm_fallback_rate).
    patient_id: int | None = Field(default=None, foreign_key="patientprofile.id", index=True)
    session_id: int | None = Field(default=None, foreign_key="session.id", index=True)
    #: "pain" | "new_symptoms" | "high_fatigue" | "sharp_decline" | "missed_sessions" |
    #: "repeated_device_problems" | "llm_fallback_rate"
    type: str = Field(index=True)
    severity: str  # "high" | "medium" | "low"
    status: str = Field(default="open", index=True)  # "open" | "acknowledged" | "resolved"
    cause_key: str = Field(unique=True)
    details: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    acknowledged_by: int | None = Field(default=None, foreign_key="user.id")
    acknowledged_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    resolved_by: int | None = Field(default=None, foreign_key="user.id")
    resolved_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    note: str | None = None
