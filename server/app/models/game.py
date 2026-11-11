from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class GameRun(SQLModel, table=True):
    """One play of one game inside a session."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    game_id: str = Field(index=True)
    engine: str = "L0"  # "L0" | "L1" | "L2"
    input_source: str  # "cv_grip" | "keyboard" | "emg"
    params_initial: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    started_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    ended_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    status: str = "active"  # "active" | "completed" | "aborted"
    trials_planned: int
    trials_done: int = 0
    score: float | None = None
    summary: dict[str, Any] | None = Field(default=None, sa_type=JSON)


class Trial(SQLModel, table=True):
    """One trial of a game run. Uploading the same trial_no again replaces the row."""

    __table_args__ = (UniqueConstraint("game_run_id", "trial_no"),)

    id: int | None = Field(default=None, primary_key=True)
    game_run_id: int = Field(foreign_key="gamerun.id", index=True)
    trial_no: int
    params: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    target: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    outcome: str  # "success" | "reach_fail" | "activation_fail" | "aborted"
    timings: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    metrics: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    compensation: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    # [t_ms, x_sw, y_sw] at about 30 Hz, raw (unsmoothed) fingertip in the body frame.
    trajectory: list[list[float]] = Field(default_factory=list, sa_type=JSON)
    #: The server's own measures (app/services/trial_metrics.py): recomputed from the RAW
    #: trajectory for spatial games, checked copies of the client's for the others. None until
    #: the run ends or an admin recomputes.
    metrics_server: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    #: How usable the trial's RAW data was: points, sampling rate, gaps, and the metrics where
    #: the server and the client disagree.
    data_quality: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
