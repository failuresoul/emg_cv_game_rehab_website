from typing import Any

import pytest
from fastapi.testclient import TestClient

VALID_PAYLOAD = {
    "email": "New.Patient@example.com",
    "full_name": "New Patient",
    "password": "patient-password",
    "affected_side": "right",
    "dominant_side": "right",
    "age_band": "50-59",
}


def test_register_creates_patient_and_logs_in(client: TestClient) -> None:
    response = client.post("/api/auth/register", json=VALID_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "new.patient@example.com"
    assert body["user"]["role"] == "patient"
    assert body["user"]["last_login_at"] is not None
    assert "hashed_password" not in response.text
    assert "patient-password" not in response.text

    headers = {"Authorization": f"Bearer {body['access_token']}"}
    dashboard = client.get("/api/patient/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert dashboard.json()["profile"]["patient_code"] == "P001"
    assert dashboard.json()["profile"]["language"] == "en"


def test_registered_patient_can_log_in_again(client: TestClient) -> None:
    client.post("/api/auth/register", json=VALID_PAYLOAD)

    response = client.post(
        "/api/auth/login",
        data={"username": "new.patient@example.com", "password": "patient-password"},
    )
    assert response.status_code == 200


def test_register_duplicate_email_is_409(client: TestClient) -> None:
    client.post("/api/auth/register", json=VALID_PAYLOAD)

    payload = {**VALID_PAYLOAD, "email": "NEW.PATIENT@example.com"}
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_validation_error_does_not_echo_the_password(client: TestClient) -> None:
    payload = {**VALID_PAYLOAD, "password": "secret7"}

    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "password"]
    assert "secret7" not in response.text


@pytest.mark.parametrize(
    "change",
    [
        {"role": "admin"},  # Nobody can sign up as an admin.
        {"notes": "Therapist field"},
        {"password": "short"},
        {"email": "not-an-email"},
        {"affected_side": "both"},
        {"age_band": "10-17"},
    ],
)
def test_register_invalid_input_is_422(client: TestClient, change: dict[str, Any]) -> None:
    payload = {**VALID_PAYLOAD, **change}
    assert client.post("/api/auth/register", json=payload).status_code == 422
