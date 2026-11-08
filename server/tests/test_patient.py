from conftest import Headers
from fastapi.testclient import TestClient


def test_dashboard(client: TestClient, patient_headers: Headers) -> None:
    response = client.get("/api/patient/dashboard", headers=patient_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["patient_code"] == "P001"
    assert body["today_plan"] == [
        {"step": "camera_check", "minutes": 1},
        {"step": "calibration", "minutes": 2},
        {"step": "warmup", "minutes": 10},
        {"step": "games", "minutes": 15},
        {"step": "feedback", "minutes": 2},
    ]
    assert body["last_session"] is None
    assert body["streak_days"] == 0


def test_dashboard_as_admin_is_403(client: TestClient, admin_headers: Headers) -> None:
    assert client.get("/api/patient/dashboard", headers=admin_headers).status_code == 403


def test_dashboard_without_token_is_401(client: TestClient) -> None:
    assert client.get("/api/patient/dashboard").status_code == 401
