"""Runs simulated patients through the real engines.

Each step goes through `app.services.adaptation.decide`, the same function `POST
/api/engine/next` uses: the engine's update, the safety rules, the fixed-settings rule for L0,
the next settings and the level. Each session starts from
`app.services.engine_store.starting_state`, so the warm restart is the server's too. Only the
storage differs: an in-memory dictionary instead of EngineState and AdaptationLog rows.

As in the web app:
- directional games take the eight directions in shuffled cycles;
- a "rest" cue pauses the patient (half the session's tiredness wears off);
- a "finish" cue ends the session.

One difference: the simulated first trial already uses the engine's settings, while the web app
plays the admin's defaults until the run exists.
"""

import random
from dataclasses import dataclass, field
from typing import Any

from app.engine import get_engine
from app.engine.base import EngineContext, EngineData
from app.engine.sim.patient import (
    DIRECTION_COUNT,
    DIRECTIONAL_GAMES,
    Abilities,
    Attempt,
    Profile,
    SimPatient,
)
from app.schemas.engine import LastTrial
from app.services.adaptation import PastStep, Step, decide
from app.services.engine_store import starting_state
from app.services.game_specs import GameSpec, get_spec

#: Simulated time per trial, for the session-time rule.
SECONDS_PER_TRIAL = 8.0


@dataclass(frozen=True)
class SimTrial:
    """One simulated trial and the decision that followed it."""

    patient: int
    session: int
    trial_no: int
    success: bool
    outcome: str
    failure_type: str | None
    sector: str | None
    direction: int | None
    #: The settings the trial was played with.
    params: dict[str, float]
    compensated: bool
    #: The level the trial was played at, and after the decision that followed.
    level: int
    level_after: int
    cue: str | None
    safety_override: str | None
    #: What the engine learned from, exactly as the web app sends it (LastTrial).
    summary: dict[str, Any]


@dataclass(frozen=True)
class SimDecision:
    """One engine call, as an AdaptationLog row would record it."""

    patient: int
    session: int
    trial_no: int
    state_before: dict[str, float]
    state_after: dict[str, float]
    params: dict[str, float]
    decision: str
    safety_override: str | None
    cue: str | None
    level: int


@dataclass
class SimResult:
    engine: str
    profile: str
    game_id: str
    trials: list[SimTrial] = field(default_factory=list)
    decisions: list[SimDecision] = field(default_factory=list)
    #: Per patient: the abilities before the first session and after each session.
    abilities: list[list[Abilities]] = field(default_factory=list)


class MemoryStore:
    """EngineState in memory: one state per patient and game."""

    def __init__(self) -> None:
        self._states: dict[tuple[int, str], EngineData] = {}

    def get(self, patient: int, game_id: str) -> EngineData | None:
        return self._states.get((patient, game_id))

    def put(self, patient: int, game_id: str, state: EngineData) -> None:
        self._states[(patient, game_id)] = state


def _last_trial(trial_no: int, attempt: Attempt) -> LastTrial:
    return LastTrial(
        trial_no=trial_no,
        outcome=attempt.outcome,  # type: ignore[arg-type]
        failure_type=attempt.failure_type,  # type: ignore[arg-type]
        compensated=attempt.compensated,
        movement_ms=attempt.movement_ms,
        completion_ms=attempt.completion_ms,
        activation_peak=attempt.activation_peak,
    )


def _game(game_id: str) -> GameSpec:
    game = get_spec(game_id)
    if game is None:
        raise ValueError(f"Unknown game: {game_id}")
    return game


def simulate(
    engine_mode: str,
    profile: str | Profile,
    n_patients: int,
    sessions: int,
    trials_per_session: int,
    game_id: str = "reach_activate",
    seed: int = 0,
    max_difficulty: float = 1.0,
) -> SimResult:
    """`n_patients` patients of a profile, each playing `sessions` sessions of one game with
    `trials_per_session` trials, with the engine of `engine_mode` ("L0", "L1" or "L2")."""
    game = _game(game_id)
    engine = get_engine(engine_mode)
    context = EngineContext(game=game, settings=game.defaults, max_difficulty=max_difficulty)
    profile_name = profile if isinstance(profile, str) else profile.name
    result = SimResult(engine=engine.name, profile=profile_name, game_id=game.id)
    store = MemoryStore()
    directional = game.id in DIRECTIONAL_GAMES

    for index in range(n_patients):
        patient = SimPatient(profile, seed=seed * 100_003 + index)
        order = random.Random(seed * 7919 + index)
        history = [patient.abilities]
        for session in range(sessions):
            patient.start_session()
            state = starting_state(engine, context, store.get(index, game.id), new_session=True)
            past: list[PastStep] = []

            def record(step: Step, trial_no: int, before: EngineData) -> None:
                result.decisions.append(
                    SimDecision(
                        patient=index,
                        session=session,
                        trial_no=trial_no,
                        state_before=dict(before.d),
                        state_after=dict(step.state.d),
                        params=dict(step.params),
                        decision=step.decision,
                        safety_override=step.safety_override,
                        cue=step.cue,
                        level=step.level,
                    )
                )

            step = decide(engine, context, state, None, past)
            record(step, 0, state)
            past.append(PastStep(0, None, step.cue))
            directions: list[int] = []
            for trial_no in range(1, trials_per_session + 1):
                if directional and not directions:
                    directions = list(range(DIRECTION_COUNT))
                    order.shuffle(directions)
                direction = directions.pop() if directional else None
                params = dict(step.params)
                level = step.level
                attempt = patient.attempt(game, params, direction)
                last = _last_trial(trial_no, attempt)
                before = step.state
                step = decide(
                    engine,
                    context,
                    before,
                    last,
                    past,
                    active_minutes=trial_no * SECONDS_PER_TRIAL / 60,
                )
                record(step, trial_no, before)
                summary = last.model_dump()
                past.append(PastStep(trial_no, summary, step.cue))
                result.trials.append(
                    SimTrial(
                        patient=index,
                        session=session,
                        trial_no=trial_no,
                        success=attempt.success,
                        outcome=attempt.outcome,
                        failure_type=attempt.failure_type,
                        sector=attempt.sector,
                        direction=direction,
                        params=params,
                        compensated=attempt.compensated,
                        level=level,
                        level_after=step.level,
                        cue=step.cue,
                        safety_override=step.safety_override,
                        summary=summary,
                    )
                )
                if step.cue == "rest":
                    patient.rest()
                if step.cue == "finish":
                    break
            store.put(index, game.id, step.state)
            history.append(patient.end_session())
        result.abilities.append(history)
    return result
