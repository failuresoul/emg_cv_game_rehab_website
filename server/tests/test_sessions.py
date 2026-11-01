from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Calibration, PatientProfile
from app.models import Session as SessionRecord
from app.models.user import utc_now

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]


def calibration_payload(**changes: Any) -> dict[str, Any]:
    payload = {
        "affected_side": "left",  # Matches the create_patient fixture default.
        "shoulder_width_px": 180.5,
        "directions_deg": [0, 45, 90, 135, 180, 225, 270, 315],
        "reach_radii_sw": [1.0, 1.1, 1.2, 1.3, 1.4, 1.3, 1.2, 1.1],
        "reach_points_sw": [[1.0, 0.0]] * 8,
        "hull_sw": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        "hull_area_sw2": 0.5,
        "quality": {"valid": [True] * 8, "retries": 1, "max_trunk_displacement_sw": 0.05},
    }
    return {**payload, **changes}


def start(client: TestClient, headers: Headers) -> dict[str, Any]:
    response = client.post("/api/sessions", headers=headers)
    assert response.status_code in (200, 201), response.text
    return response.json()


def own_profile(session: Session) -> PatientProfile:
    return session.exec(select(PatientProfile)).one()


def add_old_session(session: Session, patient_id: int, age: timedelta) -> int:
    record = SessionRecord(patient_id=patient_id, started_at=utc_now() - age)
    session.add(record)
    session.commit()
    assert record.id is not None
    return record.id


# Starting, resuming and aborting


