"""L2: Bayesian, workspace-aware difficulty with Thompson sampling.

**Workspace sectors** (spatial games whose targets have a direction): 8 directions x rings of
the target's distance fraction (R1 0.40-0.55, R2 0.55-0.85, R3 0.85-1.00), plus a stretch ring R4
1.00-1.10 in a direction once its R3 has a posterior mean above 0.8 from at least 5 trials.
- Balloon pop uses only the upward directions (45, 90 and 135 degrees).
- Fruit catch uses its two sides, "out" and "across", instead of directions.

**Beliefs** about success:
- Each sector has a Beta(alpha, beta). The priors depend on the ring: R1 (4, 1), R2 (3, 2),
  R3 (2, 2), R4 (1, 3). The latest calibration and warm-up nudge them (see `_sector_priors`).
- A success adds 1 to alpha; a reach failure adds 1 to beta. Activation failures and misses
  leave the spatial beliefs alone.
- In games with a precision level, a reach failure may have been too far *or* too small or
  brief to hold, so its 1 is shared between the sector's beta and the precision level's, in
  proportion to how likely each was to fail.
- Every other component (activation, speed, precision, and every component of a game without
  directions) has 6 difficulty levels (d = 0, 0.2, ..., 1), each with a Beta.
  - Their priors fall from easy to hard, centred on the admin's default: about 0.7 success there.
  - After each update a pool-adjacent-violators pass keeps the means monotone: an easier
    level's mean is never below a harder one's.

**Choosing the next trial** (Thompson sampling). p* = 0.70 is the target success of the whole
trial. A trial succeeds only when every chosen part does (the sector and each level), and each
belief is about its own part, so each of the k parts aims at p*^(1/k): 0.89 for Reach and
squeeze's three parts (`component_target`).
- **Sector:** draw theta from every allowed sector's Beta, and take the best score
  -|theta - aim| + 0.05 x min(2, trials since the sector was last chosen / 10).
  - The coverage bonus is weighted by the sector's posterior mean (`FEASIBLE_COVERAGE`), so it
    favours unvisited sectors the patient can plausibly do, not hopeless ones.
  - No sector more than twice in a row.
  - In a direction where 2 of the last 3 trials were compensated, the ring of those trials
    and every farther ring are left out (R1 never is).
  - The distance is a random setting value inside the sector.
- **Level:** for each other component, draw theta from every level's Beta and take the level
  whose draw is closest to the aim.

The choice becomes the state's d (spatial d from the distance), so the safety layer checks it as
for any engine. If the safety layer eases the spatial difficulty, the target's distance (and so
its ring) follows.

**Between sessions** the beliefs drift back towards the priors: alpha <- prior + 0.7 (alpha -
prior), and the same for beta.

**Random draws** come from a generator seeded by the engine's seed and the number of choices
made, so the same state always gives the same choice; the draws are logged.
"""

import copy
import random
from functools import lru_cache
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median
from typing import Any

from app.engine.base import Decision, EngineContext, EngineData, Target, TrialResult
from app.engine.difficulty import (
    clamp01,
    components_of,
    d_of,
    initial_state,
    params_for,
    snap,
    value_at,
)
from app.engine.l1_staircase import FAILURE_ROUTES
from app.engine.safety import COMPENSATION_LIMIT, COMPENSATION_WINDOW
from app.services.game_specs import GameSpec, ParamSpec

P_STAR = 0.70
W_COV = 0.05
#: The coverage bonus stops growing after this many tens of trials away.
COVERAGE_CAP = 2.0
#: The coverage bonus is weighted by the sector's posterior mean of success.
FEASIBLE_COVERAGE = True
MAX_REPEATS = 2
LEVEL_COUNT = 6
LEVEL_PRIOR_STRENGTH = 4.0
#: How much the prior success falls per level harder than the admin's default.
LEVEL_PRIOR_STEP = 0.12
GAMMA = 0.7
UNLOCK_MEAN = 0.8
UNLOCK_TRIALS = 5
RING_PRIORS: dict[int, tuple[float, float]] = {1: (4.0, 1.0), 2: (3.0, 2.0), 3: (2.0, 2.0), 4: (1.0, 3.0)}
#: Ring boundaries of the distance fraction (R1 from 0.40; R4 is the stretch ring).
RING_LOW = 0.40
RING_2_FROM = 0.55
RING_3_ABOVE = 0.85
RING_4_ABOVE = 1.00
#: How far the calibration and warm-up may move a prior's mean.
SEED_SHIFT = 0.1
#: A direction whose calibrated reach is below this share of the median is weak.
WEAK_DIRECTION = 0.75
EPSILON = 1e-9

