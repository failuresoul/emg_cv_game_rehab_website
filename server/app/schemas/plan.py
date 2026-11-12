from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.game import GameId


class PlannedGame(BaseModel):
    game_id: GameId
    trials: int
    minutes: float
    #: Why this game today, as a translation key for the web app, such as "focus_hand_opening",
    #: "practise_weak_direction", "variety", "favourite" or "lighter_today".
    reason_key: str
    reason_params: dict[str, Any] = Field(default_factory=dict)


class PlanFocus(BaseModel):
    #: Movements to work on: reach, shoulder, elbow, hand_opening, fingers, grip, smoothness.
    movements: list[str]
    #: Reach directions (degrees, 0 outward) that are weaker than the others.
    directions: list[float]


class PlanNote(BaseModel):
    #: For example "lighter_today" (with params {"because": "fatigue" | "pain" | "too_hard"}).
    key: str
    params: dict[str, Any] = Field(default_factory=dict)


class SessionPlan(BaseModel):
    """Today's games in order, each with its trials, minutes and reason."""

    games: list[PlannedGame]
    total_minutes: float
    focus: PlanFocus
    notes: list[PlanNote]
    #: The planner's version, so stored plans can be told apart if the rules change.
    version: int = 1
    created_at: datetime | None = None


class PlanOverrideCreate(BaseModel):
    """The games the patient kept, in the order they chose."""

    model_config = ConfigDict(extra="forbid")

    games: list[GameId] = Field(min_length=1, max_length=9)


class PlanOverrideRead(BaseModel):
    at: datetime
    planned: list[GameId]
    games: list[GameId]
    #: Planned games the patient unticked, and games they added.
    removed: list[GameId]
    added: list[GameId]
    #: The games kept from the plan are in a different order.
    reordered: bool


class PlanOverrides(BaseModel):
    overrides: list[PlanOverrideRead]
