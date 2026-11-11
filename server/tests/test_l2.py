"""L2: Bayesian, workspace-aware difficulty (app/engine/l2_bayes.py)."""

import copy
import random
import re
import time
from collections import Counter
from typing import Any

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from test_engine_api import logs, new_run, profile, step, trial
from test_games import start_run, start_session

from app.engine import get_engine
from app.engine.base import EngineContext, EngineData, TrialResult
from app.engine.difficulty import adaptable_params, value_at
from app.engine.l2_bayes import (
    GAMMA,
    LEVEL_COUNT,
    P_STAR,
    RING_PRIORS,
    BayesEngine,
    beta_mean,
    component_target,
    monotone_levels,
    ring_of,
    sectors_of,
    spatial_spec,
)
from app.engine.sim import simulate
from app.models import EngineState
from app.schemas.engine import LastTrial
from app.services.adaptation import PastStep, decide
from app.services.game_specs import GameSpec, get_spec
from scripts.smoke_test import calibration_payload

SECTOR = re.compile(r"^D[0-7]R[1-4]$")


def game(game_id: str = "reach_activate") -> GameSpec:
    spec = get_spec(game_id)
    assert spec is not None
    return spec


def context(game_id: str = "reach_activate", **changes: Any) -> EngineContext:
    spec = game(game_id)
    return EngineContext(game=spec, settings=spec.defaults, **changes)


def fresh(game_id: str = "reach_activate", seed: int = 0, **changes: Any) -> EngineData:
    return BayesEngine(seed).initial(context(game_id, **changes))


def with_sectors(state: EngineData, **sectors: list[float]) -> EngineData:
    extra = copy.deepcopy(state.extra)
    extra["sectors"].update(sectors)
    return EngineData(d=dict(state.d), extra=extra)


# Sectors and priors


def test_sectors_per_game() -> None:
    reach = sectors_of(game())
    assert set(reach) == {f"D{i}R{r}" for i in range(8) for r in (1, 2, 3, 4)}
    assert reach["D0R1"].values == (0.4, 0.45, 0.5)
    assert all(0.55 <= value <= 0.85 for value in reach["D0R2"].values)
    assert reach["D0R4"].values == (1.05, 1.1)
    balloon = sectors_of(game("balloon_pop"))
    assert {name[:2] for name in balloon} == {"D1", "D2", "D3"}
    fruit = sectors_of(game("fruit_catch"))
    assert {name.split("-")[0] for name in fruit} == {"out", "across"}
    # Pick and place reaches 1.0 at most: no stretch ring.
    assert not any(name.endswith("R4") for name in sectors_of(game("pick_place")))
    for game_id in ("bloom", "finger_piano", "paint_wall", "grip_hold"):
        assert sectors_of(game(game_id)) == {}
        assert spatial_spec(game(game_id)) is None


def test_rings_follow_the_distance() -> None:
    assert [ring_of(x) for x in (0.4, 0.5, 0.55, 0.85, 0.9, 1.0, 1.05)] == [1, 1, 2, 2, 3, 3, 4]


def test_ring_priors_without_a_calibration_or_warm_up() -> None:
    state = fresh()
    for name, ab in state.extra["sector_priors"].items():
        assert ab == pytest.approx(list(RING_PRIORS[int(name[-1])]))
    assert state.extra["sectors"] == state.extra["sector_priors"]


def test_calibration_and_warm_up_seed_the_priors() -> None:
    radii = (1.0, 1.0, 1.0, 0.6, 1.0, 1.0, 1.0, 1.0)  # direction 3 is weak
    warmup = {
        "forward_reach": {"completion": 1.0, "compensation_rate": 0.0},
        "hand_open_close": {"completion": 1.0, "compensation_rate": 0.0},
    }
    seeded = fresh(calibration=radii, warmup=warmup).extra
    plain = fresh().extra
    means = {name: beta_mean(ab) for name, ab in seeded["sector_priors"].items()}
    assert means["D3R1"] == pytest.approx(0.8)
    assert means["D3R2"] < means["D0R2"] == pytest.approx(0.6)
    # A complete forward reach in the warm-up makes the far rings likelier.
    assert means["D0R3"] > 0.5 and means["D0R4"] > 0.25
    hand = [beta_mean(ab) for ab in seeded["level_priors"]["activation"]]
    assert all(
        a > b for a, b in zip(hand, [beta_mean(ab) for ab in plain["level_priors"]["activation"]])
    )


