"""The patient simulator (app/engine/sim): the patient model, the runner and the measures."""

from statistics import fmean

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from test_engine_api import new_run, step

from app.engine.difficulty import adaptable_params, params_for
from app.engine.sim import PROFILES, SimPatient, simulate, summarise
from app.engine.sim.measures import (
    challenge_error,
    compensation_rate,
    learning_gain,
    measure_run,
    rolling_success,
    time_in_zone,
    trials_to_converge,
    workspace_coverage,
)
from app.engine.sim.patient import (
    ABILITY_CAP,
    Abilities,
    demands_for,
    sector_name,
    success_probability,
)
from app.services.game_specs import GameSpec, get_spec, load_specs


def reach_game() -> GameSpec:
    game = get_spec("reach_activate")
    assert game is not None
    return game


# The patient model


def test_profiles_draw_abilities_in_their_ranges() -> None:
    for name, profile in PROFILES.items():
        for seed in range(20):
            patient = SimPatient(name, seed)
            reach = patient.abilities.reach
            assert len(reach) == 8
            weak = [value for value in reach if value < profile.reach[0]]
            assert len(weak) == profile.weak_directions, name
            assert all(0 < value <= ABILITY_CAP for value in patient.abilities.values())
            assert abs(patient.abilities.activation - profile.activation) <= 0.05 + 1e-9
            assert patient.fatigue is not None and 0.05 <= patient.fatigue <= 0.3
            assert patient.eta is not None and 0.001 <= patient.eta <= 0.003


def test_success_follows_the_logistic() -> None:
    assert success_probability(0.7, 0.7, 8) == pytest.approx(0.5)
    assert success_probability(0.9, 0.7, 8) > 0.8
    assert success_probability(0.5, 0.7, 12) < success_probability(0.5, 0.7, 8)


def test_demands_use_distance_and_squeeze_values_and_d_for_the_rest() -> None:
    demands = demands_for(
        reach_game(),
        {
            "distance_frac": 0.9,
            "activation_demand": 0.6,
            "activation_window_ms": 4000,
            "target_radius_sw": 0.6,
            "dwell_ms": 300,
        },
    )
    assert demands["spatial"] == pytest.approx(0.9)
    assert demands["activation"] == pytest.approx(0.6)
    # The biggest target and the shortest dwell: precision at its easiest.
    assert demands["precision"] == pytest.approx(0.0)
    assert sector_name(3, 0.9) == "D3R3" and sector_name(0, 0.5) == "D0R1"


def test_a_patient_with_the_same_seed_behaves_the_same() -> None:
    game = reach_game()
    runs = []
    for _ in range(2):
        patient = SimPatient("moderate", 7)
        patient.start_session()
        runs.append([patient.attempt(game, game.defaults, n % 8) for n in range(30)])
    assert runs[0] == runs[1]
    other = SimPatient("moderate", 8)
    other.start_session()
    assert [other.attempt(game, game.defaults, n % 8) for n in range(30)] != runs[0]


def test_fatigue_lowers_success_late_in_a_session() -> None:
    game = reach_game()
    early, late = [], []
    for seed in range(60):
        patient = SimPatient("mild", seed, fatigue=0.3, tau=20)
        patient.start_session()
        attempts = [patient.attempt(game, game.defaults, n % 8) for n in range(60)]
        early += [attempt.success for attempt in attempts[:15]]
        late += [attempt.success for attempt in attempts[-15:]]
        assert patient.fatigue_factor() < 0.75
    assert fmean(late) < fmean(early) - 0.15


def test_a_rest_takes_away_half_the_tiredness() -> None:
    patient = SimPatient("mild", 1, fatigue=0.3, tau=20)
    patient.start_session()
    game = reach_game()
    for n in range(40):
        patient.attempt(game, game.defaults, n % 8)
    tired = patient.fatigue_factor()
    patient.rest()
    assert patient.fatigue_factor() > tired


