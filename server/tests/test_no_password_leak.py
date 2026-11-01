from collections.abc import Callable
from typing import Any

from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient


def test_no_response_contains_a_password_or_hash(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient()
    base = f"/api/admin/patients/{patient['id']}"
    patient_headers = login("alice@example.com", PATIENT_PASSWORD)
    new_patient = {
        "email": "second@example.com",
        "full_name": "Second",
        "password": PATIENT_PASSWORD,
        "affected_side": "right",
        "dominant_side": "right",
        "age_band": "18-29",
    }

    responses = [
        client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": PATIENT_PASSWORD},
        ),
        client.get("/api/auth/me", headers=admin_headers),
        client.get("/api/auth/me", headers=patient_headers),
        client.post("/api/admin/patients", json=new_patient, headers=admin_headers),
        client.get("/api/admin/patients", headers=admin_headers),
        client.get(base, headers=admin_headers),
        client.patch(base, json={"password": PATIENT_PASSWORD}, headers=admin_headers),
        client.post(f"{base}/deactivate", headers=admin_headers),
        client.post(f"{base}/activate", headers=admin_headers),
        client.get("/api/admin/stats", headers=admin_headers),
        client.get("/api/patient/dashboard", headers=patient_headers),
    ]

    for response in responses:
        assert response.status_code < 300, response.text
        assert "hashed_password" not in response.text
        assert "$argon2" not in response.text
        assert PATIENT_PASSWORD not in response.text