def test_level_priors_fall_from_easy_to_hard_around_the_default() -> None:
    state = fresh()
    for component, levels in state.extra["level_priors"].items():
        means = [beta_mean(ab) for ab in levels]
        assert len(means) == LEVEL_COUNT
        assert means == sorted(means, reverse=True), component
        assert any(abs(mean - P_STAR) < 0.07 for mean in means)
    assert set(state.extra["levels"]) == {"activation", "precision"}
    # A game without sectors chooses every component by level.
    assert set(fresh("bloom").extra["levels"]) == {"activation", "speed"}


def test_each_part_aims_so_the_trial_aims_at_p_star() -> None:
    assert component_target(game()) == pytest.approx(P_STAR ** (1 / 3))
    assert component_target(game("bloom")) == pytest.approx(P_STAR ** (1 / 2))


# Belief updates


def test_a_success_raises_the_sector_and_every_level_used() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    used = {c: round(state.d[c] * 5) for c in state.extra["levels"]}
    after, decision = engine.update(
        state, TrialResult("success", direction_deg=90, distance_frac=0.7), ctx
    )
    assert after.extra["sectors"]["D2R2"] == [4.0, 2.0]
    for component, index in used.items():
        before_a = state.extra["levels"][component][index][0]
        assert after.extra["levels"][component][index][0] >= before_a + 1 - 1e-6
    assert decision.reason.startswith("Success in D2R2")
    assert "sampled" in decision.reason and decision.details["sector_samples"]


def test_a_reach_failure_is_shared_with_the_precision_level() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    index = round(state.d["precision"] * 5)
    after, _ = engine.update(
        state, TrialResult("reach_fail", direction_deg=0, distance_frac=0.95), ctx
    )
    sector_gain = after.extra["sectors"]["D0R3"][1] - 2.0
    precision_before = state.extra["levels"]["precision"][index]
    precision_after = after.extra["levels"]["precision"][index]
    precision_gain = (precision_after[0] + precision_after[1]) - sum(precision_before)
    assert 0 < sector_gain < 1 and 0 < precision_gain < 1
    assert sector_gain + precision_gain == pytest.approx(1.0, abs=1e-3)
    # The sector (mean 0.5) was likelier to fail than the precision level: most blame there.
    assert sector_gain > precision_gain


def test_a_miss_without_a_speed_component_counts_against_the_sector() -> None:
    engine, ctx = BayesEngine(), context()
    after, _ = engine.update(
        fresh(), TrialResult("miss", direction_deg=45, distance_frac=0.45), ctx
    )
    assert after.extra["sectors"]["D1R1"] == [4.0, 2.0]


def test_activation_failures_leave_the_spatial_beliefs_alone() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    index = round(state.d["activation"] * 5)
    after, _ = engine.update(
        state, TrialResult("activation_fail", direction_deg=0, distance_frac=0.7), ctx
    )
    assert after.extra["sectors"] == state.extra["sectors"]
    before = state.extra["levels"]["activation"][index]
    now = after.extra["levels"]["activation"][index]
    assert sum(now) == pytest.approx(sum(before) + 1)


def test_without_a_reported_target_the_engines_own_choice_is_credited() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    chosen = state.extra["next"]["sector"]
    after, _ = engine.update(state, TrialResult("success"), ctx)
    ab = after.extra["sectors"][chosen]
    assert ab[0] == pytest.approx(state.extra["sectors"][chosen][0] + 1)


def test_a_stopped_trial_changes_nothing() -> None:
    state = fresh()
    after, decision = BayesEngine().update(state, TrialResult("aborted"), context())
    assert after == state and "unchanged" in decision.reason


# Choosing


def test_the_stretch_ring_unlocks_after_five_trials_above_0_8() -> None:
    engine, ctx = BayesEngine(), context()
    extra = copy.deepcopy(fresh().extra)
    assert not any(name.endswith("R4") for name in engine.allowed_sectors(extra, ctx))
    extra["sectors"]["D0R3"] = [9.0, 1.0]
    extra["seen"]["D0R3"] = 4
    assert "D0R4" not in engine.allowed_sectors(extra, ctx)
    extra["seen"]["D0R3"] = 5
    allowed = engine.allowed_sectors(extra, ctx)
    assert "D0R4" in allowed and "D1R4" not in allowed
    extra["sectors"]["D0R3"] = [8.0, 2.0]  # mean 0.8 exactly: not above
    assert "D0R4" not in engine.allowed_sectors(extra, ctx)


