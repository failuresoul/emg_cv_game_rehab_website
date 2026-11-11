"""A simulated patient for testing the adaptive engines offline.

Each ability is a number on the same scale as the demand it meets:

- **Reach**, per direction (8): a fraction of the calibrated reach, compared with a target's
  distance fraction.
- **Activation**: 0-1, compared with a squeeze or hand-opening demand.
- **Speed** and **precision**: 0-1, compared with the difficulty d of the game's timed and
  precision settings.

A trial succeeds when every component the game uses succeeds. Each component succeeds with
p = 1 / (1 + exp(-k (ability - demand))), with k = 8 (reach, speed, precision) or 12
(activation). Components are checked in the order spatial, precision, activation, speed; the
first to fail names the failure, as the browser does:

| Component | Failure |
| --- | --- |
| spatial, precision | reach_fail (did not get onto the target) |
| activation | activation_fail |
| speed | miss |

**Fatigue** within a session: every ability is multiplied by 1 - f (1 - exp(-t / tau)), t the
number of trials done in the session; a rest halves t.

**Learning** between sessions: each ability rises by eta x the successes of the session whose
demand was within EDGE of the ability (for reach, per direction), capped at ABILITY_CAP.

**Compensation** (trunk lean) becomes likely when a target is beyond the reach in its direction:
p = BASE + 0.6 (2 sigmoid(k overshoot) - 1), overshoot = max(0, x - A[d]).

Everything random comes from one seeded generator, so a patient with the same seed behaves the
same way given the same targets.
"""

import math
import random
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.engine.difficulty import adaptable_params, d_of
from app.services.game_specs import GameSpec

DIRECTION_COUNT = 8
K_REACH = 8.0
K_ACTIVATION = 12.0
K_SPEED = 8.0
K_PRECISION = 8.0
#: A success with the demand this close to the ability counts towards learning.
EDGE = 0.1
ABILITY_CAP = 1.0
COMPENSATION_BASE = 0.02
COMPENSATION_MAX = 0.6
#: Ring boundaries of a target's distance fraction, as the web app (targetPlacement.ts).
RING_2_FROM = 0.55
RING_3_ABOVE = 0.85
#: Games whose targets have a direction (the others use the mean reach).
DIRECTIONAL_GAMES = frozenset({"reach_activate", "balloon_pop"})
#: The order components are tried, and the failure each one names.
CHECK_ORDER: tuple[tuple[str, str], ...] = (
    ("spatial", "reach_fail"),
    ("precision", "reach_fail"),
    ("activation", "activation_fail"),
    ("speed", "miss"),
)
K_BY_COMPONENT = {
    "spatial": K_REACH,
    "activation": K_ACTIVATION,
    "speed": K_SPEED,
    "precision": K_PRECISION,
}


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def success_probability(ability: float, demand: float, k: float) -> float:
    return sigmoid(k * (ability - demand))


@dataclass(frozen=True)
class Profile:
    """A kind of patient: the ranges abilities are drawn from."""

    name: str
    reach: tuple[float, float]
    #: How many directions are weak, and their reach range.
    weak_directions: int
    weak_reach: tuple[float, float]
    activation: float
    speed: float
    precision: float


PROFILES: dict[str, Profile] = {
    "mild": Profile("mild", (0.85, 1.0), 0, (0.0, 0.0), 0.7, 0.7, 0.7),
    "moderate": Profile("moderate", (0.55, 0.8), 2, (0.35, 0.5), 0.45, 0.5, 0.5),
    "severe": Profile("severe", (0.3, 0.5), 0, (0.0, 0.0), 0.25, 0.3, 0.3),
}
#: Each patient's activation, speed and precision vary this much around the profile's value.
ABILITY_SPREAD = 0.05


def ring_for(distance_frac: float) -> int:
    if distance_frac < RING_2_FROM:
        return 1
    return 2 if distance_frac <= RING_3_ABOVE else 3


def sector_name(direction_index: int, distance_frac: float) -> str:
    """For example "D3R2", as the web app names target sectors."""
    return f"D{direction_index}R{ring_for(distance_frac)}"


@dataclass(frozen=True)
class Abilities:
    reach: tuple[float, ...]
    activation: float
    speed: float
    precision: float

    def values(self) -> list[float]:
        """Every ability as one list: the 8 reaches, then activation, speed and precision."""
        return [*self.reach, self.activation, self.speed, self.precision]


@dataclass(frozen=True)
class Attempt:
    """What happened in one simulated trial."""

    outcome: str
    failure_type: str | None
    compensated: bool
    movement_ms: float | None
    completion_ms: float | None
    activation_peak: float | None
    #: "D3R2" for directional games, else None.
    sector: str | None
    #: The demand each component met (spatial: distance fraction; activation: demand; speed
    #: and precision: d).
    demands: dict[str, float]

    @property
    def success(self) -> bool:
        return self.outcome == "success"


def demands_for(game: GameSpec, params: Mapping[str, float]) -> dict[str, float]:
    """The demand each component of the game puts on the patient for these settings."""
    by_component: dict[str, list[float]] = {}
    raw: dict[str, list[float]] = {}
    for spec in adaptable_params(game):
        value = float(params.get(spec.name, spec.default))
        by_component.setdefault(spec.component, []).append(d_of(spec, value))
        if spec.component == "spatial" and spec.name.endswith("_frac"):
            raw.setdefault("spatial", []).append(value)
        if spec.component == "activation" and (
            spec.name.endswith("_demand") or spec.name == "band_center"
        ):
            raw.setdefault("activation", []).append(value)
    demands: dict[str, float] = {}
    for component, ds in by_component.items():
        values = raw.get(component) or ds
        demands[component] = sum(values) / len(values)
    return demands


