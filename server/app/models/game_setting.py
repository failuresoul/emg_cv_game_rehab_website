from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class GameSetting(SQLModel, table=True):
    """The admin's choices for one game: whether patients see it, and its starting defaults.

    No row means the game's own defaults from shared/game-specs.json, enabled.
    """

    id: int | None = Field(default=None, primary_key=True)
    game_id: str = Field(unique=True, index=True)
    enabled: bool = True
    #: Setting name to value, replacing the spec's default. Settings left out keep it.
    default_params: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    trials_default: int | None = None
    notes: str | None = None
    updated_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