#: The setting that places the target in each spatial game.
SPATIAL_PARAM: dict[str, str] = {
    "reach_activate": "distance_frac",
    "balloon_pop": "height_frac",
    "fruit_catch": "spread_frac",
    "pick_place": "pick_distance_frac",
    "path_trace": "path_length_frac",
}


@dataclass(frozen=True)
class Lane:
    """A direction (or a Fruit catch side) of the workspace."""

    prefix: str
    direction_deg: float | None
    side: str | None
    #: The calibration direction (0-7), if any.
    index: int | None


_EIGHT = tuple(Lane(f"D{i}", 45.0 * i, None, i) for i in range(8))
LANES: dict[str, tuple[Lane, ...]] = {
    "reach_activate": _EIGHT,
    "pick_place": _EIGHT,
    "path_trace": _EIGHT,
    "balloon_pop": tuple(lane for lane in _EIGHT if lane.index in (1, 2, 3)),
    "fruit_catch": (Lane("out-", None, "out", None), Lane("across-", None, "across", None)),
}


def ring_of(distance_frac: float) -> int:
    if distance_frac < RING_2_FROM:
        return 1
    if distance_frac <= RING_3_ABOVE + EPSILON:
        return 2
    return 3 if distance_frac <= RING_4_ABOVE + EPSILON else 4


@dataclass(frozen=True)
class Sector:
    name: str
    lane: Lane
    ring: int
    #: The setting values inside the sector, on the setting's step.
    values: tuple[float, ...]


def _ring_values(spec: ParamSpec, ring: int) -> tuple[float, ...]:
    return _ring_grid(spec.min, spec.max, spec.step, ring)


@lru_cache(maxsize=256)
def _ring_grid(low: float, high: float, step_size: float, ring: int) -> tuple[float, ...]:
    spec = ParamSpec.model_construct(
        name="x", min=low, max=high, step=step_size, default=low, component="spatial", harder="higher"
    )
    values: list[float] = []
    step = spec.step if spec.step > 0 else 0.05
    k = 0
    while True:
        value = snap(spec, spec.min + k * step)
        if value >= RING_LOW - EPSILON and ring_of(value) == ring and value not in values:
            values.append(value)
        if value >= spec.max - EPSILON or k > 10_000:
            break
        k += 1
    return tuple(values)


def spatial_spec(game: GameSpec) -> ParamSpec | None:
    """The game's target-placing setting, if it has workspace sectors."""
    name = SPATIAL_PARAM.get(game.id)
    spec = game.param(name) if name else None
    if spec is None or game.id not in LANES or spec.component != "spatial":
        return None
    return spec


def sectors_of(game: GameSpec) -> dict[str, Sector]:
    spec = spatial_spec(game)
    if spec is None:
        return {}
    return _sector_table(game.id, spec.min, spec.max, spec.step)


@lru_cache(maxsize=64)
def _sector_table(game_id: str, low: float, high: float, step_size: float) -> dict[str, Sector]:
    table: dict[str, Sector] = {}
    lanes = LANES[game_id]
    for lane in lanes:
        for ring in (1, 2, 3, 4):
            values = _ring_grid(low, high, step_size, ring)
            if values:
                name = f"{lane.prefix}R{ring}"
                table[name] = Sector(name, lane, ring, values)
    return table


def level_components(game: GameSpec) -> list[str]:
    """The components chosen by level: all but spatial in a game with sectors."""
    has_sectors = spatial_spec(game) is not None
    return [c for c in components_of(game) if not (has_sectors and c == "spatial")]


def level_d(index: int) -> float:
    return round(index / (LEVEL_COUNT - 1), 4)


def level_index(d: float) -> int:
    return min(LEVEL_COUNT - 1, max(0, round(clamp01(d) * (LEVEL_COUNT - 1))))


def beta_mean(ab: Sequence[float]) -> float:
    return ab[0] / (ab[0] + ab[1])