@dataclass
class SimPatient:
    """One simulated patient; `profile` is a Profile or the name of one in PROFILES."""

    profile: Profile | str
    seed: int
    #: Fatigue strength f (0.05-0.3) and time constant tau in trials; drawn when None.
    fatigue: float | None = None
    tau: float | None = None
    #: Learning rate eta (0.001-0.003); drawn when None.
    eta: float | None = None
    rng: random.Random = field(init=False)
    abilities: Abilities = field(init=False)
    trials_done: float = field(init=False, default=0.0)
    _edge_successes: dict[str, int] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        spec = PROFILES[self.profile] if isinstance(self.profile, str) else self.profile
        self.profile = spec
        self.rng = random.Random(self.seed)
        reach = [self.rng.uniform(*spec.reach) for _ in range(DIRECTION_COUNT)]
        for index in self.rng.sample(range(DIRECTION_COUNT), spec.weak_directions):
            reach[index] = self.rng.uniform(*spec.weak_reach)

        def around(value: float) -> float:
            return min(ABILITY_CAP, max(0.05, value + self.rng.uniform(-1, 1) * ABILITY_SPREAD))

        self.abilities = Abilities(
            reach=tuple(min(ABILITY_CAP, value) for value in reach),
            activation=around(spec.activation),
            speed=around(spec.speed),
            precision=around(spec.precision),
        )
        if self.fatigue is None:
            self.fatigue = self.rng.uniform(0.05, 0.3)
        if self.tau is None:
            self.tau = self.rng.gauss(60, 8)
        if self.eta is None:
            self.eta = self.rng.uniform(0.001, 0.003)

    # Within a session

    def start_session(self) -> None:
        self.trials_done = 0.0
        self._edge_successes = {}

    def fatigue_factor(self) -> float:
        assert self.fatigue is not None and self.tau is not None
        return 1.0 - self.fatigue * (1.0 - math.exp(-self.trials_done / self.tau))

    def rest(self) -> None:
        """A rest break: half of the session's tiredness wears off."""
        self.trials_done /= 2

    def ability(self, component: str, direction: int | None) -> float:
        """The ability now, with fatigue."""
        if component == "spatial":
            reach = self.abilities.reach
            base = reach[direction] if direction is not None else sum(reach) / len(reach)
        else:
            base = getattr(self.abilities, component)
        return base * self.fatigue_factor()

    def attempt(
        self, game: GameSpec, params: Mapping[str, float], direction: int | None = None
    ) -> Attempt:
        """One trial with these settings; `direction` (0-7) for directional games."""
        if game.id not in DIRECTIONAL_GAMES:
            direction = None
        demands = demands_for(game, params)
        outcome, failure = "success", None
        for component, failure_type in CHECK_ORDER:
            if component not in demands:
                continue
            p = success_probability(
                self.ability(component, direction), demands[component], K_BY_COMPONENT[component]
            )
            if self.rng.random() >= p:
                outcome = failure = failure_type
                break

        spatial = demands.get("spatial")
        compensated = False
        movement_ms: float | None = None
        completion_ms: float | None = None
        if spatial is not None:
            reach = self.ability("spatial", direction)
            overshoot = max(0.0, spatial - reach)
            p_comp = COMPENSATION_BASE + COMPENSATION_MAX * (2 * sigmoid(K_REACH * overshoot) - 1)
            compensated = self.rng.random() < p_comp
            movement_ms = max(
                200.0, 600 + 800 * spatial / max(reach, 0.05) + self.rng.gauss(0, 60)
            )
        else:
            effort = sum(demands.values()) / max(len(demands), 1)
            completion_ms = max(
                500.0, (1500 + 2000 * effort) / self.fatigue_factor() + self.rng.gauss(0, 100)
            )
        peak: float | None = None
        if "activation" in demands:
            noisy = self.ability("activation", None) + self.rng.gauss(0, 0.05)
            peak = min(1.0, max(0.0, noisy))

        if outcome == "success":
            for component, demand in demands.items():
                if abs(demand - self.ability(component, direction)) <= EDGE:
                    key = component if component != "spatial" or direction is None else (
                        f"spatial:{direction}"
                    )
                    self._edge_successes[key] = self._edge_successes.get(key, 0) + 1
        self.trials_done += 1
        sector = (
            sector_name(direction, spatial)
            if direction is not None and spatial is not None
            else None
        )
        return Attempt(
            outcome=outcome,
            failure_type=failure,
            compensated=compensated,
            movement_ms=round(movement_ms, 1) if movement_ms is not None else None,
            completion_ms=round(completion_ms, 1) if completion_ms is not None else None,
            activation_peak=round(peak, 3) if peak is not None else None,
            sector=sector,
            demands=demands,
        )

    # Between sessions

    def end_session(self) -> Abilities:
        """Learning from the session's successes near the edge of each ability."""
        assert self.eta is not None
        eta = self.eta
        gains = self._edge_successes

        def grown(value: float, key: str) -> float:
            return min(ABILITY_CAP, value + eta * gains.get(key, 0))

        reach = list(self.abilities.reach)
        mean_gain = gains.get("spatial", 0)
        for index in range(DIRECTION_COUNT):
            # Non-directional games train every direction a little (the mean reach).
            reach[index] = grown(reach[index], f"spatial:{index}")
            if mean_gain:
                reach[index] = min(ABILITY_CAP, reach[index] + eta * mean_gain / DIRECTION_COUNT)
        self.abilities = Abilities(
            reach=tuple(reach),
            activation=grown(self.abilities.activation, "activation"),
            speed=grown(self.abilities.speed, "speed"),
            precision=grown(self.abilities.precision, "precision"),
        )
        self._edge_successes = {}
        return self.abilities