def test_start_creates_active_session(client: TestClient, patient_headers: Headers) -> None:
    response = client.post(
        "/api/sessions",
        json={"device_info": {"browser": "Chrome", "fps": 30.5, "delegate": "GPU"}, "notes": "Hi"},
        headers=patient_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "active"
    assert body["ended_at"] is None
    assert body["device_info"] == {"browser": "Chrome", "fps": 30.5, "delegate": "GPU"}
    assert body["notes"] == "Hi"
    assert body["started_at"].endswith("Z")


def test_start_resumes_recent_active_session(client: TestClient, patient_headers: Headers) -> None:
    first = start(client, patient_headers)

    response = client.post("/api/sessions", headers=patient_headers)

    assert response.status_code == 200
    assert response.json()["id"] == first["id"]


def test_start_resumes_session_just_under_two_hours_old(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    old_id = add_old_session(session, own_profile(session).id or 0, timedelta(minutes=119))

    assert start(client, patient_headers)["id"] == old_id


def test_start_aborts_session_older_than_two_hours(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    old_id = add_old_session(session, own_profile(session).id or 0, timedelta(hours=2, seconds=1))

    new = start(client, patient_headers)

    assert new["id"] != old_id
    assert new["status"] == "active"
    old = session.get(SessionRecord, old_id)
    assert old is not None
    assert old.status == "aborted"
    assert old.ended_at is None


def test_start_after_end_creates_new_session(client: TestClient, patient_headers: Headers) -> None:
    first = start(client, patient_headers)
    client.post(
        f"/api/sessions/{first['id']}/end", json={"status": "completed"}, headers=patient_headers
    )

    assert start(client, patient_headers)["id"] != first["id"]


def test_start_rejects_unknown_fields(client: TestClient, patient_headers: Headers) -> None:
    response = client.post("/api/sessions", json={"patient_id": 99}, headers=patient_headers)
    assert response.status_code == 422


# Current session


def test_current_returns_active_session(client: TestClient, patient_headers: Headers) -> None:
    started = start(client, patient_headers)

    response = client.get("/api/sessions/current", headers=patient_headers)

    assert response.status_code == 200
    assert response.json()["id"] == started["id"]


def test_current_without_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    assert client.get("/api/sessions/current", headers=patient_headers).status_code == 404


def test_current_ignores_and_aborts_expired_session(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    old_id = add_old_session(session, own_profile(session).id or 0, timedelta(hours=3))

    assert client.get("/api/sessions/current", headers=patient_headers).status_code == 404
    old = session.get(SessionRecord, old_id)
    assert old is not None
    assert old.status == "aborted"


# Ending


@pytest.mark.parametrize("status", ["completed", "aborted"])
def test_end_sets_status_and_ended_at(
    client: TestClient, patient_headers: Headers, status: str
) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/end", json={"status": status}, headers=patient_headers
    )

    assert response.status_code == 200
    assert response.json()["status"] == status
    assert response.json()["ended_at"] is not None
    assert client.get("/api/sessions/current", headers=patient_headers).status_code == 404


@pytest.mark.parametrize("body", [{"status": "active"}, {"status": "paused"}, {}])
def test_end_invalid_status_is_422(
    client: TestClient, patient_headers: Headers, body: dict[str, Any]
) -> None:
    started = start(client, patient_headers)

    response = client.post(f"/api/sessions/{started['id']}/end", json=body, headers=patient_headers)

    assert response.status_code == 422


def test_end_twice_is_409(client: TestClient, patient_headers: Headers) -> None:
    started = start(client, patient_headers)
    url = f"/api/sessions/{started['id']}/end"
    client.post(url, json={"status": "completed"}, headers=patient_headers)

    response = client.post(url, json={"status": "aborted"}, headers=patient_headers)

    assert response.status_code == 409


def test_end_unknown_session_is_404(client: TestClient, patient_headers: Headers) -> None:
    response = client.post(
        "/api/sessions/999/end", json={"status": "completed"}, headers=patient_headers
    )
    assert response.status_code == 404


# Device info


def test_update_device_info(client: TestClient, patient_headers: Headers) -> None:
    started = start(client, patient_headers)
    info = {"browser": "Chrome 140", "fps": 28.5, "delegate": "CPU"}

    response = client.patch(
        f"/api/sessions/{started['id']}/device-info", json=info, headers=patient_headers
    )

    assert response.status_code == 200
    assert response.json()["device_info"] == info


def test_update_device_info_invalid_is_422(client: TestClient, patient_headers: Headers) -> None:
    started = start(client, patient_headers)

    response = client.patch(
        f"/api/sessions/{started['id']}/device-info",
        json={"delegate": "TPU"},
        headers=patient_headers,
    )

    assert response.status_code == 422


def test_update_device_info_unknown_session_is_404(
    client: TestClient, patient_headers: Headers
) -> None:
    response = client.patch(
        "/api/sessions/999/device-info", json={"fps": 30}, headers=patient_headers
    )
    assert response.status_code == 404


# Saving a calibration


def test_save_calibration(client: TestClient, patient_headers: Headers) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["session_id"] == started["id"]
    assert body["hull_area_sw2"] == 0.5
    assert body["reach_points_sw"][0] == [1.0, 0.0]
    assert body["quality"]["retries"] == 1
    assert body["created_at"].endswith("Z")


@pytest.mark.parametrize(
    "change",
    [
        pytest.param({"directions_deg": [0, 45, 90, 135, 180, 225, 270]}, id="7-directions"),
        pytest.param({"directions_deg": [0, 45, 90, 135, 180, 225, 270, 315, 0]}, id="9-directions"),
        pytest.param({"directions_deg": [0, 40, 90, 135, 180, 225, 270, 315]}, id="wrong-angle"),
        pytest.param({"reach_radii_sw": [1.0] * 7}, id="7-radii"),
        pytest.param({"reach_radii_sw": [1.0] * 9}, id="9-radii"),
        pytest.param({"reach_radii_sw": [0.19] + [1.0] * 7}, id="radius-too-small"),
        pytest.param({"reach_radii_sw": [3.01] + [1.0] * 7}, id="radius-too-large"),
        pytest.param({"reach_points_sw": [[1.0, 0.0]] * 7}, id="7-points"),
        pytest.param({"reach_points_sw": [[1.0]] * 8}, id="point-not-a-pair"),
        pytest.param({"hull_sw": [[0.0, 0.0], [1.0, 0.0]]}, id="hull-2-points"),
        pytest.param({"hull_area_sw2": 0}, id="zero-area"),
        pytest.param({"shoulder_width_px": 0}, id="zero-shoulder-width"),
        pytest.param({"affected_side": "both"}, id="unknown-side"),
        pytest.param({"affected_side": "right"}, id="side-differs-from-profile"),
        pytest.param({"quality": {"valid": [True] * 7, "retries": 0, "max_trunk_displacement_sw": 0}}, id="7-valid-flags"),
        pytest.param({"quality": {"valid": [True] * 8, "retries": -1, "max_trunk_displacement_sw": 0}}, id="negative-retries"),
        pytest.param({"session_id": 5}, id="unknown-field"),
    ],
)  # fmt: skip
def test_save_calibration_invalid_input_is_422(
    client: TestClient, patient_headers: Headers, change: dict[str, Any]
) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(**change),
        headers=patient_headers,
    )

    assert response.status_code == 422, response.text


def test_save_calibration_rejects_not_a_number(
    client: TestClient, patient_headers: Headers
) -> None:
    started = start(client, patient_headers)

    # Python's JSON parser accepts NaN, which would then corrupt the stored numbers.
    content = (
        '{"affected_side":"left","shoulder_width_px":NaN,'
        '"directions_deg":[0,45,90,135,180,225,270,315],'
        '"reach_radii_sw":[1,1,1,1,1,1,1,1],'
        '"reach_points_sw":[[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]],'
        '"hull_sw":[[0,0],[1,0],[0,1]],"hull_area_sw2":0.5,'
        '"quality":{"valid":[true,true,true,true,true,true,true,true],'
        '"retries":0,"max_trunk_displacement_sw":0}}'
    )
    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        content=content,
        headers={**patient_headers, "Content-Type": "application/json"},
    )

    assert response.status_code == 422


@pytest.mark.parametrize("radius", [0.2, 3.0])
def test_save_calibration_accepts_radius_limits(
    client: TestClient, patient_headers: Headers, radius: float
) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(reach_radii_sw=[radius] * 8),
        headers=patient_headers,
    )

    assert response.status_code == 201


