import math
import random

import pytest
from conftest import Headers
from sqlmodel import Session, select

from app.engine import get_engine
from app.engine.base import EngineContext, EngineData, TrialResult
from app.engine.difficulty import (
    adaptable_params,
    components_of,
    d_of,
    easy_hard,
    initial_state,
    level_of,
    params_for,
    snap,
    value_at,
)
from app.engine.l0_fixed import FixedEngine
from app.engine.l1_staircase import STEP_DOWN, STEP_UP, StaircaseEngine
from app.models import EngineState, GameSetting, PatientProfile
from app.services import engine_store
from app.services.engine_store import WARM_RESTART, warm_restart
from app.services.game_specs import GameSpec, get_spec, load_specs


def spec(game_id: str) -> GameSpec:
    found = get_spec(game_id)
    assert found is not None
    return found


def context(game_id: str, cap: float = 1.0) -> EngineContext:
    game = spec(game_id)
    return EngineContext(game=game, settings=dict(game.defaults), max_difficulty=cap)


def grid(param_min: float, param_max: float, step: float) -> list[float]:
    count = round((param_max - param_min) / step)
    return [param_min + index * step for index in range(count + 1)]


# The mapping


def test_every_adaptable_value_survives_a_round_trip() -> None:
    for game in load_specs():
        for param in adaptable_params(game):
            for value in grid(param.min, param.max, param.step):
                expected = snap(param, value)
                assert value_at(param, d_of(param, expected)) == pytest.approx(expected), (
                    game.id,
                    param.name,
                    value,
                )


def test_easy_and_hard_follow_which_way_is_harder() -> None:
    reach = spec("reach_activate")
    distance = next(p for p in reach.params if p.name == "distance_frac")
    radius = next(p for p in reach.params if p.name == "target_radius_sw")
    assert easy_hard(distance) == (0.4, 1.1)  # Farther is harder.
    assert easy_hard(radius) == (0.6, 0.25)  # Smaller is harder.
    assert value_at(distance, 0) == 0.4 and value_at(distance, 1) == 1.1
    assert value_at(radius, 0) == 0.6 and value_at(radius, 1) == 0.25


def test_values_are_rounded_to_the_step_and_kept_in_bounds() -> None:
    reach = spec("reach_activate")
    distance = next(p for p in reach.params if p.name == "distance_frac")
    window = next(p for p in reach.params if p.name == "activation_window_ms")
    assert value_at(distance, 0.33) == 0.65  # 0.4 + 0.231, on 0.05 steps.
    assert value_at(window, 0.5) == 2750  # 4000 - 1250 on 250 ms steps.
    assert value_at(distance, 1.7) == 1.1 and value_at(distance, -2) == 0.4
    assert value_at(distance, float("nan")) == 0.4
    for game in load_specs():
        for param in adaptable_params(game):
            for d in (0, 0.13, 0.5, 0.77, 1):
                value = value_at(param, d)
                assert param.min <= value <= param.max
                steps = (value - param.min) / param.step
                assert steps == pytest.approx(round(steps), abs=1e-6), (game.id, param.name)


def test_only_adaptable_settings_move() -> None:
    for game in load_specs():
        for param in game.params:
            if param.component == "fixed":
                assert param not in adaptable_params(game)
    reach = spec("reach_activate")
    assert components_of(reach) == ["spatial", "activation", "precision"]
    assert components_of(spec("fruit_catch")) == ["spatial", "speed", "precision"]
    hard = params_for(reach, {"spatial": 1, "activation": 1, "precision": 1}, reach.defaults)
    assert hard["rest_ms"] == reach.defaults["rest_ms"]
    assert hard["direction_deg"] == reach.defaults["direction_deg"]
    assert hard["distance_frac"] == 1.1


def test_the_inverse_mapping_reproduces_the_admin_defaults() -> None:
    for game in load_specs():
        state = initial_state(game, game.defaults)
        params = params_for(game, state, game.defaults)
        for component in components_of(game):
            members = [p for p in adaptable_params(game) if p.component == component]
            if len(members) == 1:
                # One setting: exactly its default.
                assert params[members[0].name] == pytest.approx(members[0].default), game.id
            else:
                # Several: their mean d is kept, each within the spread of their own d values.
                ds = [d_of(p, p.default) for p in members]
                assert min(ds) - 1e-9 <= state[component] <= max(ds) + 1e-9
    # Admin defaults are followed too, not only the spec's (the time limit is grip_hold's only
    # speed setting).
    grip = spec("grip_hold")
    settings = {**grip.defaults, "time_limit_ms": 12000}
    assert params_for(grip, initial_state(grip, settings), settings)["time_limit_ms"] == 12000


