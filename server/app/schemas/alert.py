"""Unified alerts (admin only)."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.schemas.common import UtcDatetime

AlertType = Literal[
    "pain",
    "new_symptoms",
    "high_fatigue",
    "sharp_decline",
    "missed_sessions",
    "repeated_device_problems",
    "llm_fallback_rate",
]
AlertSeverity = Literal["high", "medium", "low"]
AlertStatus = Literal["open", "acknowledged", "resolved"]
AlertNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int | None
    #: The patient's code (never the name); null for a system alert.
    patient_code: str | None = None
    session_id: int | None
    type: AlertType
    severity: AlertSeverity
    status: AlertStatus
    details: dict[str, Any]
    created_at: UtcDatetime
    acknowledged_by: int | None
    acknowledged_at: UtcDatetime | None
    resolved_by: int | None
    resolved_at: UtcDatetime | None
    note: str | None


class AlertAction(BaseModel):
    """Acknowledge or resolve, with an optional note (kept with the alert)."""

    model_config = ConfigDict(extra="forbid")

    note: AlertNote | None = None

    @field_validator("note")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return value or None


class AlertCounts(BaseModel):
    """Alerts still needing attention (open or acknowledged), by severity, and open ones."""

    open: int = 0
    open_high: int = 0
    open_medium: int = 0
    open_low: int = 0
    acknowledged: int = 0