def test_save_calibration_twice_is_409(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    started = start(client, patient_headers)
    url = f"/api/sessions/{started['id']}/calibration"
    client.post(url, json=calibration_payload(), headers=patient_headers)

    response = client.post(url, json=calibration_payload(), headers=patient_headers)

    assert response.status_code == 409
    assert len(session.exec(select(Calibration)).all()) == 1


def test_save_calibration_on_ended_session_is_409(
    client: TestClient, patient_headers: Headers
) -> None:
    started = start(client, patient_headers)
    client.post(
        f"/api/sessions/{started['id']}/end", json={"status": "aborted"}, headers=patient_headers
    )

    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )

    assert response.status_code == 409


def test_save_calibration_unknown_session_is_404(
    client: TestClient, patient_headers: Headers
) -> None:
    response = client.post(
        "/api/sessions/999/calibration", json=calibration_payload(), headers=patient_headers
    )
    assert response.status_code == 404


# Latest calibration and own session list


def test_latest_calibration_without_any_is_404(
    client: TestClient, patient_headers: Headers
) -> None:
    assert client.get("/api/patient/calibration/latest", headers=patient_headers).status_code == 404


def test_latest_calibration_returns_newest(client: TestClient, patient_headers: Headers) -> None:
    for area in (0.5, 0.75):
        started = start(client, patient_headers)
        client.post(
            f"/api/sessions/{started['id']}/calibration",
            json=calibration_payload(hull_area_sw2=area),
            headers=patient_headers,
        )
        client.post(
            f"/api/sessions/{started['id']}/end",
            json={"status": "completed"},
            headers=patient_headers,
        )

    response = client.get("/api/patient/calibration/latest", headers=patient_headers)

    assert response.status_code == 200
    assert response.json()["hull_area_sw2"] == 0.75


