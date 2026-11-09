from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from test_sessions import calibration_payload
from test_warmup import result_payload

from app.schemas.game import GAME_IDS

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]


def run_payload(**changes: Any) -> dict[str, Any]:
    payload = {
        "game_id": "reach_activate",
        "engine": "L0",
        "input_source": "cv_grip",
        "params_initial": {"target_radius_sw": 0.25, "dwell_ms": 500, "distance_frac": 0.7},
        "trials_planned": 12,
    }
    return {**payload, **changes}


def trial_payload(trial_no: int = 1, **changes: Any) -> dict[str, Any]:
    payload = {
        "trial_no": trial_no,
        "params": {"target_radius_sw": 0.25, "dwell_ms": 500},
        "target": {
            "x_sw": 0.6,
            "y_sw": 0.3,
            "radius_sw": 0.25,
            "direction_deg": 45,
            "distance_frac": 0.7,
            "sector": "D1R2",
        },
        "outcome": "success",
        "timings": {
            "spawn": 0,
            "move_onset": 350,
            "enter": 1400,
            "dwell_done": 1900,
            "activation_start": 2100,
            "activation_done": 2600,
            "end": 2650,
        },
        "metrics": {
            "reaction_ms": 350,
            "movement_ms": 1050,
            "path_length_sw": 0.82,
            "straight_dist_sw": 0.67,
            "path_efficiency": 0.82,
            "peak_speed_sw_s": 1.4,
            "activation_latency_ms": 200,
            "activation_peak": 0.9,
        },
        "compensation": {
            "flagged": True,
            "type": "trunk_lean",
            "max_values": {"trunk_lean_deg": 14.2},
        },
        "trajectory": [[0, 0.1, 0.0], [33.3, 0.12, 0.02], [66.7, 0.15, 0.05]],
    }
    return {**payload, **changes}


def summary_payload(**changes: Any) -> dict[str, Any]:
    payload = {
        "successes": 9,
        "success_rate": 0.75,
        "mean_movement_ms": 1200.0,
        "mean_path_efficiency": 0.8,
        "compensated_trials": 2,
    }
    return {**payload, **changes}