def _with_mean(ab: Sequence[float], mean: float) -> list[float]:
    n = ab[0] + ab[1]
    mean = min(0.99, max(0.01, mean))
    return [round(mean * n, 4), round((1 - mean) * n, 4)]


def monotone_levels(levels: list[list[float]]) -> list[list[float]]:
    """Pool-adjacent-violators on the means, weighted by each Beta's total count: from the
    easiest level to the hardest the means never rise. Counts are kept; only means move."""
    blocks: list[list[float]] = []  # [weighted sum, weight, size]
    for ab in levels:
        weight = ab[0] + ab[1]
        blocks.append([beta_mean(ab) * weight, weight, 1])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] < blocks[-1][0] / blocks[-1][1] - EPSILON:
            last = blocks.pop()
            blocks[-1] = [blocks[-1][0] + last[0], blocks[-1][1] + last[1], blocks[-1][2] + last[2]]
    means: list[float] = []
    for total, weight, size in blocks:
        means += [total / weight] * int(size)
    return [
        _with_mean(ab, mean) if abs(beta_mean(ab) - mean) > EPSILON else list(ab)
        for ab, mean in zip(levels, means, strict=True)
    ]


def _shifted(prior: tuple[float, float], shift: float) -> list[float]:
    return _with_mean(prior, min(0.95, max(0.05, beta_mean(prior) + shift)))


def _sector_priors(game: GameSpec, context: EngineContext) -> dict[str, list[float]]:
    """Ring priors, nudged by:
    - the calibration: a direction whose reach is under 75% of the median gets its rings R2-R4
      0.1 less likely;
    - the warm-up: forward reach completion moves rings R3-R4 by up to +/-0.1, and a
      compensation rate of 0.3 or more there takes 0.05 off."""
    radii = context.calibration
    middle = median(radii) if radii else None
    reach = (context.warmup or {}).get("forward_reach")
    far_shift = 0.0
    if reach is not None:
        far_shift = SEED_SHIFT * (2 * float(reach.get("completion", 0.5)) - 1)
        if float(reach.get("compensation_rate", 0.0)) >= 0.3:
            far_shift -= SEED_SHIFT / 2
    priors: dict[str, list[float]] = {}
    for name, sector in sectors_of(game).items():
        shift = far_shift if sector.ring >= 3 else 0.0
        index = sector.lane.index
        if (
            radii
            and middle
            and index is not None
            and index < len(radii)
            and sector.ring >= 2
            and radii[index] < WEAK_DIRECTION * middle
        ):
            shift -= SEED_SHIFT
        priors[name] = _shifted(RING_PRIORS[sector.ring], shift)
    return priors


def _level_priors(game: GameSpec, context: EngineContext) -> dict[str, list[list[float]]]:
    """Per component: about 0.7 success at the admin's default level, 0.12 less per level
    harder and 0.12 more per level easier. The warm-up's hand opening and closing moves the
    activation priors by up to +/-0.1."""
    start = initial_state(game, context.settings)
    hand = (context.warmup or {}).get("hand_open_close")
    activation_shift = SEED_SHIFT * (2 * float(hand.get("completion", 0.5)) - 1) if hand else 0.0
    priors: dict[str, list[list[float]]] = {}
    for component in level_components(game):
        centre = level_index(start.get(component, 0.5))
        shift = activation_shift if component == "activation" else 0.0
        priors[component] = [
            _with_mean(
                (LEVEL_PRIOR_STRENGTH * 0.5, LEVEL_PRIOR_STRENGTH * 0.5),
                min(0.95, max(0.1, P_STAR + LEVEL_PRIOR_STEP * (centre - i) + shift)),
            )
            for i in range(LEVEL_COUNT)
        ]
    return priors


