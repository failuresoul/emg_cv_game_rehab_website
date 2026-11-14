"""The patient's own settings (Day 17): language, which their reports follow, and Bengali digits."""

from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import PatientProfile

URL = "/api/patient/profile"


def test_a_patient_changes_their_own_language_and_digits(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    response = client.patch(URL, json={"language": "bn"}, headers=patient_headers)
    assert response.status_code == 200, response.text
    assert response.json()["language"] == "bn" and response.json()["bengali_digits"] is False
    response = client.patch(URL, json={"bengali_digits": True}, headers=patient_headers)
    assert response.json()["language"] == "bn" and response.json()["bengali_digits"] is True
    me = client.get("/api/auth/me", headers=patient_headers).json()
    assert me["patient_profile"]["language"] == "bn"
    assert me["patient_profile"]["bengali_digits"] is True
    # Reports are written in the profile's language.
    session.expire_all()
    assert session.exec(select(PatientProfile)).one().language == "bn"


def test_invalid_or_empty_changes_are_refused(client: TestClient, patient_headers: Headers) -> None:
    assert client.patch(URL, json={}, headers=patient_headers).status_code == 422
    assert client.patch(URL, json={"language": "fr"}, headers=patient_headers).status_code == 422
    assert client.patch(URL, json={"weekly_goal": 3}, headers=patient_headers).status_code == 422


def test_only_patients_change_their_own_profile(
    client: TestClient, admin_headers: Headers
) -> None:
    assert client.patch(URL, json={"language": "bn"}, headers=admin_headers).status_code == 403
    assert client.patch(URL, json={"language": "bn"}).status_code == 401
