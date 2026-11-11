"""What every parameter engine does: choose a trial's settings, and learn from its outcome.

Engines are pure: they take the current state and return a new one, with a human-readable
decision explaining what changed and why. Saving the state is the caller's job
(app/services/engine_store.py).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
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
    #: The latest calibration's reach radius per direction (8, in SW), when there is one.
    calibration: tuple[float, ...] | None = None
    #: The latest warm-up per exercise: {"completion": full/target reps, "compensation_rate"}.
    warmup: Mapping[str, Mapping[str, float]] | None = None


@dataclass(frozen=True)
class TrialResult:
    outcome: str  # "success" | "reach_fail" | "activation_fail" | "miss" | "aborted"
    compensated: bool = False
    #: Where the target was, when the browser says (L2 credits the sector played).
    direction_deg: float | None = None
    distance_frac: float | None = None
    side: str | None = None

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
    #: Anything else worth logging, such as L2's sampled values and choices.
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Target:
    """Where the next target goes, for engines that choose it (L2): a direction (or a side, for
    Fruit catch), a distance as a fraction of the reach, and the sector's name."""

    direction_deg: float | None
    side: str | None
    distance_frac: float
    sector: str


@dataclass(frozen=True)
class EngineData:
    """A game's difficulty (one d per component) and the engine's own bookkeeping."""

    d: dict[str, float]
    #: Consecutive successes since the last step (staircase).
    streak: int = 0
    #: Which component takes the next step up when several have the same headroom.
    turn: int = 0
    #: An engine's own beliefs and choices (L2), kept with the state.
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {"d": dict(self.d), "streak": self.streak, "turn": self.turn}
        if self.extra:
            data["extra"] = self.extra
        return data

    def with_d(self, d: dict[str, float]) -> "EngineData":
        """The same state with other difficulties; the engine's own data is kept."""
        return replace(self, d=d)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "EngineData":
        raw = data.get("d") or {}
        return cls(
            d={str(key): float(value) for key, value in raw.items()},
            streak=int(data.get("streak", 0)),
            turn=int(data.get("turn", 0)),
            extra=dict(data.get("extra") or {}),
        )


WARM_RESTART = 0.05


def warm_restart(state: EngineData) -> EngineData:
    """Every d eased by 0.05 (not below 0), and the success streak started again."""
    return replace(
        state,
        d={component: round(max(0.0, d - WARM_RESTART), 4) for component, d in state.d.items()},
        streak=0,
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

    def new_session(self, state: EngineData, context: EngineContext) -> EngineData:
        """The stored state at the first use in a new session (L1: the warm restart)."""
        ...

    def target(self, state: EngineData, context: EngineContext) -> Target | None:
        """Where the next target goes, if the engine chooses it (L2); else None."""
        ...
