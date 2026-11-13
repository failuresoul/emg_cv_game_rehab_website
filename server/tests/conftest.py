import os
from collections.abc import Callable, Generator
from typing import Any

# Set before importing the app so tests never use server/.env or the real database.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-test-secret-test-secret-1234"
os.environ["ADMIN_EMAIL"] = "admin@motionlab.local"
os.environ["ADMIN_PASSWORD"] = "test-password"
os.environ["ADMIN_NAME"] = "Test Admin"
# Tests never call a real model.
os.environ["LLM_PROVIDER"] = "mock"

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.db import get_session
from app.feedback.jobs import report_jobs
from app.main import app
from app.services.users import ensure_admin

PATIENT_PASSWORD = "patient-password"

Headers = dict[str, str]


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unit tests never reach a real Ollama: any real HTTP request to it fails the test.
    (TestClient and httpx.MockTransport do not use HTTPTransport, so they are unaffected.)"""
    real = httpx.HTTPTransport.handle_request

    def guarded(self: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
        if request.url.port == 11434 or "/api/chat" in request.url.path:
            raise RuntimeError(f"A test tried to call a real model: {request.url}")
        return real(self, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", guarded)


@pytest.fixture
def session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        ensure_admin(session)
        yield session
    engine.dispose()


@pytest.fixture
def client(session: Session) -> Generator[TestClient, None, None]:
    def get_session_override() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_session] = get_session_override
    # Report jobs stay queued in the database: tests/test_feedback_api.py runs them.
    report_jobs.configure(engine=session.get_bind(), run_jobs=False)
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    report_jobs.configure()


@pytest.fixture
def login(client: TestClient) -> Callable[[str, str], Headers]:
    def _login(email: str, password: str) -> Headers:
        response = client.post("/api/auth/login", data={"username": email, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return _login


@pytest.fixture
def admin_headers(login: Callable[[str, str], Headers]) -> Headers:
    return login("admin@motionlab.local", "test-password")


@pytest.fixture
def create_patient(client: TestClient, admin_headers: Headers) -> Callable[..., dict[str, Any]]:
    def _create_patient(email: str = "alice@example.com", **overrides: Any) -> dict[str, Any]:
        payload = {
            "email": email,
            "full_name": "Alice Rahman",
            "password": PATIENT_PASSWORD,
            "affected_side": "left",
            "dominant_side": "right",
            "age_band": "60-69",
            **overrides,
        }
        response = client.post("/api/admin/patients", json=payload, headers=admin_headers)
        assert response.status_code == 201, response.text
        return response.json()

    return _create_patient


@pytest.fixture
def patient_headers(
    create_patient: Callable[..., dict[str, Any]], login: Callable[[str, str], Headers]
) -> Headers:
    create_patient(email="patient@example.com")
    return login("patient@example.com", PATIENT_PASSWORD)
