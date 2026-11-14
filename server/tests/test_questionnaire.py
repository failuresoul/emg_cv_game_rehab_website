from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.core.db import create_db_and_tables
from app.services import safety

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]


def answers(**changes: Any) -> dict[str, Any]:
    """Answers that raise no flag."""
    payload = {
        "pain_0_10": 1,
        "fatigue_0_10": 3,
        "enjoyment_1_5": 4,
        "difficulty": "just_right",
        "new_symptoms": False,
        "comment": "Felt good",
    }
    return {**payload, **changes}


def start(client: TestClient, headers: Headers) -> int:
    response = client.post("/api/sessions", headers=headers)
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def end(client: TestClient, headers: Headers, session_id: int) -> None:
    response = client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=headers
    )
    assert response.status_code == 200, response.text


def submit(client: TestClient, headers: Headers, session_id: int, **changes: Any) -> Any:
    return client.post(
        f"/api/sessions/{session_id}/questionnaire", json=answers(**changes), headers=headers
    )


# Saving and reading


def test_submit_saves_answers_without_flags(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = submit(client, patient_headers, session_id)

    assert response.status_code == 201
    body = response.json()
    assert body["session_id"] == session_id
    assert body["pain_0_10"] == 1
    assert body["fatigue_0_10"] == 3
    assert body["enjoyment_1_5"] == 4
    assert body["difficulty"] == "just_right"
    assert body["new_symptoms"] is False
    assert body["comment"] == "Felt good"
    assert body["flags"] == []
    assert body["needs_review"] is False
    assert body["created_at"].endswith("Z")


def test_get_returns_saved_answers(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    saved = submit(client, patient_headers, session_id, pain_0_10=6).json()

    response = client.get(f"/api/sessions/{session_id}/questionnaire", headers=patient_headers)

    assert response.status_code == 200
    assert response.json() == saved


def test_get_before_submit_is_404(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = client.get(f"/api/sessions/{session_id}/questionnaire", headers=patient_headers)

    assert response.status_code == 404


def test_second_submit_is_409_and_keeps_first(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    submit(client, patient_headers, session_id, pain_0_10=2)

    response = submit(client, patient_headers, session_id, pain_0_10=9)

    assert response.status_code == 409
    saved = client.get(f"/api/sessions/{session_id}/questionnaire", headers=patient_headers)
    assert saved.json()["pain_0_10"] == 2
    assert saved.json()["flags"] == []


def test_submit_after_session_ended(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    end(client, patient_headers, session_id)

    response = submit(client, patient_headers, session_id)

    assert response.status_code == 201


def test_blank_comment_is_saved_as_null(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = submit(client, patient_headers, session_id, comment="   ")

    assert response.json()["comment"] is None


def test_comment_may_be_left_out(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    payload = answers()
    del payload["comment"]

    response = client.post(
        f"/api/sessions/{session_id}/questionnaire", json=payload, headers=patient_headers
    )

    assert response.status_code == 201
    assert response.json()["comment"] is None


# Validation


@pytest.mark.parametrize(
    "changes",
    [
        {"pain_0_10": -1},
        {"pain_0_10": 11},
        {"pain_0_10": 4.5},
        {"pain_0_10": "4"},
        {"fatigue_0_10": -1},
        {"fatigue_0_10": 11},
        {"enjoyment_1_5": 0},
        {"enjoyment_1_5": 6},
        {"difficulty": "medium"},
        {"new_symptoms": "yes"},
        {"new_symptoms": 1},
        {"comment": "x" * 301},
        {"unknown": 1},
    ],
)
def test_invalid_answers_are_422(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start(client, patient_headers)

    response = submit(client, patient_headers, session_id, **changes)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "field", ["pain_0_10", "fatigue_0_10", "enjoyment_1_5", "difficulty", "new_symptoms"]
)
def test_missing_answer_is_422(client: TestClient, patient_headers: Headers, field: str) -> None:
    session_id = start(client, patient_headers)
    payload = answers()
    del payload[field]

    response = client.post(
        f"/api/sessions/{session_id}/questionnaire", json=payload, headers=patient_headers
    )

    assert response.status_code == 422


def test_comment_of_300_characters_is_accepted(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)

    response = submit(client, patient_headers, session_id, comment="x" * 300)

    assert response.status_code == 201


# Ownership and roles


def test_other_patients_session_is_404(
    client: TestClient,
    patient_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    session_id = start(client, patient_headers)
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)

    assert submit(client, other, session_id).status_code == 404
    submit(client, patient_headers, session_id)
    response = client.get(f"/api/sessions/{session_id}/questionnaire", headers=other)
    assert response.status_code == 404


def test_missing_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    assert submit(client, patient_headers, 9999).status_code == 404


def test_admin_cannot_submit(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start(client, patient_headers)

    assert submit(client, admin_headers, session_id).status_code == 403


def test_needs_login(client: TestClient) -> None:
    assert client.post("/api/sessions/1/questionnaire", json=answers()).status_code == 401
    assert client.get("/api/sessions/1/questionnaire").status_code == 401


# Flag rules


@pytest.mark.parametrize(
    ("changes", "flags"),
    [
        ({"pain_0_10": 3}, []),
        ({"pain_0_10": 4}, ["pain"]),
        ({"pain_0_10": 10}, ["pain"]),
        ({"new_symptoms": True}, ["new_symptoms"]),
        ({"fatigue_0_10": 7}, []),
        ({"fatigue_0_10": 8}, ["high_fatigue"]),
        ({"fatigue_0_10": 10}, ["high_fatigue"]),
        (
            {"pain_0_10": 5, "new_symptoms": True, "fatigue_0_10": 9},
            ["pain", "new_symptoms", "high_fatigue"],
        ),
        # Enjoyment and difficulty never raise a flag.
        ({"enjoyment_1_5": 1, "difficulty": "too_hard"}, []),
    ],
)
def test_flag_rules(
    client: TestClient,
    patient_headers: Headers,
    admin_headers: Headers,
    changes: dict[str, Any],
    flags: list[str],
) -> None:
    session_id = start(client, patient_headers)

    body = submit(client, patient_headers, session_id, **changes).json()

    assert body["flags"] == flags
    assert body["needs_review"] is bool(flags)
    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["flags"] == flags
    assert detail["needs_review"] is bool(flags)


def test_thresholds_are_the_agreed_constants() -> None:
    assert safety.PAIN_FLAG_MIN == 4
    assert safety.HIGH_FATIGUE_FLAG_MIN == 8


# Admin session detail


def test_admin_session_detail_includes_answers(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["feedback"] is None
    assert detail["flags"] == []
    assert detail["reviewed_at"] is None

    submit(client, patient_headers, session_id, pain_0_10=7, comment="Sore wrist")

    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["feedback"]["pain_0_10"] == 7
    assert detail["feedback"]["comment"] == "Sore wrist"
    assert detail["flags"] == ["pain"]


# Alerts: see test_alerts.py (Day 17).


# Upgrading a database from an earlier day


def test_existing_session_table_gets_new_columns() -> None:
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
    create_db_and_tables(engine)  # Running again changes nothing.

    columns = {column["name"] for column in inspect(engine).get_columns("session")}
    assert {"flags", "needs_review", "reviewed_at", "review_note"} <= columns
    assert "sessionfeedback" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        row = connection.execute(text("SELECT flags, needs_review FROM session")).one()
    assert row == ("[]", 0)
    engine.dispose()
