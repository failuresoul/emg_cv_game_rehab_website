"""What every parameter engine does: choose a trial's settings, and learn from its outcome.

Engines are pure: they take the current state and return a new one, with a human-readable
decision explaining what changed and why. Saving the state is the caller's job
(app/services/engine_store.py).
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.services.game_specs import GameSpec

#: The kinds of failure that point at one component (see l1_staircase).
FAILURE_OUTCOMES = frozenset({"reach_fail", "activation_fail", "miss"})


@dataclass(frozen=True)
class EngineContext:
    game: GameSpec
    #: The admin's defaults for the game (GameSetting, else the spec defaults).
    settings: dict[str, float]
    #: The highest difficulty (0-1) the patient may reach in this game.
    max_difficulty: float = 1.0


@dataclass(frozen=True)
class TrialResult:
    outcome: str  # "success" | "reach_fail" | "activation_fail" | "miss" | "aborted"

    @property
    def success(self) -> bool:
        return self.outcome == "success"


@dataclass(frozen=True)
class Decision:
    engine: str
    #: Why, in plain words, for the admin and the research export.
    reason: str
    #: Each component that moved: (before, after).
    changes: dict[str, tuple[float, float]] = field(default_factory=dict)


@dataclass(frozen=True)
class EngineData:
    """A game's difficulty (one d per component) and the engine's own bookkeeping."""

    d: dict[str, float]
    #: Consecutive successes since the last step (staircase).
    streak: int = 0
    #: Which component takes the next step up when several have the same headroom.
    turn: int = 0

    def to_json(self) -> dict[str, Any]:
        return {"d": dict(self.d), "streak": self.streak, "turn": self.turn}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "EngineData":
        raw = data.get("d") or {}
        return cls(
            d={str(key): float(value) for key, value in raw.items()},
            streak=int(data.get("streak", 0)),
            turn=int(data.get("turn", 0)),
        )


class Engine(Protocol):
    #: "L0", "L1" or "L2": stored with the state and the decisions.
    name: str
    #: False for L0: its settings never change, so its state (and the level shown) never moves:
    #: no warm restart, and the safety rules give their cues without easing anything.
    adapts: bool

    def initial(self, context: EngineContext) -> EngineData:
        """The state that reproduces the admin's defaults."""
        ...

    def next_params(
        self, state: EngineData, context: EngineContext
    ) -> tuple[dict[str, float], Decision]:
        """Every setting for the next trial, within the spec bounds and the admin's maximum."""
        ...

    def update(
        self, state: EngineData, trial: TrialResult, context: EngineContext
    ) -> tuple[EngineData, Decision]:
        """The state after a trial's outcome."""
        ...
