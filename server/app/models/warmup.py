from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class WarmupResult(SQLModel, table=True):
    """One exercise of one session's warm-up. Saving the same exercise again replaces the row."""

    __table_args__ = (UniqueConstraint("session_id", "exercise_id"),)

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    exercise_id: str = Field(index=True)
    preset: str  # "standard" | "gentle" | "personal"
    thresholds: dict[str, Any] = Field(sa_type=JSON)
    personalisation: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    full_reps: int
    partial_reps: int
    target_reps: int
    best_peak: float | None = None
    mean_duration_ms: float | None = None
    active_time_ms: float
    paused_time_ms: float
    measure_source: str | None = None  # "3d" | "2d"
    trunk_reference: str | None = None  # "hip" | "vertical" | "n/a"
    compensated_reps: int = 0
    compensation_rate: float = 0.0
    reps: list[dict[str, Any]] = Field(default_factory=list, sa_type=JSON)
    skipped: bool = False
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
