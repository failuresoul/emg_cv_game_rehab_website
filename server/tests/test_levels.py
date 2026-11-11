"""The difficulty level shown to admins and patients: per run, per session and per patient."""

from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session
from test_engine_api import new_run, step, trial
from test_games import end_run, start_run, start_session, trial_payload, upload

from app.engine.trial_summary import failure_type, last_trial
from app.schemas.game import TrialCreate
from app.services.levels import level_of_state


def play(client: TestClient, headers: Headers, run_id: int, successes: int) -> list[Any]:
    """The start and `successes` successful trials through the engine; the decisions."""
    answers = [step(client, headers, run_id)]
    for n in range(1, successes + 1):
        answers.append(step(client, headers, run_id, trial(n)))
    return answers


def test_level_of_state() -> None:
    assert level_of_state(None) == 1
    assert level_of_state({"d": {"spatial": 0.0}}) == 1
    assert level_of_state({"d": {"spatial": 1.0, "speed": 1.0}}) == 10
    assert level_of_state({"d": {"spatial": 0.5}}) == 6


def test_admin_session_detail_lists_each_runs_decisions(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    answers = play(client, patient_headers, run_id, 4)

    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()

    [run] = detail["games"]
    adaptation = run["adaptation"]
    assert [log["trial_no"] for log in adaptation] == [0, 1, 2, 3, 4]
    assert [log["level"] for log in adaptation] == [answer["level"] for answer in answers]
    assert adaptation[0]["decision"] == "Start of the game." and adaptation[0]["trial"] is None
    assert adaptation[2]["trial"]["outcome"] == "success"
    assert set(adaptation[0]["state_after"]["d"]) >= {"spatial"}
    assert adaptation[-1]["level"] >= adaptation[0]["level"]


def test_summary_and_facts_give_the_level_reached(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    answers = play(client, patient_headers, run_id, 16)
    assert upload(client, patient_headers, run_id, [trial_payload(1)]).status_code == 200
    assert end_run(client, patient_headers, run_id).status_code == 200

    summary = client.get(f"/api/sessions/{session_id}/summary", headers=patient_headers).json()
    [game] = summary["games"]
    assert (game["level_start"], game["level_end"]) == (answers[0]["level"], answers[-1]["level"])
    assert game["level_end"] > game["level_start"]

    facts = client.get(f"/api/sessions/{session_id}/facts", headers=admin_headers).json()
    reach = facts["games"]["reach_activate"]
    assert (reach["level_start"], reach["level_end"]) == (game["level_start"], game["level_end"])


def test_runs_without_decisions_have_no_level(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert upload(client, patient_headers, run_id, [trial_payload(1)]).status_code == 200
    assert end_run(client, patient_headers, run_id).status_code == 200

    summary = client.get(f"/api/sessions/{session_id}/summary", headers=patient_headers).json()
    assert summary["games"][0]["level_start"] is None
    assert summary["games"][0]["level_end"] is None
    facts = client.get(f"/api/sessions/{session_id}/facts", headers=admin_headers).json()
    assert facts["games"]["reach_activate"]["level_end"] is None
    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["games"][0]["adaptation"] == []


def test_admin_reads_the_patients_levels(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient(email="levels@example.com")
    headers = login("levels@example.com", PATIENT_PASSWORD)
    url = f"/api/admin/patients/{patient['id']}/levels"

    empty = client.get(url, headers=admin_headers).json()
    assert empty == {"engine_mode": "L1", "games": []}

    answers = play(client, headers, new_run(client, headers), 2)
    play(client, headers, new_run(client, headers, game_id="bloom"), 0)

    body = client.get(url, headers=admin_headers).json()
    assert body["engine_mode"] == "L1"
    games = {game["game_id"]: game for game in body["games"]}
    assert set(games) == {"bloom", "reach_activate"}
    reach = games["reach_activate"]
    assert reach["engine"] == "L1"
    assert reach["level"] == answers[-1]["level"]
    assert reach["trials_seen"] == 2
    assert all(0 <= d <= 1 for d in reach["d"].values())
    assert reach["updated_at"]


def test_levels_need_an_admin_and_an_existing_patient(
    client: TestClient, admin_headers: Headers, patient_headers: Headers
) -> None:
    assert client.get("/api/admin/patients/1/levels").status_code == 401
    assert client.get("/api/admin/patients/1/levels", headers=patient_headers).status_code == 403
    assert client.get("/api/admin/patients/999/levels", headers=admin_headers).status_code == 404


# The trial summary the server replays (mirrors web/src/ai/trialSummary.ts)


def make_trial(**changes: Any) -> TrialCreate:
    return TrialCreate.model_validate(trial_payload(**changes))


@pytest.mark.parametrize(
    ("game_id", "changes", "expected"),
    [
        ("reach_activate", {"outcome": "success"}, None),
        ("reach_activate", {"outcome": "aborted"}, None),
        ("reach_activate", {"outcome": "reach_fail"}, "reach_fail"),
        ("reach_activate", {"outcome": "activation_fail"}, "activation_fail"),
        ("reach_activate", {"outcome": "miss"}, "miss"),
        ("pick_place", {"outcome": "miss"}, "reach_fail"),
        ("bloom", {"outcome": "miss"}, "activation_fail"),
        ("grip_hold", {"outcome": "miss"}, "activation_fail"),
        ("path_trace", {"outcome": "miss"}, "reach_fail"),
        ("piano", {"outcome": "miss"}, "miss"),
    ],
)
def test_failure_types(game_id: str, changes: dict[str, Any], expected: str | None) -> None:
    assert failure_type(game_id, make_trial(**changes)) == expected


def test_balloon_failures_depend_on_reaching_the_balloon() -> None:
    reached = make_trial(outcome="miss")
    payload = trial_payload(outcome="miss")
    payload["timings"] = {**payload["timings"], "enter": None}
    missed = TrialCreate.model_validate(payload)
    assert failure_type("balloon_pop", reached) == "activation_fail"
    assert failure_type("balloon_pop", missed) == "miss"


def test_last_trial_carries_what_the_engine_needs() -> None:
    summary = last_trial("reach_activate", make_trial(trial_no=3, outcome="reach_fail"))
    assert summary.trial_no == 3
    assert summary.outcome == "reach_fail"
    assert summary.failure_type == "reach_fail"
    assert summary.compensated is True
    assert summary.movement_ms == 1050
    assert summary.completion_ms is None
    assert summary.activation_peak == 0.9


def test_last_trial_uses_the_completion_time_without_a_movement_time() -> None:
    payload = trial_payload()
    payload["metrics"] = {"activation_peak": None, "peak_grip": 0.7}
    summary = last_trial("grip_hold", TrialCreate.model_validate(payload))
    assert summary.movement_ms is None
    assert summary.completion_ms == 2650
    assert summary.activation_peak == 0.7
