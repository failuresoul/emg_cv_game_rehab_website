from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.models import PatientProfile, User

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]

VALID_PAYLOAD = {
    "email": "new@example.com",
    "full_name": "New Patient",
    "password": PATIENT_PASSWORD,
    "affected_side": "left",
    "dominant_side": "right",
    "age_band": "70+",
}


def test_create_patient(create_patient: CreatePatient) -> None:
    patient = create_patient(email="Alice@Example.com", months_since_stroke=6, notes="Note")

    assert patient["patient_code"] == "P001"
    assert patient["language"] == "en"
    assert patient["months_since_stroke"] == 6
    assert patient["notes"] == "Note"
    assert patient["user"]["email"] == "alice@example.com"
    assert patient["user"]["is_active"] is True


def test_patient_code_increments(create_patient: CreatePatient) -> None:
    codes = [create_patient(email=f"p{i}@example.com")["patient_code"] for i in range(3)]
    assert codes == ["P001", "P002", "P003"]


def test_patient_code_increments_past_999(
    session: Session, client: TestClient, admin_headers: Headers
) -> None:
    for code in ("P999", "P1000"):
        user = User(
            email=f"{code}@example.com", full_name=code, role="patient", hashed_password="x"
        )
        session.add(user)
        session.flush()
        assert user.id is not None
        session.add(
            PatientProfile(
                user_id=user.id,
                patient_code=code,
                affected_side="left",
                dominant_side="left",
                age_band="70+",
            )
        )
    session.commit()

    response = client.post("/api/admin/patients", json=VALID_PAYLOAD, headers=admin_headers)
    assert response.json()["patient_code"] == "P1001"


