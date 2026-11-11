"""Difficulty as a number from 0 (easiest) to 1 (hardest), one per component of a game.

Each adaptable setting (shared/game-specs.json, component other than "fixed") runs between its
spec bounds: `easy` is the bound on the easier side and `hard` the one on the harder side, so
value(d) = easy + d * (hard - easy), rounded to the setting's step. Every setting of the same
component moves together with one d, so a game's difficulty state is one d per component it
uses. The engine never goes outside the spec bounds: d is kept within 0 and the admin's maximum.
"""

import math
from collections.abc import Mapping
from typing import Literal

from app.services.game_specs import GameSpec, ParamSpec

Component = Literal["spatial", "activation", "speed", "precision"]
#: The order components are listed and taken in turns.
COMPONENTS: tuple[Component, ...] = ("spatial", "activation", "speed", "precision")
#: A difficulty state: one d (0-1) per component the game uses.
DifficultyState = dict[str, float]


def is_adaptable(spec: ParamSpec) -> bool:
    """A setting the engine may move: not fixed, with a range and a harder direction."""
    return spec.component != "fixed" and spec.min < spec.max and spec.harder is not None


def adaptable_params(game: GameSpec) -> list[ParamSpec]:
    return [spec for spec in game.params if is_adaptable(spec)]


def components_of(game: GameSpec) -> list[str]:
    """The components the game uses, in COMPONENTS order."""
    used = {spec.component for spec in adaptable_params(game)}
    return [component for component in COMPONENTS if component in used]


def easy_hard(spec: ParamSpec) -> tuple[float, float]:
    """(easy, hard): the spec bound on the easier side, then the one on the harder side."""
    return (spec.min, spec.max) if spec.harder == "higher" else (spec.max, spec.min)


def _decimals(step: float) -> int:
    """Enough decimal places to show the step, so 0.05-steps print as 0.35, not 0.35000000004."""
    if step <= 0:
        return 6
    return max(0, -math.floor(math.log10(step)) + 2)


def snap(spec: ParamSpec, value: float) -> float:
    """The value on the setting's step from its minimum, within its bounds."""
    clamped = min(spec.max, max(spec.min, value))
    if spec.step <= 0:
        return clamped
    steps = round((clamped - spec.min) / spec.step)
    snapped = min(spec.max, spec.min + steps * spec.step)
    return round(snapped, _decimals(spec.step))


def clamp01(d: float) -> float:
    return 0.0 if not math.isfinite(d) else min(1.0, max(0.0, d))


def value_at(spec: ParamSpec, d: float) -> float:
    """The setting's value at difficulty d (0 easiest, 1 hardest), rounded to its step."""
    easy, hard = easy_hard(spec)
    return snap(spec, easy + clamp01(d) * (hard - easy))


def d_of(spec: ParamSpec, value: float) -> float:
    """The difficulty d (0-1) that gives this value: the inverse of value_at."""
    easy, hard = easy_hard(spec)
    return clamp01((value - easy) / (hard - easy))


def initial_state(game: GameSpec, settings: Mapping[str, float]) -> DifficultyState:
    """The d of each component that reproduces the given settings (the admin's defaults): the
    mean of its settings' d values. A setting missing from `settings` uses the spec default."""
    found: dict[str, list[float]] = {}
    for spec in adaptable_params(game):
        value = settings.get(spec.name, spec.default)
        found.setdefault(spec.component, []).append(d_of(spec, float(value)))
    return {
        component: round(sum(found[component]) / len(found[component]), 4)
        for component in COMPONENTS
        if component in found
    }


def params_for(
    game: GameSpec,
    state: Mapping[str, float],
    settings: Mapping[str, float],
    max_difficulty: float = 1.0,
) -> dict[str, float]:
    """Every setting for a trial: the adaptable ones from the state (each component's d, never
    above the admin's maximum), the others as in `settings` (the admin's defaults)."""
    cap = clamp01(max_difficulty)
    params = {spec.name: float(settings.get(spec.name, spec.default)) for spec in game.params}
    for spec in adaptable_params(game):
        d = state.get(spec.component)
        if d is not None:
            params[spec.name] = value_at(spec, min(clamp01(d), cap))
    return params


def level_of(state: Mapping[str, float]) -> int:
    """A level from 1 to 10 for the patient to see: the mean difficulty, in tenths."""
    values = [clamp01(value) for value in state.values()]
    if not values:
        return 1
    # Half up, so a mean of exactly half way is level 6 every time.
    return 1 + math.floor(sum(values) / len(values) * 9 + 0.5)
