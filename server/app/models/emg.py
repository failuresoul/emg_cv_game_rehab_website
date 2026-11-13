from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class EmgCalibration(SQLModel, table=True):
    """A session's muscle-sensor calibration: the relaxed level, the maximum voluntary
    contraction (MVC) and the checks that came before. Numbers only; never a recording."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", unique=True)
    #: "flexors" (inner forearm: grip) or "extensors" (outer forearm: hand opening).
    site: str
    #: "serial" (the ESP32) or "simulated".
    source: str
    firmware_version: str | None = None
    sample_rate: float
    rest_mean_mv: float
    rest_sd_mv: float
    #: The average of the attempts used (each its highest 0.5 s mean).
    mvc_mv: float
    #: Every attempt's highest 0.5 s mean, in order.
    mvc_attempts: list[float] = Field(sa_type=JSON)
    #: Onset threshold: rest mean + 3 x rest SD (computed by the server).
    threshold_mv: float
    #: Every readiness check with its value, as it was when the sensor was ready.
    readiness: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: saturation, gaps, electrode_off, attempts_spread.
    quality: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    #: Self-reported: the laptop ran on battery and the 9 V batteries were fresh.
    battery_ok: bool
    gain_note: str | None = Field(default=None, max_length=300)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