def test_thompson_sampling_prefers_the_sector_near_the_aim() -> None:
    aim = component_target(game())
    chosen: Counter[str] = Counter()
    for seed in range(200):
        state = fresh(seed=seed)
        extra = copy.deepcopy(state.extra)
        for name in extra["sectors"]:
            extra["sectors"][name] = [1.0, 30.0]  # hopeless
        extra["sectors"]["D2R2"] = [aim * 100, (1 - aim) * 100]
        extra["sectors"]["D5R1"] = [99.0, 1.0]  # too easy
        extra["visits"] = {name: 0 for name in extra["sectors"]}
        picked, _ = BayesEngine(seed)._choose(EngineData(d=dict(state.d), extra=extra), context())
        chosen[picked.extra["next"]["sector"]] += 1
    assert chosen["D2R2"] >= 180, chosen


def test_no_sector_is_chosen_more_than_twice_in_a_row() -> None:
    engine, ctx = BayesEngine(3), context()
    aim = component_target(game())
    state = fresh(seed=3)
    for name in state.extra["sectors"]:
        state.extra["sectors"][name] = [1.0, 30.0]
    state.extra["sectors"]["D4R2"] = [aim * 500, (1 - aim) * 500]
    sequence = []
    for _ in range(60):
        state, _ = engine.update(state, TrialResult("aborted"), ctx)
        state, _ = engine._choose(state, ctx)
        sequence.append(state.extra["next"]["sector"])
    assert sequence.count("D4R2") >= 30
    assert all(not (a == b == c) for a, b, c in zip(sequence, sequence[1:], sequence[2:]))


def test_directions_with_compensation_lose_their_far_rings() -> None:
    engine, ctx = BayesEngine(), context()
    extra = copy.deepcopy(fresh().extra)
    extra["comp"] = {"D2": [[True, 3], [False, 2], [True, 3]]}
    allowed = engine.allowed_sectors(extra, ctx)
    assert {"D2R1", "D2R2"} <= set(allowed)
    assert "D2R3" not in allowed
    extra["comp"] = {"D2": [[True, 2], [True, 3], [False, 1]]}
    allowed = engine.allowed_sectors(extra, ctx)
    assert "D2R1" in allowed and "D2R2" not in allowed and "D2R3" not in allowed
    # One compensated trial in three is not enough; other directions are untouched.
    extra["comp"] = {"D2": [[True, 3], [False, 3], [False, 3]]}
    assert "D2R3" in engine.allowed_sectors(extra, ctx)


def test_compensation_through_update_blocks_that_direction() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    for _ in range(2):
        state, _ = engine.update(
            state,
            TrialResult("success", compensated=True, direction_deg=135, distance_frac=0.9),
            ctx,
        )
    assert "D3R3" not in engine.allowed_sectors(state.extra, ctx)
    assert "D3R3" in state.extra["sectors"]


def test_levels_stay_monotone() -> None:
    levels = [[2.0, 2.0], [9.0, 1.0], [1.0, 9.0], [3.0, 1.0], [1.0, 3.0], [1.0, 1.0]]
    fixed = monotone_levels(levels)
    means = [beta_mean(ab) for ab in fixed]
    assert all(a >= b - 1e-3 for a, b in zip(means, means[1:]))
    # Counts are kept; only the means move.
    assert [sum(ab) for ab in fixed] == pytest.approx([sum(ab) for ab in levels])
    already = [[5.0, 1.0], [4.0, 2.0], [3.0, 3.0], [2.0, 4.0], [1.0, 5.0], [1.0, 9.0]]
    assert monotone_levels(already) == already

    engine, ctx = BayesEngine(), context("bloom")
    state = fresh("bloom")
    rng = random.Random(1)
    for _ in range(80):
        outcome = rng.choice(["success", "activation_fail", "miss"])
        state, _ = engine.update(state, TrialResult(outcome), ctx)
        for component_levels in state.extra["levels"].values():
            means = [beta_mean(ab) for ab in component_levels]
            assert all(a >= b - 1e-3 for a, b in zip(means, means[1:]))