def test_level_for_patients() -> None:
    assert level_of({}) == 1
    assert level_of({"spatial": 0, "speed": 0}) == 1
    assert level_of({"spatial": 1, "speed": 1}) == 10
    assert level_of({"spatial": 0.5, "speed": 0.5}) == 6


# The staircase


Staircase = tuple[StaircaseEngine, EngineContext, EngineData]
EVEN = {"spatial": 0.5, "activation": 0.5, "precision": 0.5}


def staircase(game_id: str, d: dict[str, float], cap: float = 1.0) -> Staircase:
    return StaircaseEngine(), context(game_id, cap), EngineData(d=dict(d))


def test_two_successes_make_one_component_harder() -> None:
    engine, ctx, state = staircase("reach_activate", EVEN)
    state, decision = engine.update(state, TrialResult("success"), ctx)
    assert state.d == {"spatial": 0.5, "activation": 0.5, "precision": 0.5}
    assert state.streak == 1 and decision.changes == {}
    state, decision = engine.update(state, TrialResult("success"), ctx)
    assert state.streak == 0
    assert decision.changes == {"spatial": (0.5, 0.5 + STEP_UP)}
    assert "harder" in decision.reason


def test_successes_take_turns_and_prefer_the_most_headroom() -> None:
    engine, ctx, state = staircase("reach_activate", EVEN)
    moved = []
    for _ in range(6):
        state, decision = engine.update(state, TrialResult("success"), ctx)
        moved += list(decision.changes)
    # Equal room: each in turn.
    assert moved == ["spatial", "activation", "precision"]
    uneven = {"spatial": 0.9, "activation": 0.2, "precision": 0.5}
    engine, ctx, state = staircase("reach_activate", uneven)
    for _ in range(2):
        state, decision = engine.update(state, TrialResult("success"), ctx)
    assert list(decision.changes) == ["activation"]


def test_failures_ease_the_component_they_point_at() -> None:
    start = {"spatial": 0.5, "activation": 0.5, "precision": 0.5}
    engine, ctx, state = staircase("reach_activate", start)
    after, decision = engine.update(state, TrialResult("reach_fail"), ctx)
    assert decision.changes == {"spatial": (0.5, 0.5 - STEP_DOWN)}
    after, decision = engine.update(state, TrialResult("activation_fail"), ctx)
    assert decision.changes == {"activation": (0.5, 0.5 - STEP_DOWN)}
    # A miss in a game without a speed setting eases the spatial one.
    after, decision = engine.update(state, TrialResult("miss"), ctx)
    assert list(decision.changes) == ["spatial"]


def test_a_reach_fail_with_spatial_already_easiest_eases_precision() -> None:
    engine, ctx, state = staircase("reach_activate", {**EVEN, "spatial": 0.0})
    _, decision = engine.update(state, TrialResult("reach_fail"), ctx)
    assert decision.changes == {"precision": (0.5, 0.5 - STEP_DOWN)}


def test_a_miss_in_a_timed_game_eases_speed() -> None:
    engine, ctx, state = staircase("fruit_catch", {"spatial": 0.5, "speed": 0.5, "precision": 0.5})
    _, decision = engine.update(state, TrialResult("miss"), ctx)
    assert decision.changes == {"speed": (0.5, 0.5 - STEP_DOWN)}
    engine, ctx, state = staircase("fruit_catch", {"spatial": 0.5, "speed": 0.0, "precision": 0.5})
    _, decision = engine.update(state, TrialResult("miss"), ctx)
    assert list(decision.changes) == ["spatial"]


