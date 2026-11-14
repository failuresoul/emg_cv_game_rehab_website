"""A patient's programme: what the therapist allows, and the history of its changes."""

from typing import Annotated, Any, Literal, Self, get_args

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.common import UtcDatetime
from app.schemas.emg import EmgSite
from app.schemas.game import GameId
from app.schemas.warmup import ExerciseId

EXERCISE_IDS: tuple[str, ...] = get_args(ExerciseId)
EngineMode = Literal["L0", "L1", "L2"]
#: "personal": the warm-up's usual targets, from the patient's own history. "gentle": always the
#: gentle targets, whatever the patient chooses.
ProgrammeWarmupPreset = Literal["personal", "gentle"]
MaxLevel = Annotated[int, Field(ge=1, le=10, strict=True)]

MIN_GAMES, MAX_GAMES = 2, 6
MIN_MINUTES, MAX_MINUTES = 10, 40
MIN_REST, MAX_REST = 3, 10
MIN_WEEKLY_GOAL, MAX_WEEKLY_GOAL = 1, 14
MAX_NOTES = 2000
MAX_REASON = 500

DEFAULT_MINUTES = 18
DEFAULT_GAMES = (3, 4)
DEFAULT_REST = 5


class GamesPerSession(BaseModel):
    """How many games a plan has: `min` on lighter days (after fatigue, pain or "too hard"),
    `max` otherwise."""

    model_config = ConfigDict(extra="forbid")

    min: int = Field(ge=MIN_GAMES, le=MAX_GAMES, strict=True)
    max: int = Field(ge=MIN_GAMES, le=MAX_GAMES, strict=True)

    @model_validator(mode="after")
    def min_not_above_max(self) -> Self:
        if self.min > self.max:
            raise ValueError(
                f"The fewest games per session ({self.min}) cannot be more than the most "
                f"({self.max})"
            )
        return self


class ProgrammeFields(BaseModel):
    """Every setting of a programme, as the admin sees and sends it."""

    model_config = ConfigDict(extra="forbid")

    enabled_games: list[GameId] = Field(min_length=1)
    #: Per game, 1-10; a game left out may reach 10.
    max_level: dict[GameId, MaxLevel] = Field(default_factory=dict)
    session_minutes_target: int = Field(ge=MIN_MINUTES, le=MAX_MINUTES, strict=True)
    games_per_session: GamesPerSession
    warmup_exercises: list[ExerciseId] = Field(min_length=1)
    warmup_preset: ProgrammeWarmupPreset
    rest_every_minutes: int = Field(ge=MIN_REST, le=MAX_REST, strict=True)
    engine_mode: EngineMode
    emg_default_site: EmgSite | None = None
    weekly_goal: int = Field(ge=MIN_WEEKLY_GOAL, le=MAX_WEEKLY_GOAL, strict=True)
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_NOTES)] | None = None

    @model_validator(mode="after")
    def consistent(self) -> Self:
        if len(set(self.enabled_games)) != len(self.enabled_games):
            raise ValueError("Each game may be listed only once in enabled_games")
        if len(set(self.warmup_exercises)) != len(self.warmup_exercises):
            raise ValueError("Each exercise may be listed only once in warmup_exercises")
        if len(self.enabled_games) < self.games_per_session.min:
            raise ValueError(
                f"Turn on at least {self.games_per_session.min} games, or lower the fewest games "
                "per session"
            )
        if self.notes == "":
            self.notes = None
        return self


class ProgrammeUpdate(ProgrammeFields):
    """PUT: the whole programme, and why it changed (optional, kept in the history)."""

    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_REASON)] | None = None


class ProgrammeRead(ProgrammeFields):
    patient_id: int
    #: Games the Game Library has turned off: never played, whatever the programme says.
    library_disabled_games: list[GameId] = Field(default_factory=list)
    updated_at: UtcDatetime


class ProgrammeChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field: str
    before: Any
    after: Any
    reason: str | None
    admin_id: int | None
    #: The admin's name, when known.
    admin_name: str | None = None
    created_at: UtcDatetime


class PatientProgrammeRead(BaseModel):
    """What the patient's browser needs from the programme (read-only; no notes or limits)."""

    #: Games the patient may play today: the programme's, among those the Game Library allows.
    enabled_games: list[GameId]
    warmup_exercises: list[ExerciseId]
    warmup_preset: ProgrammeWarmupPreset
    rest_every_minutes: int
    emg_default_site: EmgSite | None
    weekly_goal: int
