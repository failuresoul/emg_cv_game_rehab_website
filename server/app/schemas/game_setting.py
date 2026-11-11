from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.common import UtcDatetime
from app.services.game_specs import GameSpec

#: How many trials the admin may set for a game.
MIN_TRIALS = 5
MAX_TRIALS = 40

SettingName = Annotated[str, Field(min_length=1, max_length=50)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class GameSettingUpdate(BaseModel):
    """The admin's whole setting for one game; it replaces the one saved before."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    enabled: bool = True
    #: Setting name to its new default; each must be one of the game's settings, within its range.
    default_params: dict[SettingName, float] = Field(default_factory=dict, max_length=50)
    #: Null keeps the game's own number of trials.
    trials_default: Annotated[int, Field(ge=MIN_TRIALS, le=MAX_TRIALS, strict=True)] | None = None
    notes: Notes | None = None


class AdminGameRead(BaseModel):
    """A game's spec with the admin's setting, and the defaults and trials patients get."""

    spec: GameSpec
    enabled: bool
    default_params: dict[str, float]
    trials_default: int | None
    notes: str | None
    #: Null until the admin first saves a setting for the game.
    updated_at: UtcDatetime | None
    #: Every setting's starting value: the admin's where set, the spec's otherwise.
    effective_params: dict[str, float]
    effective_trials: int


class PatientGameSetting(BaseModel):
    """A game a patient may play, with the defaults and trials to start from."""

    game_id: str
    params: dict[str, float]
    trials: int