def test_any_other_failure_eases_everything_by_half_a_step() -> None:
    # Path trace has no activation setting.
    engine, ctx, state = staircase("path_trace", {"spatial": 0.5, "speed": 0.5, "precision": 0.02})
    after, decision = engine.update(state, TrialResult("activation_fail"), ctx)
    assert after.d == {"spatial": 0.46, "speed": 0.46, "precision": 0.0}
    assert set(decision.changes) == {"spatial", "speed", "precision"}
    easiest = EngineData(d={"spatial": 0, "speed": 0, "precision": 0})
    floor, decision = engine.update(easiest, TrialResult("activation_fail"), ctx)
    assert floor.d == {"spatial": 0, "speed": 0, "precision": 0}
    assert "easiest" in decision.reason


def test_a_failure_resets_the_streak_and_a_stopped_trial_changes_nothing() -> None:
    engine, ctx, state = staircase("bloom", {"activation": 0.5, "speed": 0.5})
    state, _ = engine.update(state, TrialResult("success"), ctx)
    assert state.streak == 1
    stopped, decision = engine.update(state, TrialResult("aborted"), ctx)
    assert stopped == state and decision.changes == {}
    failed, _ = engine.update(state, TrialResult("miss"), ctx)
    assert failed.streak == 0


def test_never_above_the_admins_maximum_or_below_zero() -> None:
    start = {"activation": 0.48, "precision": 0.5, "speed": 0.1}
    engine, ctx, state = staircase("grip_hold", start, cap=0.5)
    for _ in range(40):
        state, _ = engine.update(state, TrialResult("success"), ctx)
    assert all(d <= 0.5 for d in state.d.values())
    state, decision = engine.update(state, TrialResult("success"), ctx)
    state, decision = engine.update(state, TrialResult("success"), ctx)
    assert "highest level allowed" in decision.reason
    for _ in range(40):
        state, _ = engine.update(state, TrialResult("reach_fail"), ctx)
        state, _ = engine.update(state, TrialResult("miss"), ctx)
    assert all(d >= 0 for d in state.d.values())
    # The settings follow the cap even if a stored d is above it.
    hardest = EngineData(d={"activation": 1, "precision": 1, "speed": 1})
    params, _ = engine.next_params(hardest, ctx)
    grip = spec("grip_hold")
    band = next(p for p in grip.params if p.name == "band_width")
    assert params["band_width"] == value_at(band, 0.5)
    for param in grip.params:
        assert param.min <= params[param.name] <= param.max


def test_l0_always_gives_the_admin_defaults() -> None:
    engine = FixedEngine()
    ctx = context("reach_activate")
    state = engine.initial(ctx)
    params, decision = engine.next_params(state, ctx)
    assert params == ctx.settings
    after, decision = engine.update(state, TrialResult("reach_fail"), ctx)
    assert after == state and "Fixed" in decision.reason


def test_engine_modes() -> None:
    assert get_engine("L0").name == "L0"
    assert get_engine("L1").name == "L1"
    assert get_engine("L2").name == "L2"  # Behaves like L1 until Day 13.
    assert isinstance(get_engine("L2"), StaircaseEngine)
    assert get_engine("other").name == "L1"


# A simulated patient

OUTCOME_FOR = {
    "spatial": "reach_fail",
    "precision": "reach_fail",
    "activation": "activation_fail",
    "speed": "miss",
}


def simulate(
    game_id: str, ability: float, seed: int, trials: int = 200
) -> tuple[list[bool], EngineData]:
    """A patient of fixed ability: success is likelier the further the mean difficulty is below
    their ability. A failure is blamed on a component, the harder ones more often."""
    rng = random.Random(seed)
    engine = StaircaseEngine()
    ctx = context(game_id)
    state = engine.initial(ctx)
    results = []
    for _ in range(trials):
        mean = sum(state.d.values()) / len(state.d)
        success = rng.random() < 1 / (1 + math.exp((mean - ability) / 0.08))
        if success:
            outcome = "success"
        else:
            components = list(state.d)
            weights = [state.d[component] + 0.05 for component in components]
            outcome = OUTCOME_FOR[rng.choices(components, weights)[0]]
        state, _ = engine.update(state, TrialResult(outcome), ctx)
        results.append(success)
    return results, state


