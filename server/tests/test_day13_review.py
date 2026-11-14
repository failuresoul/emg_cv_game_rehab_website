"""Day 13 review: the guarantees of L2 and the planner, each checked on its own.

- L2 always passes through the safety layer in the app (only the simulator may switch it off).
- The simulator runs the real engine code.
- Plans only include enabled games and always satisfy the rules (tests/test_planner.py, 40 random
  histories); a plan is never made after the session ended.
- The patient can always change the plan, and every change is kept.
- Every engine decision is logged, with L2's samples and target.
"""

from collections.abc import Callable
from typing import Any

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session
from test_engine_api import logs, new_run, profile, step, trial
from test_progress import add_session, noon

from app.engine.difficulty import value_at
from app.engine.sim import runner
from app.models import GameRun
from app.models import Session as SessionRecord
from app.services import adaptation
from app.services.game_specs import get_spec
from tests.programme_helpers import set_programme


def l2_patient(session: Session, **changes: Any) -> None:
    set_programme(session, profile(session), engine_mode="L2", **changes)


def test_every_l2_decision_in_the_app_goes_through_the_safety_layer(
    client: TestClient,
    patient_headers: Headers,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    l2_patient(session)
    calls: list[int] = []
    real = adaptation.apply_safety

    def counted(data: Any) -> Any:
        calls.append(1)
        return real(data)

    monkeypatch.setattr(adaptation, "apply_safety", counted)
    run_id = new_run(client, patient_headers)
    answers = [step(client, patient_headers, run_id)]
    for n in range(1, 13):
        answers.append(step(client, patient_headers, run_id, trial(n, "reach_fail" if n % 2 else "success")))
    assert len(calls) == len(answers) == 13
    assert all(answer["engine"] == "L2" for answer in answers)


def test_three_failures_ease_an_l2_target(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    run_id = new_run(client, patient_headers)
    answer = step(client, patient_headers, run_id)
    for n in range(1, 4):
        answer = step(
            client,
            patient_headers,
            run_id,
            trial(n, "activation_fail", direction_deg=answer["direction_deg"], distance_frac=answer["distance_frac"]),
        )
    assert answer["safety_override"] and "3 failures in a row" in answer["safety_override"]
    assert answer["cue"] == "encourage"
    [last] = logs(session)[-1:]
    proposed = last.details["distance_frac"] if last.details else None
    assert proposed is not None and answer["distance_frac"] <= proposed


def test_l2_targets_never_pass_the_patients_maximum(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session, max_difficulty={"reach_activate": 0.3})
    reach = get_spec("reach_activate")
    assert reach is not None
    distance = next(p for p in reach.params if p.name == "distance_frac")
    limit = value_at(distance, 0.3)
    run_id = new_run(client, patient_headers)
    answer = step(client, patient_headers, run_id)
    for n in range(1, 31):
        assert answer["distance_frac"] <= limit + 1e-9
        assert answer["params"]["distance_frac"] <= limit + 1e-9
        answer = step(
            client,
            patient_headers,
            run_id,
            trial(n, "success", direction_deg=answer["direction_deg"], distance_frac=answer["distance_frac"]),
        )


def test_every_engine_decision_is_logged_with_its_samples(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    run_id = new_run(client, patient_headers)
    answer = step(client, patient_headers, run_id)
    for n in range(1, 9):
        answer = step(
            client,
            patient_headers,
            run_id,
            trial(n, "success", direction_deg=answer["direction_deg"], distance_frac=answer["distance_frac"]),
        )
    rows = logs(session)
    assert [row.trial_no for row in rows] == list(range(9))
    for row in rows:
        assert row.engine == "L2" and row.decision
        assert row.details and row.details["target"]["sector"]
    assert all("sector_samples" in (row.details or {}) for row in rows[1:])
    assert rows[-1].details["target"]["sector"] == answer["sector"]  # type: ignore[index]


def test_the_simulator_runs_the_apps_own_decision_function() -> None:
    assert runner.decide is adaptation.decide


def test_no_plan_is_made_after_the_session_ended(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    old = add_session(session, profile(session), noon(3))
    assert old.id is not None
    for headers in (patient_headers, admin_headers):
        response = client.get(f"/api/sessions/{old.id}/plan", headers=headers)
        assert response.status_code == 404
    session.expire_all()
    stored = session.get(SessionRecord, old.id)
    assert stored is not None and stored.plan is None
    # A plan made while the session was active is still there after it ends.
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    plan = client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json()
    client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers)
    assert client.get(f"/api/sessions/{session_id}/plan", headers=admin_headers).json() == plan


@pytest.mark.parametrize(
    "change",
    [
        lambda planned: planned[:1],  # just one game
        lambda planned: list(reversed(planned)),  # every game, reordered
        lambda planned: [game for game in ("bloom", "finger_piano", "grip_hold", "paint_wall", "path_trace") if game not in planned][:2]
        + planned,  # games added before the plan
    ],
)
def test_the_patient_can_always_change_the_plan(
    client: TestClient,
    patient_headers: Headers,
    session: Session,
    change: Callable[[list[str]], list[str]],
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    plan = client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json()
    planned = [game["game_id"] for game in plan["games"]]
    chosen = change(planned)
    response = client.post(
        f"/api/sessions/{session_id}/plan/override", json={"games": chosen}, headers=patient_headers
    )
    assert response.status_code == 201, response.text
    [entry] = response.json()["overrides"]
    assert entry["games"] == chosen
    assert set(entry["removed"]) == set(planned) - set(chosen)
    assert set(entry["added"]) == set(chosen) - set(planned)
    # The recommendation itself is kept as it was.
    assert client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json() == plan


def test_l2_decisions_are_visible_to_the_admin(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    l2_patient(session)
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    step(client, patient_headers, run_id, trial(1))
    run = session.get(GameRun, run_id)
    assert run is not None
    detail = client.get(f"/api/admin/sessions/{run.session_id}", headers=admin_headers).json()
    adaptation_rows = detail["games"][0]["adaptation"]
    assert adaptation_rows[-1]["details"]["target"]["sector"]
    assert adaptation_rows[-1]["state_after"]["extra"]["sectors"]