def test_compensation_rises_beyond_the_reach() -> None:
    game = reach_game()
    near = {**game.defaults, "distance_frac": 0.4}
    far = {**game.defaults, "distance_frac": 1.1}
    within, beyond = [], []
    for seed in range(40):
        patient = SimPatient("severe", seed, fatigue=0.05)
        patient.start_session()
        within += [patient.attempt(game, near, n % 8).compensated for n in range(10)]
        beyond += [patient.attempt(game, far, n % 8).compensated for n in range(10)]
    assert fmean(beyond) > 0.3 > fmean(within)


def test_learning_raises_abilities_near_their_edge_and_stays_capped() -> None:
    game = reach_game()
    patient = SimPatient("moderate", 3, fatigue=0.05, eta=0.003)
    before = patient.abilities
    patient.start_session()
    # Every demand set at the patient's own ability.
    for n in range(80):
        direction = n % 8
        params = {
            **game.defaults,
            "distance_frac": round(patient.ability("spatial", direction), 2),
            "activation_demand": round(patient.ability("activation", None), 2),
        }
        patient.attempt(game, params, direction)
    after = patient.end_session()
    assert after.activation > before.activation
    assert sum(after.reach) > sum(before.reach)
    assert all(b >= a for a, b in zip(before.values(), after.values(), strict=True))
    assert all(value <= ABILITY_CAP for value in after.values())


def test_learning_raises_ability_across_sessions() -> None:
    result = simulate("L1", "severe", n_patients=6, sessions=6, trials_per_session=40, seed=4)
    for history in result.abilities:
        assert len(history) == 7
        first, last = history[0], history[-1]
        assert all(b >= a - 1e-12 for a, b in zip(first.values(), last.values(), strict=True))
    assert summarise(result).learning_gain is not None
    assert summarise(result).learning_gain > 0  # type: ignore[operator]


# The runner


def test_the_simulation_is_deterministic_with_a_seed() -> None:
    first = simulate("L1", "moderate", n_patients=3, sessions=2, trials_per_session=30, seed=5)
    again = simulate("L1", "moderate", n_patients=3, sessions=2, trials_per_session=30, seed=5)
    assert first.trials == again.trials
    assert first.decisions == again.decisions
    other = simulate("L1", "moderate", n_patients=3, sessions=2, trials_per_session=30, seed=6)
    assert other.trials != first.trials


@pytest.mark.parametrize("cap", [1.0, 0.5])
def test_l1_through_the_simulator_stays_within_bounds_and_logs_every_decision(
    cap: float,
) -> None:
    sessions, trials = 3, 40
    for game in load_specs():
        result = simulate(
            "L1", "moderate", 2, sessions, trials, game_id=game.id, seed=2, max_difficulty=cap
        )
        specs = adaptable_params(game)
        for decision in result.decisions:
            assert all(0.0 <= d <= cap + 1e-9 for d in decision.state_after.values()), game.id
            for spec in specs:
                assert spec.min <= decision.params[spec.name] <= spec.max, (game.id, spec.name)
            assert decision.decision
            assert 1 <= decision.level <= 10
        # One decision at the start of each session and one after every trial.
        assert len(result.decisions) == 2 * sessions * (trials + 1)
        assert len(result.trials) == 2 * sessions * trials
        starts = [d for d in result.decisions if d.trial_no == 0]
        assert [d.decision for d in starts] == ["Start of the game."] * (2 * sessions)


def test_directional_games_cycle_through_all_eight_directions() -> None:
    result = simulate("L1", "mild", n_patients=1, sessions=1, trials_per_session=16, seed=1)
    directions = [trial.direction for trial in result.trials]
    assert sorted(directions[:8]) == list(range(8)) and sorted(directions[8:]) == list(range(8))
    assert all(trial.sector and trial.sector.startswith("D") for trial in result.trials)
    fruit = simulate("L1", "mild", 1, 1, 10, game_id="fruit_catch", seed=1)
    assert all(trial.direction is None and trial.sector is None for trial in fruit.trials)


