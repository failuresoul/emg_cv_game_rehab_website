from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User
from app.services.users import ensure_admin


def test_login_success_returns_token_and_updates_last_login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        data={"username": "ADMIN@motionlab.local", "password": "test-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "admin@motionlab.local"
    assert body["user"]["role"] == "admin"
    assert body["user"]["last_login_at"] is not None

    claims = jwt.decode(body["access_token"], settings.JWT_SECRET, algorithms=["HS256"])
    assert claims["sub"] == str(body["user"]["id"])
    assert claims["role"] == "admin"
    assert "exp" in claims


def test_login_wrong_password_is_401(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        data={"username": "admin@motionlab.local", "password": "wrong-password"},
    )
    assert response.status_code == 401


def test_login_unknown_email_is_401(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        data={"username": "nobody@example.com", "password": "test-password"},
    )
    assert response.status_code == 401


def test_login_missing_fields_is_422(client: TestClient) -> None:
    assert client.post("/api/auth/login", data={}).status_code == 422


def test_me_as_admin_has_no_profile(client: TestClient, admin_headers: Headers) -> None:
    response = client.get("/api/auth/me", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert response.json()["patient_profile"] is None


def test_me_as_patient_includes_profile(client: TestClient, patient_headers: Headers) -> None:
    response = client.get("/api/auth/me", headers=patient_headers)

    assert response.status_code == 200
    assert response.json()["role"] == "patient"
    assert response.json()["patient_profile"]["patient_code"] == "P001"


def test_me_without_token_is_401(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_invalid_token_is_401(client: TestClient) -> None:
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert response.status_code == 401


def test_me_with_expired_token_is_401(client: TestClient) -> None:
    token = jwt.encode(
        {"sub": "1", "role": "admin", "exp": datetime.now(UTC) - timedelta(minutes=1)},
        settings.JWT_SECRET,
        algorithm="HS256",
    )
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_me_with_token_signed_by_other_secret_is_401(client: TestClient) -> None:
    token = jwt.encode(
        {"sub": "1", "role": "admin", "exp": datetime.now(UTC) + timedelta(minutes=5)},
        "another-secret-another-secret-another-secret-another-secret-1234",
        algorithm="HS256",
    )
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_deactivated_user_cannot_log_in_and_token_stops_working(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient()
    patient_headers = login("alice@example.com", PATIENT_PASSWORD)

    client.post(f"/api/admin/patients/{patient['id']}/deactivate", headers=admin_headers)

    response = client.post(
        "/api/auth/login",
        data={"username": "alice@example.com", "password": PATIENT_PASSWORD},
    )
    assert response.status_code == 401
    assert client.get("/api/auth/me", headers=patient_headers).status_code == 401


def test_ensure_admin_creates_only_one_admin(session: Session) -> None:
    ensure_admin(session)
    ensure_admin(session)

    admins = session.exec(select(User).where(User.role == "admin")).all()
    assert len(admins) == 1
    assert admins[0].email == "admin@motionlab.local"
