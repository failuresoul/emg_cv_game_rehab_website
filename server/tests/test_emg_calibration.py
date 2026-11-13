"""The muscle-sensor calibration API: validation, ownership, latest and the admin list."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import PATIENT_PASSWORD, Headers


def payload(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "site": "flexors",
        "source": "serial",
        "firmware_version": "1.0.0",
        "sample_rate": 500,
        "rest_mean_mv": 210.0,
        "rest_sd_mv": 8.0,
        "mvc_mv": 1750.0,
        "mvc_attempts": [1720.0, 1790.0, 1740.0],
        "readiness": {"web_serial": {"pass": True, "value": True}, "rate": {"pass": True, "value": 500}},
        "quality": {"saturation": False, "gaps_pct": 0.0, "electrode_off": False, "attempts_spread": 0.04},
        "battery_ok": True,
        "gain_note": "Gain knob in the middle",
    }
    body.update(changes)
    return body


def start(client: TestClient, headers: Headers) -> int:
    response = client.post("/api/sessions", json={}, headers=headers)
    assert response.status_code == 201, response.text
    session_id: int = response.json()["id"]
    return session_id


def test_a_calibration_is_saved_with_the_threshold_computed(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    # A sent threshold is never trusted: the field is not accepted.
    bad = client.post(
        f"/api/sessions/{session_id}/emg-calibration", json=payload(threshold_mv=5), headers=patient_headers
    )
    assert bad.status_code == 422
    response = client.post(f"/api/sessions/{session_id}/emg-calibration", json=payload(), headers=patient_headers)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["session_id"] == session_id
    assert body["threshold_mv"] == 234.0  # 210 + 3 x 8
    assert body["mvc_attempts"] == [1720.0, 1790.0, 1740.0]
    assert body["readiness"]["rate"]["value"] == 500
    assert body["quality"]["attempts_spread"] == 0.04
    # Once per session.
    again = client.post(f"/api/sessions/{session_id}/emg-calibration", json=payload(), headers=patient_headers)
    assert again.status_code == 409


@pytest.mark.parametrize(
    "changes",
    [
        {"mvc_mv": 234.0},  # not above rest + 3 SD
        {"mvc_mv": 100.0},
        {"site": "biceps"},
        {"source": "bluetooth"},
        {"rest_mean_mv": -1.0},
        {"mvc_mv": 3601.0},
        {"mvc_attempts": []},
        {"sample_rate": 10},
        {"battery_ok": False},  # a real sensor needs the laptop on battery
        {"gain_note": "x" * 301},
    ],
)
def test_invalid_calibrations_are_refused(
    client: TestClient, patient_headers: Headers, changes: dict[str, Any]
) -> None:
    session_id = start(client, patient_headers)
    response = client.post(
        f"/api/sessions/{session_id}/emg-calibration", json=payload(**changes), headers=patient_headers
    )
    assert response.status_code == 422, changes


def test_the_simulated_sensor_does_not_need_the_battery_answer(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    body = payload(source="simulated", battery_ok=False, firmware_version="sim-1.0.0")
    response = client.post(f"/api/sessions/{session_id}/emg-calibration", json=body, headers=patient_headers)
    assert response.status_code == 201, response.text


def test_only_the_patients_own_active_session(
    client: TestClient,
    patient_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    session_id = start(client, patient_headers)
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    url = f"/api/sessions/{session_id}/emg-calibration"
    assert client.post(url, json=payload(), headers=other).status_code == 404
    assert client.post("/api/sessions/999999/emg-calibration", json=payload(), headers=patient_headers).status_code == 404
    assert client.post(url, json=payload()).status_code == 401
    ended = client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers)
    assert ended.status_code == 200
    assert client.post(url, json=payload(), headers=patient_headers).status_code == 409


def test_the_latest_calibration_and_the_admin_list(
    client: TestClient,
    patient_headers: Headers,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    assert client.get("/api/patient/emg-calibration/latest", headers=patient_headers).status_code == 404
    first = start(client, patient_headers)
    client.post(f"/api/sessions/{first}/emg-calibration", json=payload(mvc_mv=1500.0), headers=patient_headers)
    client.post(f"/api/sessions/{first}/end", json={"status": "completed"}, headers=patient_headers)
    second = start(client, patient_headers)
    client.post(f"/api/sessions/{second}/emg-calibration", json=payload(site="extensors"), headers=patient_headers)

    latest = client.get("/api/patient/emg-calibration/latest", headers=patient_headers).json()
    assert latest["session_id"] == second and latest["site"] == "extensors"

    me = client.get("/api/auth/me", headers=patient_headers).json()
    patient_id = me["patient_profile"]["id"]
    listed = client.get(f"/api/admin/patients/{patient_id}/emg-calibrations", headers=admin_headers).json()
    assert [item["session_id"] for item in listed] == [second, first]
    assert client.get(f"/api/admin/patients/{patient_id}/emg-calibrations", headers=patient_headers).status_code == 403
    assert client.get("/api/admin/patients/999/emg-calibrations", headers=admin_headers).status_code == 404
    # Another patient has none of their own.
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    assert client.get("/api/patient/emg-calibration/latest", headers=other).status_code == 404


def test_device_info_keeps_the_sensor_when_the_camera_reports(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = start(client, patient_headers)
    url = f"/api/sessions/{session_id}/device-info"
    emg = {"connected": True, "source": "serial", "site": "flexors", "firmware_version": "1.0.0"}
    assert client.patch(url, json={"emg": emg}, headers=patient_headers).status_code == 200
    body = client.patch(url, json={"fps": 29.5, "delegate": "GPU"}, headers=patient_headers).json()
    assert body["device_info"]["emg"] == emg
    assert body["device_info"]["fps"] == 29.5
    bad = client.patch(url, json={"emg": {"connected": True, "site": "calf"}}, headers=patient_headers)
    assert bad.status_code == 422


def test_the_emg_step_can_be_saved_and_resumed(client: TestClient, patient_headers: Headers) -> None:
    session_id = start(client, patient_headers)
    response = client.patch(
        f"/api/sessions/{session_id}/progress", json={"current_step": "emg"}, headers=patient_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["current_step"] == "emg"
