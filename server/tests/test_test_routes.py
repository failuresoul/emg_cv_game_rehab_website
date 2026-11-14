"""The end-to-end test helpers (app/api/testing.py) exist only with APP_ENV=test."""

import os
import subprocess
import sys
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, col, func, select

from app.api import auth, testing
from app.core.config import settings
from app.core.db import get_session
from app.main import app
from app.models import GameRun, PatientProfile, SessionMetric, User
from app.models import Session as SessionRecord

SERVER_DIR = Path(__file__).resolve().parents[1]
TEST_PATHS = ("/api/test/reset", "/api/test/seed-session")

#: Prints the app's /api/test routes for the APP_ENV given in the environment.
LIST_ROUTES = (
    "from app.main import app; "
    "print(sorted(p for p in app.openapi()['paths'] if p.startswith('/api/test')))"
)


def routes_with(app_env: str | None) -> str:
    env = {
        **os.environ,
        "DATABASE_URL": "sqlite://",
        "LLM_PROVIDER": "mock",
        "JWT_SECRET": "x" * 64,
        "ADMIN_EMAIL": "admin@motionlab.local",
        "ADMIN_PASSWORD": "test-password",
        "ADMIN_NAME": "Test Admin",
    }
    env.pop("APP_ENV", None)
    if app_env is not None:
        env["APP_ENV"] = app_env
    result = subprocess.run(
        [sys.executable, "-c", LIST_ROUTES],
        cwd=SERVER_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        stdin=subprocess.DEVNULL,
        check=True,
    )
    return result.stdout.strip().splitlines()[-1]


def test_the_test_routes_do_not_exist_in_this_app(client: TestClient) -> None:
    assert settings.APP_ENV != "test"
    paths = app.openapi()["paths"]
    assert not [path for path in paths if path.startswith("/api/test")]
    for path in TEST_PATHS:
        assert client.post(path, json={"patient_id": 1}).status_code == 404


@pytest.mark.parametrize("app_env", [None, "development", "production", "TEST", "testing"])
def test_the_test_routes_exist_only_with_app_env_test(app_env: str | None) -> None:
    assert routes_with(app_env) == "[]"


def test_app_env_test_adds_the_test_routes() -> None:
    assert routes_with("test") == str(sorted(TEST_PATHS))


@pytest.fixture
def test_client(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient, None, None]:
    """An app with the test routes, as APP_ENV=test builds it, on the test database."""
    monkeypatch.setattr(settings, "APP_ENV", "test")
    test_app = FastAPI()
    test_app.include_router(auth.router, prefix="/api")
    test_app.include_router(testing.router, prefix="/api")

    def get_session_override() -> Generator[Session, None, None]:
        yield session

    test_app.dependency_overrides[get_session] = get_session_override
    with TestClient(test_app) as client:
        yield client


def test_the_routes_refuse_if_mounted_without_app_env_test(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    assert test_client.post("/api/test/reset").status_code == 404
    assert test_client.post("/api/test/seed-session", json={"patient_id": 1}).status_code == 404


def test_reset_gives_a_fresh_database_with_the_admin_and_demo_patients(
    test_client: TestClient, session: Session
) -> None:
    session.add(User(email="left.over@example.com", full_name="Left over", role="patient",
                     hashed_password="x"))
    session.commit()

    response = test_client.post("/api/test/reset")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["admin_email"] == settings.ADMIN_EMAIL
    assert [p["email"] for p in body["patients"]] == [
        "demo.rahim@example.com",
        "demo.salma@example.com",
    ]
    assert session.exec(select(User).where(User.email == "left.over@example.com")).first() is None
    assert session.exec(select(func.count()).select_from(SessionRecord)).one() == 14

    for patient in body["patients"]:
        assert patient["password"] == testing.DEFAULT_PATIENT_PASSWORD
        login = test_client.post(
            "/api/auth/login", data={"username": patient["email"], "password": patient["password"]}
        )
        assert login.status_code == 200, login.text
    admin = test_client.post(
        "/api/auth/login",
        data={"username": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD},
    )
    assert admin.status_code == 200


def test_reset_without_demo_patients_keeps_only_the_admin(
    test_client: TestClient, session: Session
) -> None:
    response = test_client.post("/api/test/reset", json={"demo_patients": False})
    assert response.status_code == 200
    assert response.json()["patients"] == []
    users = session.exec(select(User)).all()
    assert [user.role for user in users] == ["admin"]


def test_seed_session_adds_a_completed_session_with_data(
    test_client: TestClient, session: Session
) -> None:
    patient = test_client.post("/api/test/reset").json()["patients"][0]
    patient_id = patient["patient_id"]
    count_before = session.exec(
        select(func.count()).select_from(SessionRecord).where(SessionRecord.patient_id == patient_id)
    ).one()

    response = test_client.post(
        "/api/test/seed-session", json={"patient_id": patient_id, "progress": 1, "pain": True}
    )
    assert response.status_code == 201, response.text
    session_id = response.json()["session_id"]
    record = session.get(SessionRecord, session_id)
    assert record is not None
    assert record.patient_id == patient_id and record.status == "completed"
    assert record.ended_at is not None and record.plan is not None
    assert record.needs_review
    runs = session.exec(select(GameRun).where(GameRun.session_id == session_id)).all()
    assert runs and all(run.status == "completed" for run in runs)
    metrics = session.exec(
        select(func.count()).select_from(SessionMetric).where(col(SessionMetric.session_id) == session_id)
    ).one()
    assert metrics > 0
    count_after = session.exec(
        select(func.count()).select_from(SessionRecord).where(SessionRecord.patient_id == patient_id)
    ).one()
    assert count_after == count_before + 1


def test_seed_session_for_an_unknown_patient_is_404(test_client: TestClient, session: Session) -> None:
    test_client.post("/api/test/reset", json={"demo_patients": False})
    assert session.exec(select(PatientProfile)).first() is None
    response = test_client.post("/api/test/seed-session", json={"patient_id": 999})
    assert response.status_code == 404