class BayesEngine:
    name = "L2"
    adapts = True

    def __init__(self, seed: int = 0) -> None:
        self.seed = seed

    # The interface

    def initial(self, context: EngineContext) -> EngineData:
        game = context.game
        sector_priors = _sector_priors(game, context)
        level_priors = _level_priors(game, context)
        extra: dict[str, Any] = {
            "seed": self.seed,
            "n": 0,
            "t": 0,
            "sectors": copy.deepcopy(sector_priors),
            "sector_priors": sector_priors,
            "seen": {},
            "visits": {},
            "levels": copy.deepcopy(level_priors),
            "level_priors": level_priors,
            "next": {},
            "last": None,
            "repeats": 0,
            "comp": {},
        }
        start = initial_state(game, context.settings)
        state = EngineData(d={c: min(d, context.max_difficulty) for c, d in start.items()}, extra=extra)
        chosen, _ = self._choose(state, context)
        return chosen

    def new_session(self, state: EngineData, context: EngineContext) -> EngineData:
        """Forgetting: every alpha and beta moves back towards its prior, keeping 70% of what
        was learned; the streak of repeats and the compensation history start again."""
        extra = copy.deepcopy(state.extra)
        if not extra:
            return self.initial(context)
        for name, ab in extra["sectors"].items():
            prior = extra["sector_priors"].get(name, ab)
            extra["sectors"][name] = [_forget(p, v) for p, v in zip(prior, ab, strict=True)]
        for component, levels in extra["levels"].items():
            priors = extra["level_priors"][component]
            extra["levels"][component] = [
                [_forget(p, v) for p, v in zip(prior, ab, strict=True)]
                for prior, ab in zip(priors, levels, strict=True)
            ]
        extra["last"], extra["repeats"], extra["comp"] = None, 0, {}
        chosen, _ = self._choose(EngineData(d=dict(state.d), extra=extra), context)
        return chosen

    def update(
        self, state: EngineData, trial: TrialResult, context: EngineContext
    ) -> tuple[EngineData, Decision]:
        if not state.extra:
            state = self.initial(context)
        if trial.outcome == "aborted":
            return state, Decision(self.name, "A stopped trial: beliefs unchanged.")
        game = context.game
        extra = copy.deepcopy(state.extra)
        extra["t"] = int(extra.get("t", 0)) + 1
        table = sectors_of(game)
        played = self._sector_played(state, trial, context, table)
        updates: list[str] = []
        details: dict[str, Any] = {"outcome": trial.outcome}

        route = FAILURE_ROUTES.get(trial.outcome, ())
        used = {c: level_index(state.d.get(c, 0.0)) for c in extra["levels"]}
        sector_ab = extra["sectors"][played] if played is not None else None

        def blame_sector(amount: float) -> None:
            assert sector_ab is not None and played is not None
            sector_ab[1] += amount
            details["sector"] = played
            updates.append(f"{played} {amount:.2g} less likely (now {sector_ab[0]:.3g}/{sector_ab[1]:.3g})")

        if trial.success:
            if sector_ab is not None and played is not None:
                sector_ab[0] += 1
                details["sector"] = played
                updates.append(f"success in {played} (now {sector_ab[0]:.3g}/{sector_ab[1]:.3g})")
            for component, index in used.items():
                extra["levels"][component][index][0] += 1
        elif trial.outcome == "reach_fail" and sector_ab is not None and "precision" in used:
            # Too far, or too small or brief to hold? Shared between the sector and the precision
            # level in proportion to how likely each was to fail.
            precision_ab = extra["levels"]["precision"][used["precision"]]
            risk_sector, risk_precision = 1 - beta_mean(sector_ab), 1 - beta_mean(precision_ab)
            share = risk_sector / (risk_sector + risk_precision) if risk_sector + risk_precision else 0.5
            blame_sector(round(share, 4))
            precision_ab[1] += round(1 - share, 4)
            updates.append(f"precision level {used['precision']} {1 - share:.2g} less likely")
        else:
            target = next(
                (c for c in route if c in used or (c == "spatial" and sector_ab is not None)),
                None,
            )
            if target == "spatial" and sector_ab is not None and "spatial" not in used:
                blame_sector(1.0)
            elif target is not None:
                extra["levels"][target][used[target]][1] += 1
                updates.append(f"{target} level {used[target]} less likely")
            elif used:
                for component, index in used.items():
                    extra["levels"][component][index][1] += 1 / len(used)
                updates.append("every level a little less likely")
        if played is not None:
            extra["seen"][played] = int(extra["seen"].get(played, 0)) + 1
            lane = table[played].lane.prefix
            history = extra["comp"].setdefault(lane, [])
            history.append([bool(trial.compensated), table[played].ring])
            del history[:-COMPENSATION_WINDOW]
        for component in extra["levels"]:
            extra["levels"][component] = monotone_levels(extra["levels"][component])

        chosen, choice = self._choose(EngineData(d=dict(state.d), extra=extra), context)
        heard = "; ".join(updates) if updates else f"a {trial.outcome.replace('_', ' ')}"
        reason = f"{heard[0].upper()}{heard[1:]}. Next: {choice['reason']}."
        details.update(choice["details"])
        return chosen, Decision(self.name, reason, details=details)

    def next_params(
        self, state: EngineData, context: EngineContext
    ) -> tuple[dict[str, float], Decision]:
        params = params_for(context.game, state.d, context.settings, context.max_difficulty)
        return params, Decision(self.name, "Settings for the chosen sector and levels.")

    def target(self, state: EngineData, context: EngineContext) -> Target | None:
        spec = spatial_spec(context.game)
        sector_name = (state.extra.get("next") or {}).get("sector")
        table = sectors_of(context.game)
        if spec is None or sector_name not in table or "spatial" not in state.d:
            return None
        lane = table[sector_name].lane
        # The distance follows the spatial d after the safety rules.
        distance = value_at(spec, state.d["spatial"])
        return Target(
            direction_deg=lane.direction_deg,
            side=lane.side,
            distance_frac=distance,
            sector=f"{lane.prefix}R{ring_of(distance)}",
        )

    # Choices

    def allowed_sectors(self, extra: dict[str, Any], context: EngineContext) -> list[str]:
        """The sectors the next target may use, in a stable order."""
        game = context.game
        spec = spatial_spec(game)
        if spec is None:
            return []
        cap = clamp01(context.max_difficulty)
        table = sectors_of(game)
        blocked = _blocked(extra, table)
        allowed: list[str] = []
        for name, sector in table.items():
            if not any(d_of(spec, value) <= cap + EPSILON for value in sector.values):
                continue
            if sector.ring == 4 and not _unlocked(extra, sector):
                continue
            if name in blocked:
                continue
            if name == extra.get("last") and int(extra.get("repeats", 0)) >= MAX_REPEATS:
                continue
            allowed.append(name)
        if not allowed:
            allowed = [
                name
                for name, sector in table.items()
                if sector.ring == 1 and not (name == extra.get("last") and int(extra.get("repeats", 0)) >= MAX_REPEATS)
            ] or [name for name, sector in table.items() if sector.ring == 1]
        return allowed

    def _choose(
        self, state: EngineData, context: EngineContext
    ) -> tuple[EngineData, dict[str, Any]]:
        extra = state.extra
        game = context.game
        cap = clamp01(context.max_difficulty)
        rng = random.Random(f"L2:{extra.get('seed', self.seed)}:{extra.get('n', 0)}")
        extra["n"] = int(extra.get("n", 0)) + 1
        d = dict(state.d)
        parts: list[str] = []
        details: dict[str, Any] = {}

        spec = spatial_spec(game)
        aim = component_target(game)
        details["aim"] = round(aim, 3)
        if spec is not None:
            table = sectors_of(game)
            allowed = self.allowed_sectors(extra, context)
            t = int(extra.get("t", 0))
            samples: dict[str, float] = {}
            best, best_score = allowed[0], float("-inf")
            for name in allowed:
                theta = rng.betavariate(*extra["sectors"][name])
                samples[name] = round(theta, 3)
                away = (t - int(extra["visits"].get(name, 0))) / 10
                bonus = W_COV * min(COVERAGE_CAP, max(0.0, away))
                if FEASIBLE_COVERAGE:
                    # Coverage for sectors the patient can plausibly do, not hopeless ones.
                    bonus *= beta_mean(extra["sectors"][name])
                score = -abs(theta - aim) + bonus
                if score > best_score + EPSILON:
                    best, best_score = name, score
            values = [v for v in table[best].values if d_of(spec, v) <= cap + EPSILON] or [
                min(table[best].values)
            ]
            distance = rng.choice(values)
            d["spatial"] = round(d_of(spec, distance), 4)
            extra["repeats"] = int(extra.get("repeats", 0)) + 1 if extra.get("last") == best else 1
            extra["last"] = best
            extra["visits"][best] = t
            extra["next"] = {"sector": best, "distance_frac": distance}
            parts.append(f"{best} sampled {samples[best]:.2f}, closest to {aim:.2f}")
            details["sector_samples"] = samples
            details["chosen_sector"] = best
            details["distance_frac"] = distance
            blocked = sorted(_blocked(extra, table))
            if blocked:
                details["blocked"] = blocked
        else:
            extra["next"] = {"sector": None}

        chosen_levels: dict[str, int] = {}
        level_samples: dict[str, list[float]] = {}
        for component, levels in extra["levels"].items():
            options = [i for i in range(LEVEL_COUNT) if level_d(i) <= cap + EPSILON] or [0]
            draws = {i: rng.betavariate(*levels[i]) for i in options}
            best_level = min(options, key=lambda i: (abs(draws[i] - aim), i))
            chosen_levels[component] = best_level
            level_samples[component] = [round(draws[i], 3) for i in options]
            d[component] = level_d(best_level)
            parts.append(
                f"{component} level {best_level} sampled {draws[best_level]:.2f}"
            )
        extra["next"]["levels"] = chosen_levels
        if chosen_levels:
            details["levels"] = chosen_levels
            details["level_samples"] = level_samples
        return (
            EngineData(d=d, streak=0, turn=0, extra=extra),
            {"reason": "; ".join(parts) if parts else "nothing to choose", "details": details},
        )

    def _sector_played(
        self,
        state: EngineData,
        trial: TrialResult,
        context: EngineContext,
        table: dict[str, Sector],
    ) -> str | None:
        """The sector the trial was in: from where the browser says the target was, else the
        engine's own choice at the distance actually given (after the safety rules)."""
        spec = spatial_spec(context.game)
        if spec is None:
            return None
        lanes = LANES[context.game.id]
        lane: Lane | None = None
        if trial.side is not None:
            lane = next((item for item in lanes if item.side == trial.side), None)
        elif trial.direction_deg is not None:
            index = round(trial.direction_deg / 45) % 8
            lane = next((item for item in lanes if item.index == index), None)
        else:
            chosen = (state.extra.get("next") or {}).get("sector")
            lane = table[chosen].lane if chosen in table else None
        if lane is None:
            return None
        distance = (
            trial.distance_frac
            if trial.distance_frac is not None
            else value_at(spec, state.d.get("spatial", 0.0))
        )
        name = f"{lane.prefix}R{ring_of(distance)}"
        return name if name in table else None


