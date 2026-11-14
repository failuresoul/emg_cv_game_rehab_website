"""Day 12 review: the adaptive engine's guarantees, each checked on its own.

- Settings never leave the spec bounds or the patient's maximum, whatever happens.
- Every engine call writes exactly one decision log row.
- The warm restart happens once per session per game.
- L0 patients get exactly the admin's defaults, and their level never moves.
- The same trial reported twice at once gives one answer and one log row.
"""

import random

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, func, select
from test_engine_api import logs, new_run, profile, step, trial
from test_games import end_run, start_run, start_session

from app.engine import get_engine
from app.engine.base import EngineContext, EngineData, TrialResult
from app.engine.difficulty import adaptable_params, initial_state, params_for
from app.engine.safety import SafetyInput, TrialRecord, apply_safety
from app.models import AdaptationLog, EngineState
from app.services import adaptation
from app.services.engine_store import WARM_RESTART
from app.services.game_settings import effective_params_for
from app.services.game_specs import get_spec, load_specs
from tests.programme_helpers import set_programme

OUTCOMES = ["success", "success", "success", "reach_fail", "activation_fail", "miss", "aborted"]


@pytest.mark.parametrize("cap", [1.0, 0.6, 0.25, 0.0])
def test_random_play_never_leaves_the_spec_bounds_or_the_maximum(cap: float) -> None:
    rng = random.Random(12)
    engine = get_engine("L1")
    for game in load_specs():
        settings = {spec.name: spec.default for spec in game.params}
        context = EngineContext(game=game, settings=settings, max_difficulty=cap)
        state = engine.initial(context)
        history: list[TrialRecord] = []
        for n in range(1, 121):
            outcome = rng.choice(OUTCOMES)
            proposed, _ = engine.update(state, TrialResult(outcome), context)
            if outcome != "aborted":
                history.append(
                    TrialRecord(
                        n,
                        outcome,
                        compensated=rng.random() < 0.3,
                        time_ms=rng.uniform(400, 3000),
                        activation_peak=rng.uniform(0.2, 1.0),
                    )
                )
            state = apply_safety(
                SafetyInput(before=state, after=proposed, history=history, max_difficulty=cap)
            ).state
            assert all(0.0 <= d <= cap + 1e-9 for d in state.d.values()), (game.id, n, state)
            params, _ = engine.next_params(state, context)
            for spec in adaptable_params(game):
                assert spec.min <= params[spec.name] <= spec.max, (game.id, spec.name)


def test_the_compensation_rule_never_restores_above_a_lowered_maximum() -> None:
    history = [TrialRecord(n, "success", compensated=True) for n in range(1, 4)]
    result = apply_safety(
        SafetyInput(
            before=EngineData(d={"spatial": 0.7}),
            after=EngineData(d={"spatial": 0.76}),
            history=history,
            max_difficulty=0.5,
        )
    )
    assert result.state.d["spatial"] <= 0.5
    assert result.cue == "posture"


def count_logs(session: Session, run_id: int) -> int:
    statement = select(func.count()).where(AdaptationLog.game_run_id == run_id)
    return int(session.exec(statement).one())


def test_every_engine_call_writes_exactly_one_log_row(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    assert count_logs(session, run_id) == 1
    for n in range(1, 13):
        outcome = "success" if n % 3 else "reach_fail"
        step(client, patient_headers, run_id, trial(n, outcome, failure_type=None))
        assert count_logs(session, run_id) == n + 1
    # Asking again for a trial already answered writes nothing.
    step(client, patient_headers, run_id, trial(12, "reach_fail"))
    assert count_logs(session, run_id) == 13
    assert [log.trial_no for log in logs(session)] == list(range(13))


def test_the_warm_restart_happens_once_per_session_and_game(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    assert patient.id is not None
    session.add(
        EngineState(
            patient_id=patient.id,
            game_id="reach_activate",
            engine="L1",
            state={"d": {"spatial": 0.6, "activation": 0.6, "precision": 0.6}, "session_id": 999},
        )
    )
    session.commit()
    session_id = start_session(client, patient_headers)

    first = start_run(client, patient_headers, session_id)
    step(client, patient_headers, first)
    for n in range(1, 5):
        step(client, patient_headers, first, trial(n))
    assert end_run(client, patient_headers, first).status_code == 200
    second = start_run(client, patient_headers, session_id)
    step(client, patient_headers, second)

    session.expire_all()
    rows = list(
        session.exec(
            select(AdaptationLog).order_by(col(AdaptationLog.game_run_id), col(AdaptationLog.trial_no))
        ).all()
    )
    starts = [row for row in rows if row.trial_no == 0]
    assert starts[0].state_before["d"] == {
        component: round(0.6 - WARM_RESTART, 4) for component in ("spatial", "activation", "precision")
    }
    # The second run of the game in the same session carries on where the first ended.
    last_of_first = [row for row in rows if row.game_run_id == first][-1]
    assert starts[1].state_before["d"] == last_of_first.state_after["d"]


def test_l0_patients_get_exactly_the_admin_defaults_and_a_steady_level(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    set_programme(session, profile(session), engine_mode="L0")
    run_id = new_run(client, patient_headers)
    first = step(client, patient_headers, run_id)
    answers = [
        step(client, patient_headers, run_id, trial(n, "reach_fail", compensated=True))
        for n in range(1, 8)
    ]

    reach = get_spec("reach_activate")
    assert reach is not None
    defaults = effective_params_for(session, reach)
    for body in [first, *answers]:
        assert body["engine"] == "L0"
        assert body["params"] == params_for(reach, {}, defaults)
        assert body["level"] == first["level"]
        assert body["safety_override"] is None
    # The safety cues still reach the patient.
    assert {answer["cue"] for answer in answers} >= {"encourage"}
    rows = logs(session)
    assert all(row.state_after == rows[0].state_after for row in rows)
    assert rows[0].state_after["d"] == pytest.approx(initial_state(reach, defaults))


def test_l0_has_no_warm_restart(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    set_programme(session, patient, engine_mode="L0")
    assert patient.id is not None
    session.add(
        EngineState(
            patient_id=patient.id,
            game_id="reach_activate",
            engine="L0",
            state={"d": {"spatial": 0.6}, "session_id": 999},
        )
    )
    session.commit()
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    [row] = logs(session)
    assert row.state_before["d"] == {"spatial": 0.6}


def test_the_same_trial_reported_twice_at_once_gives_one_answer(
    client: TestClient, patient_headers: Headers, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_id = new_run(client, patient_headers)
    first = step(client, patient_headers, run_id)
    state_before = session.exec(select(EngineState)).one().model_dump()

    # The second request misses the first one's row, as if both arrived together.
    real = adaptation._existing
    calls = {"n": 0}

    def late(session: Session, run_id: int, trial_no: int) -> AdaptationLog | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else real(session, run_id, trial_no)

    monkeypatch.setattr(adaptation, "_existing", late)
    again = step(client, patient_headers, run_id)

    assert again == first
    assert count_logs(session, run_id) == 1
    session.expire_all()
    # The rejected duplicate changed nothing: state and log are saved together.
    assert session.exec(select(EngineState)).one().model_dump() == state_before


def test_engines_say_whether_they_adapt() -> None:
    assert get_engine("L0").adapts is False
    assert get_engine("L1").adapts is True
    assert get_engine("L2").adapts is True
