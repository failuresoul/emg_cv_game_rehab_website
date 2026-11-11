from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class EngineState(SQLModel, table=True):
    """A patient's difficulty in one game for one parameter engine (app/engine/), kept between
    sessions so each session starts where the last one left off (eased a little)."""

    __table_args__ = (UniqueConstraint("patient_id", "game_id", "engine"),)

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patientprofile.id", index=True)
    game_id: str = Field(index=True)
    #: "L0", "L1" or "L2".
    engine: str
    #: The engine's state: one difficulty (0-1) per component, and its own bookkeeping.
    state: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: Trials the engine has learned from, over every session.
    trials_seen: int = 0
    updated_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