def test_forgetting_moves_beliefs_back_towards_the_priors() -> None:
    engine, ctx = BayesEngine(), context()
    state = fresh()
    state.extra["sectors"]["D0R2"] = [10.0, 4.0]
    state.extra["levels"]["activation"][2] = [12.0, 6.0]
    prior_level = state.extra["level_priors"]["activation"][2]
    state.extra["last"], state.extra["repeats"] = "D0R2", 2
    renewed = engine.new_session(state, ctx)
    assert renewed.extra["sectors"]["D0R2"] == pytest.approx([3 + GAMMA * 7, 2 + GAMMA * 2])
    assert renewed.extra["levels"]["activation"][2] == pytest.approx(
        [p + GAMMA * (v - p) for p, v in zip(prior_level, [12.0, 6.0])]
    )
    assert renewed.extra["sectors"]["D1R1"] == pytest.approx(list(RING_PRIORS[1]))
    assert renewed.extra["comp"] == {} and renewed.extra["repeats"] in (0, 1)


def test_the_same_state_gives_the_same_choice() -> None:
    a, _ = BayesEngine(4).update(fresh(seed=4), TrialResult("success"), context())
    b, _ = BayesEngine(4).update(fresh(seed=4), TrialResult("success"), context())
    assert a == b
    others = {
        BayesEngine(seed).initial(context()).extra["next"]["sector"] for seed in range(20)
    }
    assert len(others) > 1


# With the safety layer


def test_the_safety_layer_still_caps_everything() -> None:
    engine = get_engine("L2")
    ctx = context(max_difficulty=0.3)
    spec = spatial_spec(game())
    assert spec is not None
    state = engine.initial(ctx)
    past: list[PastStep] = []
    rng = random.Random(2)
    step_ = decide(engine, ctx, state, None, past)
    for n in range(1, 61):
        outcome = rng.choice(["success", "success", "reach_fail", "activation_fail"])
        target = step_.target
        assert target is not None
        last = LastTrial(
            trial_no=n,
            outcome=outcome,  # type: ignore[arg-type]
            direction_deg=target.direction_deg,
            distance_frac=target.distance_frac,
        )
        step_ = decide(engine, ctx, step_.state, last, past)
        past.append(PastStep(n, last.model_dump(), step_.cue))
        assert all(d <= 0.3 + 1e-9 for d in step_.state.d.values())
        for param in adaptable_params(game()):
            assert param.min <= step_.params[param.name] <= param.max
        assert step_.target is not None
        assert step_.target.distance_frac <= value_at(spec, 0.3) + 1e-9
        assert step_.params["distance_frac"] == step_.target.distance_frac


def test_safety_easing_moves_the_target_closer() -> None:
    engine, ctx = get_engine("L2"), context()
    state = engine.initial(ctx)
    past: list[PastStep] = []
    for n in range(1, 4):
        last = LastTrial(trial_no=n, outcome="activation_fail")
        result = decide(engine, ctx, state, last, past)
        past.append(PastStep(n, last.model_dump(), result.cue))
        state = result.state
    assert result.safety_override and "3 failures in a row" in result.safety_override
    assert result.target is not None
    proposed = state.extra["next"]["distance_frac"]
    assert result.target.distance_frac <= proposed
    assert ring_of(result.target.distance_frac) == int(result.target.sector[-1])


# Through the API and the simulator


def l2_patient(session: Session) -> None:
    patient = profile(session)
    patient.engine_mode = "L2"
    session.add(patient)
    session.commit()