@pytest.mark.parametrize(
    "game_id", ["reach_activate", "fruit_catch", "bloom", "pick_place", "grip_hold"]
)
@pytest.mark.parametrize("ability", [0.3, 0.5, 0.7])
def test_a_simulated_patient_settles_between_60_and_80_percent(
    game_id: str, ability: float
) -> None:
    for seed in range(3):
        results, state = simulate(game_id, ability, seed)
        # After a 50-trial run-in, from wherever the admin's defaults started it.
        settled = sum(results[50:]) / len(results[50:])
        assert 0.6 <= settled <= 0.8, (game_id, ability, seed, settled)
        assert 0.6 <= sum(results) / len(results) <= 0.85
        # The difficulty found tracks the patient's ability.
        mean = sum(state.d.values()) / len(state.d)
        assert abs(mean - ability) < 0.2, (game_id, ability, mean)


# Warm restart and persistence


def test_warm_restart_eases_every_component() -> None:
    eased = warm_restart(EngineData(d={"spatial": 0.5, "speed": 0.03}, streak=1, turn=2))
    assert eased.d == {"spatial": 0.5 - WARM_RESTART, "speed": 0.0}
    assert eased.streak == 0 and eased.turn == 2


def patient(session: Session) -> PatientProfile:
    return session.exec(select(PatientProfile)).one()


def test_profiles_default_to_l1_with_no_maximum(
    session: Session, patient_headers: Headers
) -> None:
    profile = patient(session)
    assert profile.engine_mode == "L1"
    assert profile.max_difficulty == {}
    assert engine_store.max_difficulty(profile, "bloom") == 1.0
    profile.max_difficulty = {"bloom": 0.4, "grip_hold": "oops"}
    assert engine_store.max_difficulty(profile, "bloom") == 0.4
    assert engine_store.max_difficulty(profile, "grip_hold") == 1.0


def test_state_is_kept_between_trials_and_eased_between_sessions(
    session: Session, patient_headers: Headers
) -> None:
    profile = patient(session)
    first = engine_store.load(session, profile, "reach_activate", session_id=1)
    assert first.engine.name == "L1"
    assert first.row.id is None  # Not saved until it is used.
    stepped = EngineData(d={component: 0.6 for component in first.state.d})
    row = engine_store.save(session, first, stepped, session_id=1, trials=3)
    assert row.trials_seen == 3 and row.state["session_id"] == 1

    # The same session: exactly where it was.
    again = engine_store.load(session, profile, "reach_activate", session_id=1)
    assert again.state.d == stepped.d
    # A new session: eased a little.
    later = engine_store.load(session, profile, "reach_activate", session_id=2)
    assert all(d == pytest.approx(0.55) for d in later.state.d.values())
    engine_store.save(session, later, later.state, session_id=2, trials=2)
    rows = session.exec(select(EngineState)).all()
    assert len(rows) == 1 and rows[0].trials_seen == 5


def test_each_engine_and_game_has_its_own_state(
    session: Session, patient_headers: Headers
) -> None:
    profile = patient(session)
    loaded = engine_store.load(session, profile, "bloom", session_id=1)
    engine_store.save(session, loaded, loaded.state, session_id=1)
    profile.engine_mode = "L0"
    loaded = engine_store.load(session, profile, "bloom", session_id=1)
    assert loaded.engine.name == "L0" and loaded.row.id is None
    engine_store.save(session, loaded, loaded.state, session_id=1)
    other = engine_store.load(session, profile, "grip_hold", session_id=1)
    engine_store.save(session, other, other.state, session_id=1)
    keys = {(row.game_id, row.engine) for row in session.exec(select(EngineState)).all()}
    assert keys == {("bloom", "L1"), ("bloom", "L0"), ("grip_hold", "L0")}


def test_loading_starts_from_the_admin_defaults_and_the_cap(
    session: Session, patient_headers: Headers
) -> None:
    profile = patient(session)
    session.add(GameSetting(game_id="grip_hold", default_params={"hold_ms": 8000}))
    session.commit()
    loaded = engine_store.load(session, profile, "grip_hold", session_id=1)
    params, _ = loaded.engine.next_params(loaded.state, loaded.context)
    assert loaded.context.settings["hold_ms"] == 8000
    profile.max_difficulty = {"grip_hold": 0.2}
    capped = engine_store.load(session, profile, "grip_hold", session_id=1)
    assert all(d <= 0.2 for d in capped.state.d.values())
    with pytest.raises(engine_store.UnknownGameError):
        engine_store.load(session, profile, "chess", session_id=1)
    assert params["hold_ms"] >= 2000