def test_duplicate_email_is_409_and_case_insensitive(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    create_patient(email="alice@example.com")

    payload = {**VALID_PAYLOAD, "email": "ALICE@example.com"}
    response = client.post("/api/admin/patients", json=payload, headers=admin_headers)
    assert response.status_code == 409


def test_failed_create_leaves_no_user_behind(
    client: TestClient, admin_headers: Headers, session: Session
) -> None:
    payload = {**VALID_PAYLOAD, "age_band": "not-a-band"}
    assert client.post("/api/admin/patients", json=payload, headers=admin_headers).status_code == 422

    count = session.exec(select(func.count()).select_from(User)).one()
    assert count == 1  # Only the seeded admin.


@pytest.mark.parametrize(
    "change",
    [
        {"password": "short"},
        {"email": "not-an-email"},
        {"affected_side": "both"},
        {"age_band": "10-17"},
        {"language": "fr"},
        {"months_since_stroke": -1},
        {"full_name": "   "},
        {"role": "admin"},
    ],
)
def test_create_patient_invalid_input_is_422(
    client: TestClient, admin_headers: Headers, change: dict[str, Any]
) -> None:
    payload = {**VALID_PAYLOAD, **change}
    assert client.post("/api/admin/patients", json=payload, headers=admin_headers).status_code == 422


def test_list_patients(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    create_patient(email="a@example.com")
    create_patient(email="b@example.com")

    response = client.get("/api/admin/patients", headers=admin_headers)

    assert response.status_code == 200
    assert [p["patient_code"] for p in response.json()] == ["P001", "P002"]


@pytest.mark.parametrize(
    ("search", "expected"),
    [
        ("alice", ["P001"]),  # Name, case-insensitive.
        ("bob@", ["P002"]),  # Email.
        ("p002", ["P002"]),  # Code.
        ("example.com", ["P001", "P002"]),
        ("nobody", []),
        ("%", []),  # Wildcards are matched literally.
    ],
)
def test_search_patients(
    client: TestClient,
    admin_headers: Headers,
    create_patient: CreatePatient,
    search: str,
    expected: list[str],
) -> None:
    create_patient(email="a1@example.com", full_name="Alice Rahman")
    create_patient(email="bob@example.com", full_name="Bob Khan")

    response = client.get("/api/admin/patients", params={"search": search}, headers=admin_headers)

    assert [p["patient_code"] for p in response.json()] == expected


def test_get_patient(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    patient = create_patient()

    response = client.get(f"/api/admin/patients/{patient['id']}", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["patient_code"] == patient["patient_code"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/admin/patients/999"),
        ("PATCH", "/api/admin/patients/999"),
        ("POST", "/api/admin/patients/999/deactivate"),
        ("POST", "/api/admin/patients/999/activate"),
    ],
)
def test_unknown_patient_is_404(
    client: TestClient, admin_headers: Headers, method: str, path: str
) -> None:
    kwargs: dict[str, Any] = {"json": {}} if method == "PATCH" else {}
    assert client.request(method, path, headers=admin_headers, **kwargs).status_code == 404


def test_update_patient(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    patient = create_patient(notes="Keep me")

    response = client.patch(
        f"/api/admin/patients/{patient['id']}",
        json={"full_name": "Renamed", "email": "NEW@example.com", "affected_side": "right"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["full_name"] == "Renamed"
    assert body["user"]["email"] == "new@example.com"
    assert body["affected_side"] == "right"
    assert body["notes"] == "Keep me"


def test_update_password_changes_login(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient, login: Login
) -> None:
    patient = create_patient()

    client.patch(
        f"/api/admin/patients/{patient['id']}",
        json={"password": "a-new-password"},
        headers=admin_headers,
    )

    login("alice@example.com", "a-new-password")
    response = client.post(
        "/api/auth/login",
        data={"username": "alice@example.com", "password": PATIENT_PASSWORD},
    )
    assert response.status_code == 401


def test_update_can_clear_nullable_field(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    patient = create_patient(notes="Remove me")

    response = client.patch(
        f"/api/admin/patients/{patient['id']}", json={"notes": None}, headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json()["notes"] is None


@pytest.mark.parametrize(
    "change",
    [{"full_name": None}, {"email": None}, {"affected_side": None}, {"password": "short"}],
)
def test_update_invalid_input_is_422(
    client: TestClient,
    admin_headers: Headers,
    create_patient: CreatePatient,
    change: dict[str, Any],
) -> None:
    patient = create_patient()

    response = client.patch(
        f"/api/admin/patients/{patient['id']}", json=change, headers=admin_headers
    )
    assert response.status_code == 422


def test_update_to_taken_email_is_409(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    create_patient(email="taken@example.com")
    patient = create_patient(email="other@example.com")

    response = client.patch(
        f"/api/admin/patients/{patient['id']}",
        json={"email": "taken@example.com"},
        headers=admin_headers,
    )
    assert response.status_code == 409


def test_update_to_own_email_is_allowed(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    patient = create_patient(email="same@example.com")

    response = client.patch(
        f"/api/admin/patients/{patient['id']}",
        json={"email": "same@example.com"},
        headers=admin_headers,
    )
    assert response.status_code == 200


def test_deactivate_and_activate(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient, login: Login
) -> None:
    patient = create_patient()
    base = f"/api/admin/patients/{patient['id']}"

    response = client.post(f"{base}/deactivate", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["user"]["is_active"] is False

    response = client.post(f"{base}/activate", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["user"]["is_active"] is True

    login("alice@example.com", PATIENT_PASSWORD)


def test_stats(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient
) -> None:
    create_patient(email="a@example.com")
    patient = create_patient(email="b@example.com")
    client.post(f"/api/admin/patients/{patient['id']}/deactivate", headers=admin_headers)

    response = client.get("/api/admin/stats", headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == {
        "total_patients": 2,
        "active_patients": 1,
        "sessions_today": 0,
        "open_alerts": 0,
    }


ADMIN_ROUTES = [
    ("GET", "/api/admin/patients"),
    ("POST", "/api/admin/patients"),
    ("GET", "/api/admin/patients/1"),
    ("PATCH", "/api/admin/patients/1"),
    ("POST", "/api/admin/patients/1/deactivate"),
    ("POST", "/api/admin/patients/1/activate"),
    ("GET", "/api/admin/stats"),
]


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
def test_patient_gets_403_on_admin_routes(
    client: TestClient, patient_headers: Headers, method: str, path: str
) -> None:
    assert client.request(method, path, headers=patient_headers).status_code == 403


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
def test_admin_routes_without_token_are_401(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path).status_code == 401
