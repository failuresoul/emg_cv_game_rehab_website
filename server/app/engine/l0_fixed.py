"""L0: always the admin's defaults. Nothing adapts."""

from app.engine.base import Decision, EngineContext, EngineData, Target, TrialResult
from app.engine.difficulty import initial_state, params_for


class FixedEngine:
    name = "L0"
    adapts = False

    def initial(self, context: EngineContext) -> EngineData:
        return EngineData(d=initial_state(context.game, context.settings))

    def next_params(
        self, state: EngineData, context: EngineContext
    ) -> tuple[dict[str, float], Decision]:
        # The admin's defaults exactly, not the state's rounding of them.
        params = params_for(context.game, {}, context.settings)
        return params, Decision(self.name, "Fixed settings: the admin's defaults.")

    def update(
        self, state: EngineData, trial: TrialResult, context: EngineContext
    ) -> tuple[EngineData, Decision]:
        reason = f"Fixed settings: nothing changes after a {trial.outcome}."
        return state, Decision(self.name, reason)

    def new_session(self, state: EngineData, context: EngineContext) -> EngineData:
        return state

    def target(self, state: EngineData, context: EngineContext) -> Target | None:
        return None
