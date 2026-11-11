from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class AdaptationLog(SQLModel, table=True):
    """One decision of the parameter engine and the safety layer, for one trial of a game run.

    trial_no is the trial the decision came after; 0 is the start of the run.
    """

    __table_args__ = (UniqueConstraint("game_run_id", "trial_no"),)

    id: int | None = Field(default=None, primary_key=True)
    game_run_id: int = Field(foreign_key="gamerun.id", index=True)
    trial_no: int
    engine: str
    #: The difficulty (one d per component) before and after, with the engine's bookkeeping.
    state_before: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    state_after: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: The settings given for the next trial.
    params: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: The engine's decision in plain words, such as "2 successes in a row -> spatial 0.52 -> 0.58".
    decision: str
    #: What the safety layer changed or blocked, and why; None if nothing.
    safety_override: str | None = None
    #: The cue shown to the patient: posture, encourage, rest, finish_soon or finish.
    cue: str | None = None
    #: The trial's outcome as the browser reported it, which the safety rules look back on.
    trial: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
