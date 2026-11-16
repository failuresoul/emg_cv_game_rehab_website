from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class EmgSettingsRecord(SQLModel, table=True):
    """The admin's changes to the EMG thresholds (one row, id 1). Only the changed values are
    kept; every other threshold is its default (app/core/emg_settings.json)."""

    __tablename__ = "emgsettings"

    id: int | None = Field(default=None, primary_key=True)
    #: Setting name -> value, for the settings that differ from their default.
    overrides: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    updated_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    updated_by_id: int | None = Field(default=None, foreign_key="user.id")