def test_l2_patients_get_a_target_and_logged_samples(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    run_id = new_run(client, patient_headers)
    first = step(client, patient_headers, run_id)
    timings = []
    answers = [first]
    for n in range(1, 41):
        last = trial(
            n,
            "success" if n % 3 else "reach_fail",
            direction_deg=answers[-1]["direction_deg"],
            distance_frac=answers[-1]["distance_frac"],
        )
        started = time.perf_counter()
        answers.append(step(client, patient_headers, run_id, last))
        timings.append(time.perf_counter() - started)
    # Whole HTTP calls with the database; the engine's own step is checked separately below.
    p95 = sorted(timings)[int(0.95 * len(timings)) - 1]
    assert p95 < 0.1, f"95th percentile {p95 * 1000:.0f} ms"
    for answer in answers:
        assert answer["engine"] == "L2"
        assert answer["direction_deg"] in [45.0 * i for i in range(8)]
        assert SECTOR.match(answer["sector"])
        assert ring_of(answer["distance_frac"]) == int(answer["sector"][-1])
        assert answer["params"]["distance_frac"] == answer["distance_frac"]
        assert answer["side"] is None
    rows = logs(session)
    assert rows[0].details is not None and rows[0].details["target"]["sector"] == first["sector"]
    assert any("sampled" in row.decision for row in rows)
    assert all(row.details and "sector_samples" in row.details for row in rows[1:])
    assert rows[1].trial is not None and rows[1].trial["direction_deg"] == first["direction_deg"]


def test_games_without_directions_get_no_target(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id, game_id="bloom")
    body = step(client, patient_headers, run_id)
    assert body["engine"] == "L2"
    assert body["direction_deg"] is None and body["sector"] is None
    assert body["distance_frac"] is None
    body = step(client, patient_headers, run_id, trial(1, "activation_fail"))
    assert "level" in body["decision"]


def test_fruit_catch_targets_use_sides(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id, game_id="fruit_catch")
    body = step(client, patient_headers, run_id)
    assert body["side"] in ("out", "across") and body["direction_deg"] is None
    assert re.match(r"^(out|across)-R[1-4]$", body["sector"])


def test_l2_uses_the_latest_calibration(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    session_id = start_session(client, patient_headers)
    calibration = calibration_payload("left")
    radii = list(calibration["reach_radii_sw"])
    radii[3] = radii[3] * 0.5  # direction 3 (135 degrees) is weak
    calibration["reach_radii_sw"] = radii
    response = client.post(
        f"/api/sessions/{session_id}/calibration", json=calibration, headers=patient_headers
    )
    assert response.status_code == 201, response.text
    run_id = start_run(client, patient_headers, session_id)
    step(client, patient_headers, run_id)
    stored = session.exec(select(EngineState)).one()
    priors = stored.state["extra"]["sector_priors"]
    assert beta_mean(priors["D3R2"]) < beta_mean(priors["D0R2"])


def test_the_simulator_runs_l2_within_bounds_for_every_game() -> None:
    for game_id in (
        "reach_activate",
        "balloon_pop",
        "fruit_catch",
        "bloom",
        "finger_piano",
        "path_trace",
        "paint_wall",
        "pick_place",
        "grip_hold",
    ):
        result = simulate("L2", "moderate", 2, 2, 30, game_id=game_id, seed=1, max_difficulty=0.7)
        specs = adaptable_params(game(game_id))
        assert len(result.decisions) == 2 * 2 * 31
        for decision in result.decisions:
            assert all(d <= 0.7 + 1e-9 for d in decision.state_after.values())
            for spec in specs:
                assert spec.min <= decision.params[spec.name] <= spec.max


def test_the_simulator_and_the_api_agree_for_l2(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    result = simulate("L2", "moderate", n_patients=1, sessions=1, trials_per_session=30, seed=9)
    run_id = new_run(client, patient_headers)
    answers = [step(client, patient_headers, run_id)]
    answers += [step(client, patient_headers, run_id, t.summary) for t in result.trials]
    for answer, decision in zip(answers, result.decisions, strict=True):
        assert answer["params"] == decision.params
        assert answer["decision"] == decision.decision
        assert answer["level"] == decision.level


def test_an_l2_decision_takes_well_under_100_ms() -> None:
    engine, ctx = get_engine("L2"), context()
    result = decide(engine, ctx, engine.initial(ctx), None, [])
    past: list[PastStep] = []
    timings = []
    for n in range(1, 201):
        target = result.target
        assert target is not None
        last = LastTrial(
            trial_no=n,
            outcome="success" if n % 3 else "reach_fail",  # type: ignore[arg-type]
            direction_deg=target.direction_deg,
            distance_frac=target.distance_frac,
        )
        started = time.perf_counter()
        result = decide(engine, ctx, result.state, last, past)
        timings.append(time.perf_counter() - started)
        past.append(PastStep(n, last.model_dump(), result.cue))
    assert max(timings) < 0.02, f"slowest decision {max(timings) * 1000:.1f} ms"