def component_target(game: GameSpec) -> float:
    """What each choice aims at so that the whole trial succeeds about P_STAR of the time.

    A trial succeeds only when every chosen part does (the sector and each level), and each
    belief is about its own part given the others succeed (a failure counts only against the
    part it points at). With k independent parts each aiming at P_STAR^(1/k), the trial aims at
    P_STAR: 0.70 for one part, 0.84 for two, 0.89 for three."""
    parts = len(level_components(game)) + (1 if spatial_spec(game) is not None else 0)
    return P_STAR ** (1 / max(1, parts))


def _forget(prior: float, value: float) -> float:
    return round(prior + GAMMA * (value - prior), 4)


def _unlocked(extra: dict[str, Any], sector: Sector) -> bool:
    """The stretch ring opens in a direction once its R3 has a mean above 0.8 from 5 trials."""
    r3 = f"{sector.lane.prefix}R3"
    ab = extra["sectors"].get(r3)
    return (
        ab is not None
        and beta_mean(ab) > UNLOCK_MEAN
        and int(extra["seen"].get(r3, 0)) >= UNLOCK_TRIALS
    )


def _blocked(extra: dict[str, Any], table: dict[str, Sector]) -> set[str]:
    """Sectors left out for compensation: in a direction where 2 of the last 3 trials were
    compensated, the nearest ring of those trials and every farther ring (never R1)."""
    blocked: set[str] = set()
    for lane, history in (extra.get("comp") or {}).items():
        recent = history[-COMPENSATION_WINDOW:]
        compensated = [ring for flag, ring in recent if flag]
        if len(compensated) < COMPENSATION_LIMIT:
            continue
        from_ring = max(2, min(compensated))
        blocked |= {
            name
            for name, sector in table.items()
            if sector.lane.prefix == lane and sector.ring >= from_ring
        }
    return blocked
