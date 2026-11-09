from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.core.db import create_db_and_tables

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]

QUEUE = {"games": ["reach_activate", "balloon_pop", "fruit_catch"], "index": 0}


def start(client: TestClient, headers: Headers) -> dict[str, Any]:
    response = client.post("/api/sessions", headers=headers)
    assert response.status_code in (200, 201), response.text
    return response.json()


def patch(client: TestClient, headers: Headers, session_id: int, body: Any) -> Any:
    return client.patch(f"/api/sessions/{session_id}/progress", json=body, headers=headers)


def test_new_session_starts_at_setup(client: TestClient, patient_headers: Headers) -> None:
    body = start(client, patient_headers)

    assert body["current_step"] == "setup"
    assert body["game_queue"] is None


@pytest.mark.parametrize(
    "step", ["setup", "calibrate", "warmup", "plan", "game", "cooldown", "summary"]
)
def test_every_step_can_be_saved(client: TestClient, patient_headers: Headers, step: str) -> None:
    session_id = start(client, patient_headers)["id"]

    response = patch(client, patient_headers, session_id, {"current_step": step})

    assert response.status_code == 200
    assert response.json()["current_step"] == step


def test_queue_and_step_are_saved_and_resumed(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)["id"]

    response = patch(
        client, patient_headers, session_id, {"current_step": "game", "game_queue": QUEUE}
    )
    assert response.status_code == 200
    assert response.json()["game_queue"] == QUEUE

    # The next game: only the queue changes, the step stays.
    patch(client, patient_headers, session_id, {"game_queue": {**QUEUE, "index": 1}})

    current = client.get("/api/sessions/current", headers=patient_headers).json()
    assert current["current_step"] == "game"
    assert current["game_queue"] == {**QUEUE, "index": 1}
    # Starting again resumes the same session with its step.
    resumed = start(client, patient_headers)
    assert resumed["id"] == session_id
    assert resumed["current_step"] == "game"


def test_queue_index_may_point_past_the_last_game(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)["id"]

    response = patch(client, patient_headers, session_id, {"game_queue": {**QUEUE, "index": 3}})

    assert response.status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"current_step": None},
        {"current_step": "games"},
        {"current_step": "setup", "extra": 1},
        {"game_queue": {"games": [], "index": 0}},
        {"game_queue": {"games": ["reach_activate"], "index": 2}},
        {"game_queue": {"games": ["reach_activate"], "index": -1}},
        {"game_queue": {"games": ["reach_activate"], "index": "0"}},
        {"game_queue": {"games": ["not_a_game"], "index": 0}},
        {"game_queue": {"games": ["reach_activate"] * 21, "index": 0}},
        {"game_queue": {"games": ["reach_activate"], "index": 0, "extra": True}},
    ],
)
def test_invalid_progress_is_422(
    client: TestClient, patient_headers: Headers, body: dict[str, Any]
) -> None:
    session_id = start(client, patient_headers)["id"]

    assert patch(client, patient_headers, session_id, body).status_code == 422


def test_ended_session_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)["id"]
    client.post(
        f"/api/sessions/{session_id}/end", json={"status": "aborted"}, headers=patient_headers
    )

    response = patch(client, patient_headers, session_id, {"current_step": "warmup"})

    assert response.status_code == 409


def test_other_patients_session_is_404(
    client: TestClient,
    patient_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    session_id = start(client, patient_headers)["id"]
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)

    assert patch(client, other, session_id, {"current_step": "warmup"}).status_code == 404
    assert patch(client, patient_headers, 9999, {"current_step": "warmup"}).status_code == 404
    current = client.get("/api/sessions/current", headers=patient_headers).json()
    assert current["current_step"] == "setup"


def test_progress_needs_patient(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start(client, patient_headers)["id"]

    assert client.patch(f"/api/sessions/{session_id}/progress", json={}).status_code == 401
    assert patch(client, admin_headers, session_id, {"current_step": "plan"}).status_code == 403


def test_admin_session_detail_shows_step(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start(client, patient_headers)["id"]
    patch(client, patient_headers, session_id, {"current_step": "warmup"})

    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()

    assert detail["current_step"] == "warmup"


def test_existing_session_table_gets_step_columns() -> None:
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as connection:
        connection.execute(
            text(
                'CREATE TABLE "session" (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, '
                "started_at DATETIME NOT NULL, ended_at DATETIME, status VARCHAR NOT NULL, "
                "device_info JSON, notes VARCHAR)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO session (patient_id, started_at, status) "
                "VALUES (1, '2026-01-01', 'completed')"
            )
        )

    create_db_and_tables(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("session")}
    assert {"current_step", "game_queue"} <= columns
    with engine.connect() as connection:
        row = connection.execute(text("SELECT current_step, game_queue FROM session")).one()
    assert row == ("setup", None)
    engine.dispose()
