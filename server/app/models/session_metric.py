from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class SessionMetric(SQLModel, table=True):
    """One measure of the metrics catalogue (shared/metrics-catalog.json) for one session.

    Trial measures have one row per game (game_id set); session measures, such as the success
    rate over every game, have game_id None. Recomputing a session replaces all its rows.
    """

    __table_args__ = (UniqueConstraint("session_id", "metric_id", "game_id"),)

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    #: A catalogue id, such as "K5".
    metric_id: str = Field(index=True)
    value: float
    unit: str
    #: How many items the value comes from: trials, warm-up results or answers.
    n: int
    game_id: str | None = Field(default=None, index=True)
    #: More about the value, such as the quartiles of a median, or where the trial values came
    #: from (the server's or the browser's).
    details: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    computed_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
