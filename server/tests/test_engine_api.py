import time
from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select
from test_games import end_run, run_payload, start_run, start_session

from app.core.config import settings
from app.engine.difficulty import value_at
from app.models import AdaptationLog, EngineState, PatientProfile
from app.services.game_specs import get_spec


def step(
    client: TestClient, headers: Headers, run_id: int, last: dict[str, Any] | None = None
) -> Any:
    response = client.post(
        "/api/engine/next", json={"run_id": run_id, "last_trial": last}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def trial(n: int, outcome: str = "success", **changes: Any) -> dict[str, Any]:
    return {"trial_no": n, "outcome": outcome, **changes}


def new_run(client: TestClient, headers: Headers, game_id: str = "reach_activate") -> int:
    session_id = start_session(client, headers)
    return start_run(client, headers, session_id, game_id=game_id)


def profile(session: Session) -> PatientProfile:
    return session.exec(select(PatientProfile)).one()


def logs(session: Session) -> list[AdaptationLog]:
    session.expire_all()
    statement = select(AdaptationLog).order_by(col(AdaptationLog.trial_no))
    return list(session.exec(statement).all())


def test_first_call_starts_from_the_admin_defaults(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    run_id = new_run(client, patient_headers)
    body = step(client, patient_headers, run_id)
    reach = get_spec("reach_activate")
    assert reach is not None
    assert body["engine"] == "L1"
    assert body["params"]["distance_frac"] == reach.defaults["distance_frac"]
    assert body["params"]["rest_ms"] == reach.defaults["rest_ms"]
    assert 1 <= body["level"] <= 10
    assert body["cue"] is None and body["safety_override"] is None
    assert body["decision"] == "Start of the game."
    [log] = logs(session)
    assert (log.trial_no, log.engine, log.trial) == (0, "L1", None)
    [state] = session.exec(select(EngineState)).all()
    assert state.state["session_id"] is not None and state.trials_seen == 0


def test_first_call_in_a_new_session_eases_the_last_difficulty(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    assert patient.id is not None
    session.add(
        EngineState(
            patient_id=patient.id,
            game_id="reach_activate",
            engine="L1",
            state={
                "d": {"spatial": 0.6, "activation": 0.6, "precision": 0.6},
                "session_id": 999,
            },
            trials_seen=40,
        )
    )
    session.commit()
    run_id = new_run(client, patient_headers)
    body = step(client, patient_headers, run_id)
    reach = get_spec("reach_activate")
    assert reach is not None
    distance = next(p for p in reach.params if p.name == "distance_frac")
    assert body["params"]["distance_frac"] == value_at(distance, 0.55)
    [log] = logs(session)
    assert log.state_after["d"] == {"spatial": 0.55, "activation": 0.55, "precision": 0.55}


def test_successes_raise_the_difficulty_with_a_readable_reason(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    run_id = new_run(client, patient_headers)
    first = step(client, patient_headers, run_id)
    step(client, patient_headers, run_id, trial(1))
    second = step(client, patient_headers, run_id, trial(2))
    # The component with the most room left takes the step: at the defaults, precision.
    assert second["decision"].startswith("Two successes in a row: precision a little harder (")
    assert "precision 0.36 -> 0.42" in second["decision"]
    assert second["params"]["target_radius_sw"] < first["params"]["target_radius_sw"]
    rows = logs(session)
    assert [row.trial_no for row in rows] == [0, 1, 2]
    assert rows[2].state_before["d"]["precision"] < rows[2].state_after["d"]["precision"]
    assert rows[2].trial == {
        "trial_no": 2,
        "outcome": "success",
        "failure_type": None,
        "compensated": False,
        "movement_ms": None,
        "completion_ms": None,
        "activation_peak": None,
    }
    assert rows[2].params == second["params"]
    state = session.exec(select(EngineState)).one()
    assert state.trials_seen == 2


def test_failure_types_route_to_their_component(
    client: TestClient, patient_headers: Headers
) -> None:
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    body = step(client, patient_headers, run_id, trial(1, "activation_fail"))
    assert "activation a little easier" in body["decision"]
    # A miss that the game says was a reach failure eases the spatial component.
    body = step(client, patient_headers, run_id, trial(2, "miss", failure_type="reach_fail"))
    assert "spatial a little easier" in body["decision"]


def test_reporting_a_trial_again_gives_the_same_answer(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    first = step(client, patient_headers, run_id, trial(1, "reach_fail"))
    again = step(client, patient_headers, run_id, trial(1, "reach_fail"))
    assert again == first
    assert len(logs(session)) == 2
    assert session.exec(select(EngineState)).one().trials_seen == 1


def test_safety_cues_through_the_api(
    client: TestClient,
    patient_headers: Headers,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Spatial has the most room left, so two successes would make it harder.
    patient = profile(session)
    assert patient.id is not None
    session.add(
        EngineState(
            patient_id=patient.id,
            game_id="reach_activate",
            engine="L1",
            state={"d": {"spatial": 0.2, "activation": 0.8, "precision": 0.8}},
        )
    )
    session.commit()
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    step(client, patient_headers, run_id, trial(1, compensated=True))
    body = step(client, patient_headers, run_id, trial(2, compensated=True))
    assert body["cue"] == "posture"
    assert body["safety_override"] is not None and "spatial kept" in body["safety_override"]
    for n in (3, 4):
        step(client, patient_headers, run_id, trial(n, "reach_fail"))
    body = step(client, patient_headers, run_id, trial(5, "reach_fail"))
    assert body["cue"] == "encourage"
    assert "3 failures in a row" in body["safety_override"]

    monkeypatch.setattr(settings, "SESSION_FINISH_SOON_MIN", 0.0)
    body = step(client, patient_headers, run_id, trial(6))
    assert body["cue"] == "finish_soon"
    monkeypatch.setattr(settings, "SESSION_FINISH_MIN", 0.0)
    body = step(client, patient_headers, run_id, trial(7))
    assert body["cue"] == "finish"


def test_never_above_the_patients_maximum(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    patient.max_difficulty = {"reach_activate": 0.3}
    session.add(patient)
    session.commit()
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    reach = get_spec("reach_activate")
    assert reach is not None
    distance = next(p for p in reach.params if p.name == "distance_frac")
    for n in range(1, 21):
        body = step(client, patient_headers, run_id, trial(n))
        assert body["params"]["distance_frac"] <= value_at(distance, 0.3)
    assert all(d <= 0.3 for d in logs(session)[-1].state_after["d"].values())
    assert body["level"] <= 4


def test_l0_patients_keep_the_admin_defaults(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    patient.engine_mode = "L0"
    session.add(patient)
    session.commit()
    run_id = new_run(client, patient_headers)
    first = step(client, patient_headers, run_id)
    for n in range(1, 5):
        body = step(client, patient_headers, run_id, trial(n))
    assert body["engine"] == "L0"
    assert body["params"] == first["params"]
    assert body["decision"].startswith("Fixed settings")


def test_only_the_runs_owner_may_ask(
    client: TestClient,
    patient_headers: Headers,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    run_id = new_run(client, patient_headers)
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    body = {"run_id": run_id, "last_trial": None}
    assert client.post("/api/engine/next", json=body, headers=other).status_code == 404
    assert client.post("/api/engine/next", json=body, headers=admin_headers).status_code == 403
    assert client.post("/api/engine/next", json=body).status_code == 401
    missing = {"run_id": 999, "last_trial": None}
    assert client.post("/api/engine/next", json=missing, headers=patient_headers).status_code == 404


def test_an_ended_run_and_invalid_trials_are_refused(
    client: TestClient, patient_headers: Headers
) -> None:
    run_id = new_run(client, patient_headers)
    bad = {"run_id": run_id, "last_trial": {"trial_no": 0, "outcome": "success"}}
    assert client.post("/api/engine/next", json=bad, headers=patient_headers).status_code == 422
    bad["last_trial"] = {"trial_no": 1, "outcome": "lucky"}
    assert client.post("/api/engine/next", json=bad, headers=patient_headers).status_code == 422
    assert end_run(client, patient_headers, run_id).status_code == 200
    body = {"run_id": run_id, "last_trial": None}
    assert client.post("/api/engine/next", json=body, headers=patient_headers).status_code == 409


def test_fast_enough_for_every_trial(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id, **run_payload(game_id="fruit_catch"))
    step(client, patient_headers, run_id)
    timings = []
    for n in range(1, 41):
        outcome = "success" if n % 4 else "miss"
        last = trial(n, outcome, movement_ms=900 + 10 * n, compensated=n % 7 == 0)
        started = time.perf_counter()
        step(client, patient_headers, run_id, last)
        timings.append(time.perf_counter() - started)
    # Whole HTTP calls with the database: one call may be slowed by the machine, so the 95th
    # percentile is checked (the engine's own step takes a few ms: test_l2.py).
    p95 = sorted(timings)[int(0.95 * len(timings)) - 1]
    assert p95 < 0.1, f"95th percentile {p95 * 1000:.0f} ms"