def test_l0_keeps_the_admin_defaults_in_the_simulator() -> None:
    result = simulate("L0", "moderate", n_patients=2, sessions=2, trials_per_session=20, seed=3)
    game = reach_game()
    defaults = params_for(game, {}, game.defaults)
    assert all(trial.params == defaults for trial in result.trials)
    assert {trial.level for trial in result.trials} == {result.trials[0].level}
    assert all(d.safety_override is None for d in result.decisions)


def test_the_simulator_and_the_api_make_the_same_decisions(
    client: TestClient, patient_headers: Headers
) -> None:
    """The simulator goes through the same code as POST /api/engine/next: replaying its trials
    through the API gives the same settings, levels, cues and overrides."""
    result = simulate("L1", "moderate", n_patients=1, sessions=1, trials_per_session=40, seed=9)
    run_id = new_run(client, patient_headers)
    answers = [step(client, patient_headers, run_id)]
    answers += [step(client, patient_headers, run_id, trial.summary) for trial in result.trials]
    assert len(answers) == len(result.decisions)
    for answer, decision in zip(answers, result.decisions, strict=True):
        assert answer["params"] == decision.params
        assert answer["level"] == decision.level
        assert answer["cue"] == decision.cue
        assert answer["safety_override"] == decision.safety_override
        assert answer["decision"] == decision.decision


# The measures


def test_rolling_success_uses_full_windows() -> None:
    assert rolling_success([True] * 9) == []
    assert rolling_success([True] * 10) == [1.0]
    pattern = [True] * 7 + [False] * 3
    assert rolling_success(pattern * 3) == [pytest.approx(0.7)] * 21
    assert rolling_success([False] * 10 + [True] * 2) == [0.0, 0.1, 0.2]


def test_challenge_error_and_time_in_zone() -> None:
    assert challenge_error([0.7, 0.7]) == pytest.approx(0.0)
    assert challenge_error([0.5, 0.9, 1.0]) == pytest.approx((0.2 + 0.2 + 0.3) / 3)
    assert challenge_error([]) is None
    assert time_in_zone([0.6, 0.7, 0.8, 0.9, 0.5]) == pytest.approx(0.6)
    assert time_in_zone([]) is None


def test_trials_to_converge() -> None:
    pattern = [True] * 7 + [False] * 3
    # In the zone from the first full window (trial 10), for 10 values.
    assert trials_to_converge(rolling_success(pattern * 2)) == 10
    # Twenty failures first: the window first reaches 0.6 at trial 26.
    late = [False] * 20 + pattern * 4
    rolling = rolling_success(late)
    converged = trials_to_converge(rolling)
    assert converged is not None and converged > 20
    assert all(0.6 - 1e-9 <= value <= 0.8 + 1e-9 for value in rolling[converged - 10 :][:10])
    assert trials_to_converge(rolling_success([True] * 40)) is None
    # Nine values in the zone are not enough.
    assert trials_to_converge([0.7] * 9 + [0.2]) is None


def test_compensation_coverage_and_learning_gain() -> None:
    assert compensation_rate([True, False, False, True]) == 0.5
    assert compensation_rate([]) is None
    sectors = ["D0R1"] * 3 + ["D1R2"] * 2 + ["D2R3"] * 5 + [None] * 4
    assert workspace_coverage(sectors) == 2
    assert workspace_coverage(sectors, min_visits=2) == 3
    before = Abilities(reach=(0.5,) * 8, activation=0.4, speed=0.5, precision=0.5)
    after = Abilities(reach=(0.6,) * 8, activation=0.4, speed=0.5, precision=0.5)
    assert learning_gain(before, after) == pytest.approx(0.8 / 11)


def test_measures_of_a_simulated_run() -> None:
    result = simulate("L1", "moderate", n_patients=1, sessions=1, trials_per_session=40, seed=1)
    run = measure_run(result.trials)
    assert run.trials == 40
    assert 0 <= run.success_rate <= 1
    assert run.challenge_error is not None and 0 <= run.challenge_error <= 0.7
    assert run.coverage >= 1
    summary = summarise(result)
    assert summary.runs == 1 and summary.engine == "L1" and summary.profile == "moderate"