def test_patient_sessions_newest_first_with_hull_area(
    client: TestClient, patient_headers: Headers
) -> None:
    first = start(client, patient_headers)
    client.post(
        f"/api/sessions/{first['id']}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )
    client.post(
        f"/api/sessions/{first['id']}/end", json={"status": "completed"}, headers=patient_headers
    )
    second = start(client, patient_headers)

    response = client.get("/api/patient/sessions", headers=patient_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [second["id"], first["id"]]
    assert body[0]["hull_area_sw2"] is None
    assert body[0]["duration_seconds"] is None
    assert body[1]["hull_area_sw2"] == 0.5
    assert body[1]["duration_seconds"] >= 0


# Another patient's data


@pytest.fixture
def other_headers(create_patient: CreatePatient, login: Login) -> Headers:
    create_patient(email="other@example.com")
    return login("other@example.com", PATIENT_PASSWORD)


def test_patient_cannot_end_another_patients_session(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/end", json={"status": "aborted"}, headers=other_headers
    )

    assert response.status_code == 404
    current = client.get("/api/sessions/current", headers=patient_headers)
    assert current.json()["status"] == "active"


def test_patient_cannot_update_another_patients_device_info(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    started = start(client, patient_headers)

    response = client.patch(
        f"/api/sessions/{started['id']}/device-info", json={"fps": 1}, headers=other_headers
    )

    assert response.status_code == 404


def test_patient_cannot_calibrate_another_patients_session(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    started = start(client, patient_headers)

    response = client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(),
        headers=other_headers,
    )

    assert response.status_code == 404


def test_patient_sees_only_own_sessions_and_calibration(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    started = start(client, patient_headers)
    client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )

    assert client.get("/api/sessions/current", headers=other_headers).status_code == 404
    assert client.get("/api/patient/sessions", headers=other_headers).json() == []
    assert client.get("/api/patient/calibration/latest", headers=other_headers).status_code == 404


def test_starting_does_not_resume_another_patients_session(
    client: TestClient, patient_headers: Headers, other_headers: Headers
) -> None:
    assert start(client, patient_headers)["id"] != start(client, other_headers)["id"]


PATIENT_ROUTES = [
    ("POST", "/api/sessions"),
    ("GET", "/api/sessions/current"),
    ("PATCH", "/api/sessions/1/device-info"),
    ("POST", "/api/sessions/1/end"),
    ("POST", "/api/sessions/1/calibration"),
    ("GET", "/api/patient/calibration/latest"),
    ("GET", "/api/patient/sessions"),
]


@pytest.mark.parametrize(("method", "path"), PATIENT_ROUTES)
def test_admin_gets_403_on_patient_routes(
    client: TestClient, admin_headers: Headers, method: str, path: str
) -> None:
    assert client.request(method, path, headers=admin_headers).status_code == 403


@pytest.mark.parametrize(("method", "path"), PATIENT_ROUTES)
def test_patient_routes_without_token_are_401(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path).status_code == 401


# Admin lists


def test_admin_lists_patient_sessions_with_duration(
    client: TestClient,
    admin_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    patient = create_patient(email="listed@example.com")
    headers = login("listed@example.com", PATIENT_PASSWORD)
    started = start(client, headers)
    client.post(f"/api/sessions/{started['id']}/end", json={"status": "completed"}, headers=headers)
    active = start(client, headers)

    response = client.get(f"/api/admin/patients/{patient['id']}/sessions", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [active["id"], started["id"]]
    assert body[0]["status"] == "active"
    assert body[0]["duration_seconds"] is None
    assert body[1]["status"] == "completed"
    assert body[1]["duration_seconds"] >= 0


def test_admin_lists_patient_calibrations(
    client: TestClient,
    admin_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    patient = create_patient(email="listed@example.com")
    create_patient(email="unrelated@example.com")
    headers = login("listed@example.com", PATIENT_PASSWORD)
    started = start(client, headers)
    client.post(
        f"/api/sessions/{started['id']}/calibration", json=calibration_payload(), headers=headers
    )

    response = client.get(
        f"/api/admin/patients/{patient['id']}/calibrations", headers=admin_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["session_id"] == started["id"]
    assert body[0]["created_at"].endswith("Z")
    assert body[0]["reach_radii_sw"] == calibration_payload()["reach_radii_sw"]
    assert body[0]["hull_sw"] == calibration_payload()["hull_sw"]
    assert body[0]["hull_area_sw2"] == 0.5


@pytest.mark.parametrize("resource", ["sessions", "calibrations"])
def test_admin_lists_for_unknown_patient_are_404(
    client: TestClient, admin_headers: Headers, resource: str
) -> None:
    response = client.get(f"/api/admin/patients/999/{resource}", headers=admin_headers)
    assert response.status_code == 404


@pytest.mark.parametrize("resource", ["sessions", "calibrations"])
def test_patient_gets_403_on_admin_lists(
    client: TestClient, patient_headers: Headers, resource: str
) -> None:
    response = client.get(f"/api/admin/patients/1/{resource}", headers=patient_headers)
    assert response.status_code == 403


# Dashboard and stats


def test_dashboard_without_sessions_has_nulls(client: TestClient, patient_headers: Headers) -> None:
    body = client.get("/api/patient/dashboard", headers=patient_headers).json()

    assert body["last_session"] is None
    assert body["latest_calibration"] is None


def test_dashboard_returns_last_session_and_latest_calibration(
    client: TestClient, patient_headers: Headers
) -> None:
    started = start(client, patient_headers)
    client.post(
        f"/api/sessions/{started['id']}/calibration",
        json=calibration_payload(),
        headers=patient_headers,
    )
    client.post(
        f"/api/sessions/{started['id']}/end", json={"status": "completed"}, headers=patient_headers
    )

    body = client.get("/api/patient/dashboard", headers=patient_headers).json()

    assert body["last_session"]["date"] == started["started_at"]
    assert body["last_session"]["status"] == "completed"
    assert body["last_session"]["duration_seconds"] >= 0
    assert body["latest_calibration"] == {
        "hull_sw": calibration_payload()["hull_sw"],
        "hull_area_sw2": 0.5,
    }


def test_stats_counts_only_sessions_started_today(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    add_old_session(session, own_profile(session).id or 0, timedelta(days=2))
    start(client, patient_headers)

    body = client.get("/api/admin/stats", headers=admin_headers).json()

    assert body["sessions_today"] == 1
