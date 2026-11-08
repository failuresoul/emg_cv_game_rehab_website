from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import WarmupResult
from app.models.user import utc_now

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]


def result_payload(exercise_id: str = "shoulder_flexion", **changes: Any) -> dict[str, Any]:
    payload = {
        "exercise_id": exercise_id,
        "preset": "standard",
        "thresholds": {"low": 30, "high": 90, "unit": "deg"},
        "personalisation": None,
        "full_reps": 8,
        "partial_reps": 2,
        "target_reps": 10,
        "best_peak": 104.5,
        "mean_duration_ms": 2400.0,
        "active_time_ms": 41000.0,
        "paused_time_ms": 1500.0,
        "measure_source": "3d",
        "trunk_reference": "hip",
        "compensated_reps": 1,
        "compensation_rate": 0.1,
        "reps": [
            {"index": 1, "peak": 98.0, "duration_ms": 2300.0, "compensated": False},
            {
                "index": 2,
                "peak": 104.5,
                "duration_ms": 2500.0,
                "compensated": True,
                "compensation_type": "trunk_lean",
            },
        ],
        "skipped": False,
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


def save(
    client: TestClient, headers: Headers, session_id: int, results: list[dict[str, Any]]
) -> Any:
    return client.post(f"/api/sessions/{session_id}/warmup", json=results, headers=headers)


def save_in_new_session(
    client: TestClient, headers: Headers, results: list[dict[str, Any]]
) -> int:
    """Each call is a separate, completed session, so history spans several sessions."""
    session_id = start(client, headers)
    assert save(client, headers, session_id, results).status_code == 200
    end(client, headers, session_id)
    return session_id


def backdate(session: Session, session_id: int, days: int) -> None:
    for row in session.exec(select(WarmupResult).where(WarmupResult.session_id == session_id)):
        row.created_at = utc_now() - timedelta(days=days)
        session.add(row)
    session.commit()


@pytest.fixture
def other_headers(create_patient: CreatePatient, login: Login) -> Headers:
    create_patient(email="other@example.com")
    return login("other@example.com", PATIENT_PASSWORD)


# Saving


def test_save_returns_all_results(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = save(
        client,
        patient_headers,
        session_id,
        [result_payload(), result_payload("elbow_flexion", trunk_reference="n/a")],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["exercise_id"] for item in body] == ["shoulder_flexion", "elbow_flexion"]
    first = body[0]
    assert first["session_id"] == session_id
    assert first["thresholds"] == {"low": 30, "high": 90, "unit": "deg"}
    assert first["reps"][1]["compensation_type"] == "trunk_lean"
    assert first["reps"][0]["compensation_type"] is None
    assert first["created_at"].endswith("Z")


def test_get_returns_saved_results(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    save(client, patient_headers, session_id, [result_payload()])

    response = client.get(f"/api/sessions/{session_id}/warmup", headers=patient_headers)

    assert response.status_code == 200
    assert [item["exercise_id"] for item in response.json()] == ["shoulder_flexion"]


def test_get_is_empty_before_saving(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = client.get(f"/api/sessions/{session_id}/warmup", headers=patient_headers)

    assert response.status_code == 200
    assert response.json() == []


def test_save_again_replaces_that_exercise_only(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    session_id = start(client, patient_headers)
    save(
        client,
        patient_headers,
        session_id,
        [result_payload(), result_payload("shoulder_abduction")],
    )

    response = save(
        client,
        patient_headers,
        session_id,
        [
            result_payload(
                preset="personal",
                full_reps=10,
                partial_reps=0,
                compensated_reps=0,
                compensation_rate=0.0,
                personalisation={"previous_high": 90, "new_high": 95, "reason": "met_target"},
            )
        ],
    )

    assert response.status_code == 200, response.text
    by_exercise = {item["exercise_id"]: item for item in response.json()}
    assert set(by_exercise) == {"shoulder_flexion", "shoulder_abduction"}
    assert by_exercise["shoulder_flexion"]["preset"] == "personal"
    assert by_exercise["shoulder_flexion"]["full_reps"] == 10
    assert by_exercise["shoulder_flexion"]["personalisation"]["new_high"] == 95
    assert by_exercise["shoulder_abduction"]["full_reps"] == 8
    rows = session.exec(select(WarmupResult).where(WarmupResult.session_id == session_id)).all()
    assert len(rows) == 2


def test_save_a_skipped_exercise_with_no_measurements(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    skipped = result_payload(
        full_reps=0,
        partial_reps=0,
        compensated_reps=0,
        compensation_rate=0.0,
        best_peak=None,
        mean_duration_ms=None,
        measure_source=None,
        trunk_reference=None,
        reps=[],
        skipped=True,
    )

    response = save(client, patient_headers, session_id, [skipped])

    assert response.status_code == 200, response.text
    assert response.json()[0]["skipped"] is True
    assert response.json()[0]["best_peak"] is None


def test_save_to_ended_session_is_409(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    end(client, patient_headers, session_id)

    response = save(client, patient_headers, session_id, [result_payload()])

    assert response.status_code == 409


# Validation


@pytest.mark.parametrize(
    "changes",
    [
        {"full_reps": -1},
        {"partial_reps": -1},
        {"compensated_reps": -1},
        {"target_reps": 0},
        {"active_time_ms": -1},
        {"paused_time_ms": -5},
        {"mean_duration_ms": -1},
        {"compensation_rate": 1.5},
        {"compensation_rate": -0.1},
        {"compensated_reps": 11},  # More than full + partial reps.
        {"preset": "easy"},
        {"measure_source": "4d"},
        {"trunk_reference": "shoulder"},
        {"thresholds": {"low": 90, "high": 30, "unit": "deg"}},
        {"thresholds": {"low": 30, "high": 90}},
        {"thresholds": {"low": 30, "high": 90, "unit": "cm"}},
        {"reps": [{"index": 0, "peak": 90, "duration_ms": 2000}]},
        {"reps": [{"index": 1, "peak": 90, "duration_ms": -1}]},
        {"personalisation": {"previous_high": 90, "new_high": 95, "reason": ""}},
        {"unexpected": True},
    ],
)
def test_invalid_result_is_422(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start(client, patient_headers)

    response = save(client, patient_headers, session_id, [result_payload(**changes)])

    assert response.status_code == 422, changes


def test_unknown_exercise_is_422(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    response = save(client, patient_headers, session_id, [result_payload("push_ups")])

    assert response.status_code == 422


def test_every_known_exercise_is_accepted(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    known = [
        "shoulder_flexion",
        "shoulder_abduction",
        "elbow_flexion",
        "forward_reach",
        "hand_open_close",
        "thumb_opposition",
    ]

    response = save(
        client, patient_headers, session_id, [result_payload(exercise) for exercise in known]
    )

    assert response.status_code == 200, response.text
    assert len(response.json()) == len(known)


def test_same_exercise_twice_in_one_body_is_422(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)

    response = save(client, patient_headers, session_id, [result_payload(), result_payload()])

    assert response.status_code == 422


def test_empty_list_is_422(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)

    assert save(client, patient_headers, session_id, []).status_code == 422


def test_nan_is_422(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    body = '[{"exercise_id": "shoulder_flexion", "best_peak": NaN}]'

    response = client.post(
        f"/api/sessions/{session_id}/warmup",
        content=body,
        headers={**patient_headers, "Content-Type": "application/json"},
    )

    assert response.status_code == 422


# Access


def test_another_patients_session_is_404(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    save(client, patient_headers, session_id, [result_payload()])

    assert save(client, other_headers, session_id, [result_payload()]).status_code == 404
    response = client.get(f"/api/sessions/{session_id}/warmup", headers=other_headers)
    assert response.status_code == 404


def test_missing_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    assert save(client, patient_headers, 9999, [result_payload()]).status_code == 404
    assert client.get("/api/sessions/9999/warmup", headers=patient_headers).status_code == 404


def test_admin_cannot_use_patient_routes(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start(client, patient_headers)

    assert save(client, admin_headers, session_id, [result_payload()]).status_code == 403
    response = client.get(
        "/api/patient/warmup/history?exercise_id=shoulder_flexion", headers=admin_headers
    )
    assert response.status_code == 403


def test_without_token_is_401(client: TestClient) -> None:
    assert client.post("/api/sessions/1/warmup", json=[result_payload()]).status_code == 401
    assert client.get("/api/sessions/1/warmup").status_code == 401
    response = client.get("/api/patient/warmup/history?exercise_id=shoulder_flexion")
    assert response.status_code == 401


# Patient history


def test_history_newest_first_with_limit_and_no_skipped(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    ids = []
    for days_ago, best_peak, skipped in [(4, 80.0, False), (3, 85.0, True), (2, 90.0, False)]:
        session_id = save_in_new_session(
            client,
            patient_headers,
            [result_payload(best_peak=best_peak, skipped=skipped), result_payload("elbow_flexion")],
        )
        backdate(session, session_id, days_ago)
        ids.append(session_id)
    ids.append(save_in_new_session(client, patient_headers, [result_payload(best_peak=95.0)]))

    response = client.get(
        "/api/patient/warmup/history?exercise_id=shoulder_flexion&limit=2",
        headers=patient_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["session_id"] for item in body] == [ids[3], ids[2]]
    assert [item["best_peak"] for item in body] == [95.0, 90.0]
    assert all(item["exercise_id"] == "shoulder_flexion" for item in body)

    everything = client.get(
        "/api/patient/warmup/history?exercise_id=shoulder_flexion", headers=patient_headers
    ).json()
    assert [item["session_id"] for item in everything] == [ids[3], ids[2], ids[0]]


def test_history_defaults_to_five(client: TestClient, patient_headers: Headers) -> None:
    for _ in range(6):
        save_in_new_session(client, patient_headers, [result_payload()])

    response = client.get(
        "/api/patient/warmup/history?exercise_id=shoulder_flexion", headers=patient_headers
    )

    assert len(response.json()) == 5


def test_history_shows_only_own_results(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    save_in_new_session(client, other_headers, [result_payload()])

    response = client.get(
        "/api/patient/warmup/history?exercise_id=shoulder_flexion", headers=patient_headers
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize(
    "query",
    ["", "?exercise_id=push_ups", "?exercise_id=shoulder_flexion&limit=0",
     "?exercise_id=shoulder_flexion&limit=51"],
)
def test_history_bad_query_is_422(
    client: TestClient, patient_headers: Headers, query: str
) -> None:
    response = client.get(f"/api/patient/warmup/history{query}", headers=patient_headers)

    assert response.status_code == 422


# Admin history


def test_admin_history_per_exercise_oldest_first(
    client: TestClient,
    create_patient: CreatePatient,
    login: Login,
    admin_headers: Headers,
    session: Session,
) -> None:
    patient = create_patient(email="bob@example.com")
    headers = login("bob@example.com", PATIENT_PASSWORD)
    old = save_in_new_session(
        client,
        headers,
        [
            result_payload(best_peak=80.0, full_reps=6),
            result_payload(
                "elbow_flexion",
                thresholds={"low": 70, "high": 140, "unit": "deg"},
                trunk_reference="n/a",
            ),
        ],
    )
    backdate(session, old, 3)
    skipped = save_in_new_session(client, headers, [result_payload(skipped=True)])
    backdate(session, skipped, 2)
    new = save_in_new_session(
        client,
        headers,
        [result_payload(best_peak=96.0, thresholds={"low": 30, "high": 95, "unit": "deg"})],
    )

    response = client.get(f"/api/admin/patients/{patient['id']}/warmup", headers=admin_headers)

    assert response.status_code == 200, response.text
    by_exercise = {item["exercise_id"]: item["points"] for item in response.json()}
    assert set(by_exercise) == {"elbow_flexion", "shoulder_flexion"}
    flexion = by_exercise["shoulder_flexion"]
    assert [point["session_id"] for point in flexion] == [old, new]
    assert flexion[0] == {
        "session_id": old,
        "date": flexion[0]["date"],
        "preset": "standard",
        "best_peak": 80.0,
        "target_high": 90.0,
        "full_reps": 6,
        "compensation_rate": 0.1,
    }
    assert flexion[1]["target_high"] == 95.0
    assert flexion[0]["date"].endswith("Z")
    assert by_exercise["elbow_flexion"][0]["target_high"] == 140.0


def test_admin_history_filters_by_exercise(
    client: TestClient,
    create_patient: CreatePatient,
    login: Login,
    admin_headers: Headers,
) -> None:
    patient = create_patient(email="bob@example.com")
    headers = login("bob@example.com", PATIENT_PASSWORD)
    save_in_new_session(client, headers, [result_payload(), result_payload("elbow_flexion")])

    response = client.get(
        f"/api/admin/patients/{patient['id']}/warmup?exercise_id=elbow_flexion",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert [item["exercise_id"] for item in response.json()] == ["elbow_flexion"]


def test_admin_history_empty_and_errors(
    client: TestClient, create_patient: CreatePatient, admin_headers: Headers
) -> None:
    patient = create_patient(email="bob@example.com")

    empty = client.get(f"/api/admin/patients/{patient['id']}/warmup", headers=admin_headers)
    missing = client.get("/api/admin/patients/9999/warmup", headers=admin_headers)
    unknown = client.get(
        f"/api/admin/patients/{patient['id']}/warmup?exercise_id=push_ups", headers=admin_headers
    )

    assert empty.status_code == 200
    assert empty.json() == []
    assert missing.status_code == 404
    assert unknown.status_code == 422


def test_admin_history_requires_admin(
    client: TestClient, create_patient: CreatePatient, patient_headers: Headers
) -> None:
    patient = create_patient(email="bob@example.com")
    url = f"/api/admin/patients/{patient['id']}/warmup"

    assert client.get(url, headers=patient_headers).status_code == 403
    assert client.get(url).status_code == 401


# Dashboard


def test_dashboard_summary_leaves_out_skipped(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    save(
        client,
        patient_headers,
        session_id,
        [
            result_payload(full_reps=8, compensation_rate=0.1),
            result_payload("shoulder_abduction", full_reps=6, compensation_rate=0.3),
            result_payload("elbow_flexion", full_reps=0, compensated_reps=0, skipped=True),
        ],
    )

    response = client.get("/api/patient/dashboard", headers=patient_headers)

    assert response.status_code == 200
    summary = response.json()["last_session"]["warmup_summary"]
    assert summary["exercises_done"] == 2
    assert summary["total_reps"] == 14
    assert summary["mean_compensation_rate"] == pytest.approx(0.2)


def test_dashboard_summary_is_null_without_warmup(
    client: TestClient, patient_headers: Headers
) -> None:
    start(client, patient_headers)

    response = client.get("/api/patient/dashboard", headers=patient_headers)

    assert response.json()["last_session"]["warmup_summary"] is None


def test_dashboard_summary_when_everything_skipped(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    save(
        client,
        patient_headers,
        session_id,
        [result_payload(full_reps=0, partial_reps=0, compensated_reps=0, skipped=True)],
    )

    summary = client.get("/api/patient/dashboard", headers=patient_headers).json()[
        "last_session"
    ]["warmup_summary"]

    assert summary == {"exercises_done": 0, "total_reps": 0, "mean_compensation_rate": None}


def test_dashboard_summary_is_for_the_last_session_only(
    client: TestClient, patient_headers: Headers
) -> None:
    save_in_new_session(client, patient_headers, [result_payload(full_reps=9)])
    start(client, patient_headers)

    response = client.get("/api/patient/dashboard", headers=patient_headers)

    assert response.json()["last_session"]["warmup_summary"] is None
