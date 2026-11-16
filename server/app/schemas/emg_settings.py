from datetime import datetime

from pydantic import BaseModel, Field


class EmgSettingsRead(BaseModel):
    """The EMG thresholds the admin changed (the browser applies them over its defaults)."""

    overrides: dict[str, float]
    updated_at: datetime | None = None


class EmgSettingsUpdate(BaseModel):
    """Replaces every change: settings left out go back to their default."""

    overrides: dict[str, float] = Field(default_factory=dict)