def start_session(client: TestClient, headers: Headers) -> int:
    response = client.post("/api/sessions", headers=headers)
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def start_run(client: TestClient, headers: Headers, session_id: int, **changes: Any) -> int:
    response = client.post(
        f"/api/sessions/{session_id}/games", json=run_payload(**changes), headers=headers
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def upload(client: TestClient, headers: Headers, run_id: int, trials: list[dict[str, Any]]) -> Any:
    return client.post(f"/api/games/{run_id}/trials", json=trials, headers=headers)


def end_run(client: TestClient, headers: Headers, run_id: int, **changes: Any) -> Any:
    payload = {"status": "completed", "score": 840, "summary": summary_payload(), **changes}
    return client.post(f"/api/games/{run_id}/end", json=payload, headers=headers)


def list_runs(client: TestClient, headers: Headers, session_id: int) -> list[dict[str, Any]]:
    response = client.get(f"/api/sessions/{session_id}/games", headers=headers)
    assert response.status_code == 200, response.text
    result: list[dict[str, Any]] = response.json()
    return result


@pytest.fixture
def other_headers(create_patient: CreatePatient, login: Login) -> Headers:
    create_patient(email="bob@example.com")
    return login("bob@example.com", PATIENT_PASSWORD)


# Starting a run


def test_start_run(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    response = client.post(
        f"/api/sessions/{session_id}/games", json=run_payload(), headers=patient_headers
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["session_id"] == session_id
    assert body["game_id"] == "reach_activate"
    assert body["engine"] == "L0"
    assert body["input_source"] == "cv_grip"
    assert body["params_initial"]["dwell_ms"] == 500
    assert body["status"] == "active"
    assert body["trials_planned"] == 12
    assert body["trials_done"] == 0
    assert body["score"] is None
    assert body["summary"] is None
    assert body["ended_at"] is None
    assert body["started_at"].endswith("Z") or body["started_at"].endswith("+00:00")


def test_start_run_defaults_engine_to_l0(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    payload = run_payload()
    del payload["engine"]
    response = client.post(
        f"/api/sessions/{session_id}/games", json=payload, headers=patient_headers
    )
    assert response.status_code == 201, response.text
    assert response.json()["engine"] == "L0"


@pytest.mark.parametrize("game_id", GAME_IDS)
def test_start_run_accepts_every_planned_game(
    client: TestClient, patient_headers: Headers, game_id: str
) -> None:
    session_id = start_session(client, patient_headers)
    start_run(client, patient_headers, session_id, game_id=game_id)


@pytest.mark.parametrize(
    "changes",
    [
        {"game_id": "space_invaders"},
        {"engine": "L3"},
        {"input_source": "mouse"},
        {"trials_planned": 0},
        {"unexpected": True},
    ],
)
def test_start_run_invalid_input_is_422(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start_session(client, patient_headers)
    response = client.post(
        f"/api/sessions/{session_id}/games", json=run_payload(**changes), headers=patient_headers
    )
    assert response.status_code == 422, response.text


def test_start_run_on_ended_session_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
    )
    response = client.post(
        f"/api/sessions/{session_id}/games", json=run_payload(), headers=patient_headers
    )
    assert response.status_code == 409


def test_start_run_unknown_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    response = client.post("/api/sessions/9999/games", json=run_payload(), headers=patient_headers)
    assert response.status_code == 404


def test_starting_a_run_aborts_the_open_one(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    first = start_run(client, patient_headers, session_id)
    second = start_run(client, patient_headers, session_id, game_id="balloon_pop")
    statuses = {run["id"]: run["status"] for run in list_runs(client, patient_headers, session_id)}
    assert statuses == {first: "aborted", second: "active"}


def test_ending_the_session_aborts_open_runs(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
    )
    [run] = list_runs(client, patient_headers, session_id)
    assert run["id"] == run_id
    assert run["status"] == "aborted"
    assert run["ended_at"] is None


def test_games_require_patient_role(client: TestClient, admin_headers: Headers) -> None:
    response = client.post("/api/sessions/1/games", json=run_payload(), headers=admin_headers)
    assert response.status_code == 403


def test_games_require_login(client: TestClient) -> None:
    assert client.get("/api/sessions/1/games").status_code == 401
    assert client.post("/api/games/1/trials", json=[trial_payload()]).status_code == 401


# Uploading trials


def test_upload_batch(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = upload(client, patient_headers, run_id, [trial_payload(n) for n in (1, 2, 3)])
    assert response.status_code == 200, response.text
    assert response.json()["trials_done"] == 3


def test_upload_minimal_trial(client: TestClient, patient_headers: Headers) -> None:
    """Only trial_no and outcome are required, for example a trial aborted at spawn."""
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = upload(client, patient_headers, run_id, [{"trial_no": 1, "outcome": "aborted"}])
    assert response.status_code == 200, response.text


def test_upload_accepts_fifty_trials(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id, trials_planned=50)
    trials = [trial_payload(n) for n in range(1, 51)]
    response = upload(client, patient_headers, run_id, trials)
    assert response.status_code == 200, response.text
    assert response.json()["trials_done"] == 50


def test_upload_over_fifty_is_422(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = upload(client, patient_headers, run_id, [trial_payload(n) for n in range(1, 52)])
    assert response.status_code == 422


def test_upload_empty_batch_is_422(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert upload(client, patient_headers, run_id, []).status_code == 422


def test_upload_upserts_by_trial_no(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    upload(client, patient_headers, run_id, [trial_payload(1), trial_payload(2)])
    response = upload(
        client, patient_headers, run_id, [trial_payload(2, outcome="reach_fail"), trial_payload(3)]
    )
    assert response.status_code == 200, response.text
    assert response.json()["trials_done"] == 3


def test_upload_upsert_replaces_the_stored_trial(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    upload(client, patient_headers, run_id, [trial_payload(1)])
    replacement = trial_payload(1, outcome="activation_fail", trajectory=[[0, 0.2, 0.1]])
    upload(client, patient_headers, run_id, [replacement])

    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    [trial] = detail["games"][0]["trials"]
    assert trial["outcome"] == "activation_fail"
    assert trial["trajectory"] == [[0, 0.2, 0.1]]


def test_upload_duplicate_trial_no_in_batch_is_422(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = upload(client, patient_headers, run_id, [trial_payload(1), trial_payload(1)])
    assert response.status_code == 422


def test_upload_accepts_2000_trajectory_points(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    trajectory = [[i * 33.3, 0.5, 0.5] for i in range(2000)]
    response = upload(client, patient_headers, run_id, [trial_payload(trajectory=trajectory)])
    assert response.status_code == 200, response.text


def test_upload_trajectory_over_2000_points_is_422(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    trajectory = [[i * 33.3, 0.5, 0.5] for i in range(2001)]
    response = upload(client, patient_headers, run_id, [trial_payload(trajectory=trajectory)])
    assert response.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"trial_no": 0},
        {"outcome": "timeout"},
        {"trajectory": [[0, 0.1]]},
        {"target": {**trial_payload()["target"], "sector": "north"}},
        {"target": {**trial_payload()["target"], "radius_sw": 0}},
        {"metrics": {"path_efficiency": 1.5}},
        {"metrics": {"activation_peak": -0.1}},
        {"timings": {"enter": -5}},
        {"compensation": {"flagged": True, "unknown": 1}},
    ],
)
def test_upload_invalid_trial_is_422(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = upload(client, patient_headers, run_id, [trial_payload(**changes)])
    assert response.status_code == 422, response.text


def test_upload_rejects_not_a_number(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    body = '[{"trial_no": 1, "outcome": "success", "trajectory": [[0, NaN, 0.1]]}]'
    response = client.post(
        f"/api/games/{run_id}/trials",
        content=body,
        headers={**patient_headers, "Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_upload_to_ended_run_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert end_run(client, patient_headers, run_id).status_code == 200
    response = upload(client, patient_headers, run_id, [trial_payload(1)])
    assert response.status_code == 409


def test_upload_to_aborted_run_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    start_run(client, patient_headers, session_id)  # Aborts the first run.
    assert upload(client, patient_headers, run_id, [trial_payload(1)]).status_code == 409


def test_upload_unknown_run_is_404(client: TestClient, patient_headers: Headers) -> None:
    assert upload(client, patient_headers, 9999, [trial_payload(1)]).status_code == 404


# Ending a run


def test_end_run_with_summary(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    upload(client, patient_headers, run_id, [trial_payload(n) for n in (1, 2)])
    response = end_run(client, patient_headers, run_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["score"] == 840
    assert body["summary"] == summary_payload()
    assert body["ended_at"] is not None
    assert body["trials_done"] == 2


def test_end_run_aborted_without_summary(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    response = end_run(client, patient_headers, run_id, status="aborted", score=0, summary=None)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "aborted"
    assert response.json()["summary"] is None


@pytest.mark.parametrize(
    "changes",
    [
        {"status": "active"},
        {"score": -1},
        {"summary": summary_payload(success_rate=1.2)},
        {"summary": summary_payload(successes=-1)},
        {"summary": {**summary_payload(), "extra": 1}},
    ],
)
def test_end_run_invalid_input_is_422(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert end_run(client, patient_headers, run_id, **changes).status_code == 422


def test_end_run_twice_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert end_run(client, patient_headers, run_id).status_code == 200
    assert end_run(client, patient_headers, run_id).status_code == 409


def test_list_runs_with_summaries(client: TestClient, patient_headers: Headers) -> None:
    session_id = start_session(client, patient_headers)
    first = start_run(client, patient_headers, session_id)
    end_run(client, patient_headers, first)
    second = start_run(client, patient_headers, session_id, game_id="balloon_pop")
    runs = list_runs(client, patient_headers, session_id)
    assert [run["id"] for run in runs] == [first, second]
    assert runs[0]["summary"]["success_rate"] == 0.75
    assert runs[1]["summary"] is None
    assert "trials" not in runs[0]


def test_list_runs_unknown_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    response = client.get("/api/sessions/9999/games", headers=patient_headers)
    assert response.status_code == 404


# Ownership


def test_patient_cannot_use_another_patients_session_or_run(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)

    start = client.post(
        f"/api/sessions/{session_id}/games", json=run_payload(), headers=other_headers
    )
    assert start.status_code == 404
    listing = client.get(f"/api/sessions/{session_id}/games", headers=other_headers)
    assert listing.status_code == 404
    assert upload(client, other_headers, run_id, [trial_payload(1)]).status_code == 404
    assert end_run(client, other_headers, run_id).status_code == 404

    # The owner's run is untouched.
    [run] = list_runs(client, patient_headers, session_id)
    assert run["status"] == "active"
    assert run["trials_done"] == 0


# Admin session detail


def test_admin_session_detail(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    client.patch(
        f"/api/sessions/{session_id}/device-info",
        json={"browser": "Chrome", "fps": 30, "delegate": "GPU"},
        headers=patient_headers,
    )
    client.post(
        f"/api/sessions/{session_id}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )
    client.post(
        f"/api/sessions/{session_id}/warmup", json=[result_payload()], headers=patient_headers
    )
    run_id = start_run(client, patient_headers, session_id)
    upload(client, patient_headers, run_id, [trial_payload(2), trial_payload(1)])
    end_run(client, patient_headers, run_id)
    client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
    )

    response = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == session_id
    assert body["patient_code"] == "P001"
    assert body["patient_name"] == "Alice Rahman"
    assert body["status"] == "completed"
    assert body["ended_at"] is not None
    assert body["duration_seconds"] is not None
    assert body["device_info"] == {"browser": "Chrome", "fps": 30, "delegate": "GPU"}
    assert body["calibration"]["reach_radii_sw"] == calibration_payload()["reach_radii_sw"]
    assert [result["exercise_id"] for result in body["warmup_results"]] == ["shoulder_flexion"]

    [game] = body["games"]
    assert game["id"] == run_id
    assert game["summary"] == summary_payload()
    assert [trial["trial_no"] for trial in game["trials"]] == [1, 2]
    trial = game["trials"][0]
    assert trial["target"]["sector"] == "D1R2"
    assert trial["timings"]["activation_done"] == 2600
    assert trial["metrics"]["path_efficiency"] == 0.82
    assert trial["compensation"]["max_values"] == {"trunk_lean_deg": 14.2}
    assert trial["trajectory"] == trial_payload()["trajectory"]


def test_admin_session_detail_of_empty_session(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    body = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert body["calibration"] is None
    assert body["warmup_results"] == []
    assert body["games"] == []
    assert body["duration_seconds"] is None


def test_admin_session_detail_unknown_is_404(client: TestClient, admin_headers: Headers) -> None:
    assert client.get("/api/admin/sessions/9999", headers=admin_headers).status_code == 404


def test_admin_session_detail_requires_admin(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    response = client.get(f"/api/admin/sessions/{session_id}", headers=patient_headers)
    assert response.status_code == 403


# Dashboard


def test_dashboard_last_session_lists_finished_games(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    first = start_run(client, patient_headers, session_id)
    end_run(client, patient_headers, first)
    second = start_run(client, patient_headers, session_id, game_id="balloon_pop")
    end_run(client, patient_headers, second, status="aborted", score=120, summary=None)
    start_run(client, patient_headers, session_id, game_id="bloom")  # Still active: left out.

    response = client.get("/api/patient/dashboard", headers=patient_headers)
    assert response.status_code == 200, response.text
    assert response.json()["last_session"]["games"] == [
        {"game_id": "reach_activate", "score": 840, "success_rate": 0.75},
        {"game_id": "balloon_pop", "score": 120, "success_rate": None},
    ]


def test_dashboard_last_session_without_games(
    client: TestClient, patient_headers: Headers
) -> None:
    start_session(client, patient_headers)
    body = client.get("/api/patient/dashboard", headers=patient_headers).json()
    assert body["last_session"]["games"] == []


# Admin recent sessions


def test_admin_recent_sessions_newest_first_with_games(
    client: TestClient,
    patient_headers: Headers,
    other_headers: Headers,
    admin_headers: Headers,
) -> None:
    first = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, first)
    end_run(client, patient_headers, run_id)
    start_run(client, patient_headers, first, game_id="bloom")  # Still active: left out.
    second = start_session(client, other_headers)

    response = client.get("/api/admin/sessions", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["id"] for row in body] == [second, first]
    assert body[1]["patient_code"] == "P001"
    assert body[1]["patient_name"] == "Alice Rahman"
    assert body[1]["status"] == "active"
    assert body[1]["duration_seconds"] is None
    assert body[1]["games"] == [{"game_id": "reach_activate", "score": 840, "success_rate": 0.75}]
    assert body[0]["games"] == []


def test_admin_recent_sessions_limit(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    for _ in range(3):
        session_id = start_session(client, patient_headers)
        client.post(
            f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
        )
    response = client.get("/api/admin/sessions", params={"limit": 2}, headers=admin_headers)
    assert response.status_code == 200
    assert len(response.json()) == 2
    for bad in (0, 51):
        response = client.get("/api/admin/sessions", params={"limit": bad}, headers=admin_headers)
        assert response.status_code == 422


def test_admin_recent_sessions_empty(client: TestClient, admin_headers: Headers) -> None:
    response = client.get("/api/admin/sessions", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_admin_recent_sessions_requires_admin(client: TestClient, patient_headers: Headers) -> None:
    assert client.get("/api/admin/sessions", headers=patient_headers).status_code == 403


def test_session_lists_include_finished_games(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    end_run(client, patient_headers, run_id)
    expected = [{"game_id": "reach_activate", "score": 840, "success_rate": 0.75}]

    own = client.get("/api/patient/sessions", headers=patient_headers).json()
    assert own[0]["games"] == expected
    detail = client.get(f"/api/patient/sessions/{session_id}", headers=patient_headers).json()
    assert detail["games"] == expected
    patient_id = own[0]["patient_id"]
    admin = client.get(f"/api/admin/patients/{patient_id}/sessions", headers=admin_headers).json()
    assert admin[0]["games"] == expected
