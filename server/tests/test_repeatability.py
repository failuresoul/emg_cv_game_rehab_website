"""Repeatability visits (Day 19): the admin marks the next session as visit 1-3; that session
carries it; the admin exports its measures as visit, metric_id, value."""

from collections.abc import Callable
from typing import Any

from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient

from scripts.smoke_test import calibration_payload, warmup_payload


def test_the_next_session_is_the_planned_visit_and_only_that_one(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient(email="repeat@example.com")
    headers = login("repeat@example.com", PATIENT_PASSWORD)
    planned = client.post(f"/api/admin/patients/{patient['id']}/repeatability-visit", json={"visit": 2}, headers=admin_headers)
    assert planned.status_code == 200
    assert planned.json()["repeatability_next_visit"] == 2

    first = client.post("/api/sessions", headers=headers)
    assert first.status_code == 201
    assert first.json()["repeatability_visit"] == 2
    detail = client.get(f"/api/admin/patients/{patient['id']}", headers=admin_headers).json()
    assert detail["repeatability_next_visit"] is None

    client.post(f"/api/sessions/{first.json()['id']}/end", json={"status": "completed"}, headers=headers)
    second = client.post("/api/sessions", headers=headers)
    assert second.json()["repeatability_visit"] is None


def test_a_planned_visit_can_be_cancelled_and_values_are_checked(
    client: TestClient, admin_headers: Headers, create_patient: Callable[..., dict[str, Any]]
) -> None:
    patient = create_patient(email="cancel@example.com")
    url = f"/api/admin/patients/{patient['id']}/repeatability-visit"
    assert client.post(url, json={"visit": 1}, headers=admin_headers).json()["repeatability_next_visit"] == 1
    assert client.post(url, json={"visit": None}, headers=admin_headers).json()["repeatability_next_visit"] is None
    for bad in (0, 4, "1", 1.5):
        assert client.post(url, json={"visit": bad}, headers=admin_headers).status_code == 422
    assert client.post("/api/admin/patients/9999/repeatability-visit", json={"visit": 1}, headers=admin_headers).status_code == 404


def test_the_export_has_each_completed_visits_measures(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient(email="export@example.com", affected_side="left")
    headers = login("export@example.com", PATIENT_PASSWORD)
    for visit in (1, 2):
        client.post(f"/api/admin/patients/{patient['id']}/repeatability-visit", json={"visit": visit}, headers=admin_headers)
        session_id = client.post("/api/sessions", headers=headers).json()["id"]
        client.post(f"/api/sessions/{session_id}/calibration", json=calibration_payload("left"), headers=headers)
        assert client.post(f"/api/sessions/{session_id}/warmup", json=warmup_payload(), headers=headers).status_code in (200, 201)
        client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=headers)
    # An ordinary session's measures are left out.
    other = client.post("/api/sessions", headers=headers).json()["id"]
    client.post(f"/api/sessions/{other}/warmup", json=warmup_payload(), headers=headers)
    client.post(f"/api/sessions/{other}/end", json={"status": "completed"}, headers=headers)

    response = client.get(f"/api/admin/patients/{patient['id']}/repeatability.csv", headers=admin_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.strip().splitlines()
    assert lines[0] == "visit,metric_id,value"
    visits = {line.split(",")[0] for line in lines[1:]}
    assert visits == {"1", "2"}
    assert len(lines) > 3
    patient_headers = login("export@example.com", PATIENT_PASSWORD)
    assert client.get(f"/api/admin/patients/{patient['id']}/repeatability.csv", headers=patient_headers).status_code == 403
