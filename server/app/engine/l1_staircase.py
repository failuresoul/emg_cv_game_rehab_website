"""L1: a transformed up-down staircase per component (Levitt 1971).

Levitt H (1971). "Transformed up-down methods in psychoacoustics." Journal of the Acoustical
Society of America 49(2B):467-477. https://doi.org/10.1121/1.1912375

- After 2 consecutive successes, one component gets harder by STEP_UP (0.06).
- After 1 failure, the component the failure points at gets easier by STEP_DOWN (0.08).

A 2-up-1-down rule with equal steps tracks about 71% success (Levitt). With the larger step
down, a simulated patient of fixed ability settles at about 75% success
(tests/test_engine.py), within the 60-80% aimed for, and a failure eases things quickly.

Which component moves:

- Success: the one with the most room left below the admin's maximum, taking turns when
  several have the same room.
- reach_fail: spatial (then precision, if spatial is already easiest or absent).
- activation_fail: activation.
- miss: speed in timed games (then spatial).
- Any other failure, or none of those components left to ease: every component by half a step.
- A trial the patient stopped (aborted) changes nothing.
"""

from app.engine.base import Decision, EngineContext, EngineData, TrialResult
from app.engine.difficulty import clamp01, components_of, initial_state, params_for

STEP_UP = 0.06
STEP_DOWN = 0.08
SUCCESSES_TO_STEP_UP = 2
#: The components each kind of failure points at, in order of preference.
FAILURE_ROUTES: dict[str, tuple[str, ...]] = {
    "reach_fail": ("spatial", "precision"),
    "activation_fail": ("activation",),
    "miss": ("speed", "spatial"),
}
EPSILON = 1e-9


def _round(d: float) -> float:
    return round(d, 4)


class StaircaseEngine:
    adapts = True

    def __init__(self, name: str = "L1") -> None:
        self.name = name

    def initial(self, context: EngineContext) -> EngineData:
        cap = clamp01(context.max_difficulty)
        state = initial_state(context.game, context.settings)
        return EngineData(d={component: min(d, cap) for component, d in state.items()})

    def next_params(
        self, state: EngineData, context: EngineContext
    ) -> tuple[dict[str, float], Decision]:
        params = params_for(context.game, state.d, context.settings, context.max_difficulty)
        levels = ", ".join(f"{component} {d:.2f}" for component, d in state.d.items())
        return params, Decision(self.name, f"Settings from the current difficulty ({levels}).")

    def update(
        self, state: EngineData, trial: TrialResult, context: EngineContext
    ) -> tuple[EngineData, Decision]:
        components = [c for c in components_of(context.game) if c in state.d]
        if trial.outcome == "aborted" or not components:
            return state, Decision(self.name, "A stopped trial: nothing changes.")
        if trial.success:
            return self._after_success(state, components, context)
        return self._after_failure(state, trial.outcome, components)

    def _after_success(
        self, state: EngineData, components: list[str], context: EngineContext
    ) -> tuple[EngineData, Decision]:
        cap = clamp01(context.max_difficulty)
        streak = state.streak + 1
        if streak < SUCCESSES_TO_STEP_UP:
            return (
                EngineData(d=dict(state.d), streak=streak, turn=state.turn),
                Decision(self.name, "Success: one more in a row before it gets harder."),
            )
        # The most room left first; equal room is taken in turns from `turn`.
        order = sorted(
            range(len(components)),
            key=lambda index: (
                -(cap - state.d[components[index]]),
                (index - state.turn) % len(components),
            ),
        )
        for index in order:
            component = components[index]
            before = state.d[component]
            if cap - before <= EPSILON:
                continue
            after = _round(min(cap, before + STEP_UP))
            d = {**state.d, component: after}
            return (
                EngineData(d=d, streak=0, turn=(index + 1) % len(components)),
                Decision(
                    self.name,
                    f"Two successes in a row: {component} a little harder.",
                    {component: (before, after)},
                ),
            )
        return (
            EngineData(d=dict(state.d), streak=0, turn=state.turn),
            Decision(
                self.name, "Two successes in a row, but already at the highest level allowed."
            ),
        )

    def _after_failure(
        self, state: EngineData, outcome: str, components: list[str]
    ) -> tuple[EngineData, Decision]:
        for component in FAILURE_ROUTES.get(outcome, ()):
            if component in components and state.d[component] > EPSILON:
                before = state.d[component]
                after = _round(max(0.0, before - STEP_DOWN))
                return (
                    EngineData(d={**state.d, component: after}, streak=0, turn=state.turn),
                    Decision(
                        self.name,
                        f"A {outcome.replace('_', ' ')}: {component} a little easier.",
                        {component: (before, after)},
                    ),
                )
        changes: dict[str, tuple[float, float]] = {}
        d = dict(state.d)
        for component in components:
            before = d[component]
            after = _round(max(0.0, before - STEP_DOWN / 2))
            if after != before:
                d[component] = after
                changes[component] = (before, after)
        reason = (
            f"A {outcome.replace('_', ' ')}: everything a little easier."
            if changes
            else f"A {outcome.replace('_', ' ')}: already at the easiest level."
        )
        return EngineData(d=d, streak=0, turn=state.turn), Decision(self.name, reason, changes)
