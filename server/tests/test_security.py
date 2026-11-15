"""Day 18 security and robustness review: tokens, access to other people's data, passwords,
login limits, hostile input on every write route, request limits, headers, CORS and safe
error answers. Routes are read from the app's own OpenAPI list, so a new route is covered
without editing this file."""

import base64
import json
import re
from collections.abc import Callable, Generator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

from app.core import hardening
from app.core.config import settings
from app.core.security import ALGORITHM, create_access_token
from app.main import app
from app.models import User
from app.services.login_limits import LoginLimiter
from scripts.smoke_test import (
    PARAMS,
    calibration_payload,
    emg_calibration_payload,
    game_summary,
    trial_payload,
    warmup_payload,
)

OPENAPI = app.openapi()


def operations() -> list[tuple[str, str, dict[str, Any]]]:
    found = []
    for path, items in OPENAPI["paths"].items():
        for method, operation in items.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                found.append((method.upper(), path, operation))
    return sorted(found, key=lambda item: (item[1], item[0]))


# ---------------------------------------------------------------------------------------------
# Tokens


def _b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def tokens_that_must_fail(user_id: int) -> dict[str, str]:
    good = create_access_token(user_id, "patient")
    header, payload, signature = good.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    future = int((datetime.now(UTC) + timedelta(hours=1)).timestamp())
    secret = settings.JWT_SECRET
    return {
        # The payload changed (to the admin's id and role) without signing it again.
        "tampered payload": f"{header}.{_b64({**claims, 'sub': '1', 'role': 'admin'})}.{signature}",
        "no signature": f"{header}.{payload}.",
        "alg none": f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{payload}.",
        "expired": jwt.encode({"sub": str(user_id), "exp": datetime.now(UTC) - timedelta(seconds=1)}, secret, algorithm=ALGORITHM),
        "no expiry": jwt.encode({"sub": str(user_id)}, secret, algorithm=ALGORITHM),
        "no subject": jwt.encode({"exp": future}, secret, algorithm=ALGORITHM),
        "not a number subject": jwt.encode({"sub": "admin", "exp": future}, secret, algorithm=ALGORITHM),
        "unknown user": jwt.encode({"sub": "999999", "exp": future}, secret, algorithm=ALGORITHM),
        "other algorithm": jwt.encode({"sub": str(user_id), "exp": future}, secret, algorithm="HS512"),
        "other secret": jwt.encode({"sub": str(user_id), "exp": future}, "x" * 64, algorithm=ALGORITHM),
        "garbage": "not.a.token",
    }


def test_every_bad_token_is_refused(
    client: TestClient, create_patient: Callable[..., dict[str, Any]], session: Session
) -> None:
    create_patient(email="token@example.com")
    profile_user = session.exec(select(User).where(User.email == "token@example.com")).one()
    assert profile_user is not None and profile_user.id is not None
    for name, token in tokens_that_must_fail(profile_user.id).items():
        for path in ("/api/auth/me", "/api/admin/patients", "/api/patient/dashboard"):
            response = client.get(path, headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 401, (name, path, response.status_code)


# ---------------------------------------------------------------------------------------------
# Another patient's data: every write route with an id


@pytest.fixture
def victim(
    client: TestClient,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> dict[str, Any]:
    """Patient B's session, game run and report; patient A's login."""
    create_patient(email="attacker@example.com")
    create_patient(email="victim@example.com")
    attacker = login("attacker@example.com", PATIENT_PASSWORD)
    owner = login("victim@example.com", PATIENT_PASSWORD)
    session_id = client.post("/api/sessions", headers=owner).json()["id"]
    run = client.post(
        f"/api/sessions/{session_id}/games",
        json={"game_id": "reach_activate", "engine": "L1", "input_source": "keyboard",
              "params_initial": PARAMS["reach_activate"], "trials_planned": 5},
        headers=owner,
    ).json()
    report_session = client.post("/api/sessions", headers=owner).json()["id"]
    job = client.post(f"/api/sessions/{report_session}/feedback", json={"language": "en"}, headers=owner)
    return {
        "attacker": attacker,
        "owner": owner,
        "ids": {"session_id": session_id, "run_id": run["id"], "report_id": job.json()["job_id"]},
    }


def valid_body(method: str, path: str) -> Any:
    trials = [trial_payload("reach_activate", 1)]
    bodies: dict[str, Any] = {
        "POST /api/feedback/{report_id}/ratings": {"rater": "participant", "scores": {"usefulness": 4}},
        "POST /api/games/{run_id}/end": {"status": "completed", "score": 1, "summary": game_summary("reach_activate", trials)},
        "POST /api/games/{run_id}/trials": trials,
        "POST /api/sessions/{session_id}/calibration": calibration_payload("left"),
        "PATCH /api/sessions/{session_id}/device-info": {"browser": "Chrome", "fps": 30, "delegate": "GPU"},
        "POST /api/sessions/{session_id}/emg-calibration": emg_calibration_payload(battery_ok=True),
        "POST /api/sessions/{session_id}/end": {"status": "completed"},
        "POST /api/sessions/{session_id}/feedback": {"language": "en"},
        "POST /api/sessions/{session_id}/games": {"game_id": "reach_activate", "engine": "L1", "input_source": "keyboard", "params_initial": PARAMS["reach_activate"], "trials_planned": 5},
        "POST /api/sessions/{session_id}/plan/override": {"games": ["reach_activate", "bloom"]},
        "PATCH /api/sessions/{session_id}/progress": {"current_step": "warmup"},
        "POST /api/sessions/{session_id}/questionnaire": {"pain_0_10": 1, "fatigue_0_10": 3, "enjoyment_1_5": 5, "difficulty": "just_right", "new_symptoms": False},
        "POST /api/sessions/{session_id}/warmup": warmup_payload(),
    }
    return bodies[f"{method} {path}"]


OWNED_WRITES = [
    (method, path)
    for method, path, _ in operations()
    if method in {"POST", "PUT", "PATCH", "DELETE"}
    and not path.startswith("/api/admin")
    and not path.startswith("/api/test")
    and re.search(r"\{(session_id|run_id|report_id)\}", path)
]


def test_every_owned_write_route_has_a_body_here() -> None:
    assert len(OWNED_WRITES) >= 13
    for method, path in OWNED_WRITES:
        valid_body(method, path)  # a new route fails here until it is added


@pytest.mark.parametrize(("method", "path"), OWNED_WRITES)
def test_a_patient_never_changes_another_patients_data(
    client: TestClient, victim: dict[str, Any], method: str, path: str
) -> None:
    url = re.sub(r"\{([^}]+)\}", lambda match: str(victim["ids"][match.group(1)]), path)
    body = valid_body(method, path)
    refused = client.request(method, url, json=body, headers=victim["attacker"])
    assert refused.status_code in (403, 404), (path, refused.status_code, refused.text[:200])
    # The same request from the owner is accepted (so the refusal was the ownership check),
    # except a rating of a report that is not finished yet.
    allowed = client.request(method, url, json=body, headers=victim["owner"])
    if "ratings" in path:
        assert allowed.status_code in (201, 409), allowed.text[:200]
    else:
        assert allowed.status_code < 300, (path, allowed.status_code, allowed.text[:300])


# ---------------------------------------------------------------------------------------------
# Passwords and the login limit


@pytest.mark.parametrize("password", ["", "short", "1234567", "x" * 129])
def test_weak_or_oversized_passwords_are_refused(client: TestClient, admin_headers: Headers, password: str) -> None:
    body = {"email": "weak@example.com", "full_name": "Weak", "password": password, "affected_side": "left",
            "dominant_side": "right", "age_band": "60-69"}
    assert client.post("/api/admin/patients", json=body, headers=admin_headers).status_code == 422
    assert client.post("/api/auth/register", json=body).status_code == 422


def test_passwords_are_never_stored_or_returned_in_plain_text(
    client: TestClient, create_patient: Callable[..., dict[str, Any]], session: Session
) -> None:
    created = create_patient(email="plain@example.com")
    assert PATIENT_PASSWORD not in json.dumps(created)
    user = session.exec(select(User).where(User.email == "plain@example.com")).one()
    assert PATIENT_PASSWORD not in user.hashed_password
    assert user.hashed_password.startswith("$argon2")


def test_five_failed_logins_lock_that_email_for_a_while(
    client: TestClient, create_patient: Callable[..., dict[str, Any]]
) -> None:
    create_patient(email="limit@example.com")
    create_patient(email="other@example.com")
    for _ in range(5):
        wrong = client.post("/api/auth/login", data={"username": "limit@example.com", "password": "wrong-password"})
        assert wrong.status_code == 401
    locked = client.post("/api/auth/login", data={"username": "Limit@Example.com", "password": PATIENT_PASSWORD})
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0
    assert "Too many" in locked.json()["detail"]
    # Another email is not affected.
    assert client.post("/api/auth/login", data={"username": "other@example.com", "password": PATIENT_PASSWORD}).status_code == 200


def test_a_successful_login_clears_the_count(
    client: TestClient, create_patient: Callable[..., dict[str, Any]]
) -> None:
    create_patient(email="clear@example.com")
    for _ in range(4):
        client.post("/api/auth/login", data={"username": "clear@example.com", "password": "wrong-password"})
    assert client.post("/api/auth/login", data={"username": "clear@example.com", "password": PATIENT_PASSWORD}).status_code == 200
    for _ in range(4):
        client.post("/api/auth/login", data={"username": "clear@example.com", "password": "wrong-password"})
    assert client.post("/api/auth/login", data={"username": "clear@example.com", "password": PATIENT_PASSWORD}).status_code == 200


def test_the_limit_ends_15_minutes_after_the_oldest_failure() -> None:
    now = [1000.0]
    limiter = LoginLimiter(clock=lambda: now[0])
    for _ in range(5):
        limiter.failed("a@example.com")
        now[0] += 60
    assert limiter.retry_after("a@example.com") == 15 * 60 - 5 * 60
    now[0] = 1000.0 + 15 * 60  # the first failure is now 15 minutes old
    assert limiter.retry_after("a@example.com") is None


# ---------------------------------------------------------------------------------------------
# Hostile input on every write route


def resolve(schema: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        schema = OPENAPI["components"]["schemas"][schema["$ref"].split("/")[-1]]
    return schema


def json_body_schema(operation: dict[str, Any]) -> dict[str, Any] | None:
    content = operation.get("requestBody", {}).get("content", {})
    if "application/json" not in content:
        return None
    return resolve(content["application/json"]["schema"])


HOSTILE: dict[str, Any] = {
    "oversized text": "x" * 200_000,
    "negative": -1e12,
    "huge": 1e308,
    "wrong type (object)": {"nested": [1, 2, 3]},
    "wrong type (list)": [[[]]],
    "null": None,
}

WRITE_ROUTES = [
    (method, path)
    for method, path, operation in operations()
    if method in {"POST", "PUT", "PATCH"} and json_body_schema(operation) is not None
]


@pytest.fixture
def ids_and_logins(
    client: TestClient,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
    admin_headers: Headers,
) -> dict[str, Any]:
    patient = create_patient(email="fuzz@example.com")
    headers = login("fuzz@example.com", PATIENT_PASSWORD)
    session_id = client.post("/api/sessions", headers=headers).json()["id"]
    run = client.post(
        f"/api/sessions/{session_id}/games",
        json={"game_id": "reach_activate", "engine": "L1", "input_source": "keyboard",
              "params_initial": PARAMS["reach_activate"], "trials_planned": 5},
        headers=headers,
    ).json()
    return {"admin": admin_headers, "patient": headers, "session_id": session_id, "run_id": run["id"],
            "patient_id": patient["id"], "id": patient["id"]}


def mutants(schema: dict[str, Any]) -> list[tuple[str, Any]]:
    """Bodies with one field (or the whole body) replaced by a hostile value."""
    found: list[tuple[str, Any]] = [("empty body", {}), ("a list", []), ("a string", "x")]
    properties = schema.get("properties", {})
    for name in properties:
        for label, value in HOSTILE.items():
            found.append((f"{name}: {label}", {name: value}))
    if schema.get("type") == "array":
        found.append(("too many items", [{}] * 1000))
    return found


@pytest.mark.parametrize(("method", "path"), WRITE_ROUTES)
def test_hostile_bodies_get_a_clear_answer_never_a_crash(
    client: TestClient, ids_and_logins: dict[str, Any], method: str, path: str
) -> None:
    headers = ids_and_logins["admin"] if path.startswith("/api/admin") else ids_and_logins["patient"]
    url = re.sub(r"\{([^}]+)\}", lambda match: str(ids_and_logins.get(match.group(1), 1)), path)
    operation = OPENAPI["paths"][path][method.lower()]
    schema = json_body_schema(operation)
    assert schema is not None
    for label, body in mutants(schema):
        response = client.request(method, url, json=body, headers=headers)
        assert response.status_code < 500, (path, label, response.status_code, response.text[:200])
        if response.status_code == 422:
            detail = response.json()["detail"]
            assert detail, (path, label)
            if isinstance(detail, list):
                assert all({"loc", "msg", "type"} <= set(item) for item in detail), (path, label)
                # The rejected input is not echoed back (it may be a password or 200 kB).
                assert "x" * 100 not in response.text


def test_nan_and_infinity_are_refused_with_422(client: TestClient, ids_and_logins: dict[str, Any]) -> None:
    url = f"/api/sessions/{ids_and_logins['session_id']}/device-info"
    for raw in (b'{"fps": NaN}', b'{"fps": Infinity}', b'{"fps": -Infinity}'):
        response = client.patch(url, content=raw, headers={**ids_and_logins["patient"], "Content-Type": "application/json"})
        assert response.status_code == 422, raw


def test_the_trajectory_cap_holds(client: TestClient, ids_and_logins: dict[str, Any]) -> None:
    trial = trial_payload("reach_activate", 1)
    trial["trajectory"] = [[i, 0.1, 0.1] for i in range(2001)]
    response = client.post(f"/api/games/{ids_and_logins['run_id']}/trials", json=[trial], headers=ids_and_logins["patient"])
    assert response.status_code == 422


def test_deeply_nested_json_is_refused_before_parsing(client: TestClient, ids_and_logins: dict[str, Any]) -> None:
    deep = "[" * 100_000 + "]" * 100_000
    response = client.post(
        f"/api/sessions/{ids_and_logins['session_id']}/warmup",
        content=deep,
        headers={**ids_and_logins["patient"], "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "nested" in response.json()["detail"]


def test_bodies_over_8_mb_are_refused(client: TestClient, ids_and_logins: dict[str, Any]) -> None:
    big = b'{"browser": "' + b"x" * (hardening.MAX_BODY_BYTES + 10) + b'"}'
    response = client.patch(
        f"/api/sessions/{ids_and_logins['session_id']}/device-info",
        content=big,
        headers={**ids_and_logins["patient"], "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_json_depth_counts_only_outside_strings() -> None:
    assert hardening.json_depth(b'{"a": [1, {"b": "[[[[{{{{"}]}') == 3
    assert hardening.json_depth(b'"\\"[[["') == 0
    assert hardening.json_depth(b"[]") == 1


def test_the_largest_real_body_passes_the_guard(client: TestClient, ids_and_logins: dict[str, Any]) -> None:
    """50 trials with 2,000 trajectory points each: under the size and depth limits."""
    trials = []
    for n in range(1, 51):
        trial = trial_payload("reach_activate", n)
        trial["trajectory"] = [[i * 10, 0.1, 0.2] for i in range(2000)]
        trials.append(trial)
    body = json.dumps(trials).encode()
    assert len(body) < hardening.MAX_BODY_BYTES
    assert hardening.json_depth(body) < hardening.MAX_JSON_DEPTH


# ---------------------------------------------------------------------------------------------
# Headers, CORS, error answers


def test_security_headers_on_every_answer(client: TestClient) -> None:
    for response in (client.get("/api/health"), client.get("/api/auth/me"), client.get("/api/nope")):
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Cache-Control"] == "no-store"


def test_cors_answers_only_the_allowed_origins(client: TestClient) -> None:
    allowed = settings.cors_origins_list[0]
    ok = client.options("/api/auth/me", headers={"Origin": allowed, "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == allowed
    for origin in ("https://evil.example.com", "null", "http://localhost:5173.evil.com"):
        refused = client.options("/api/auth/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert "access-control-allow-origin" not in refused.headers, origin
        plain = client.get("/api/health", headers={"Origin": origin})
        assert "access-control-allow-origin" not in plain.headers, origin


@pytest.fixture
def failing_client() -> Generator[TestClient, None, None]:
    """An app with the server's error handling and two routes that fail."""
    test_app = FastAPI()
    hardening.install(test_app)

    @test_app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret detail: /home/user/db password=hunter2")

    @test_app.get("/locked")
    def locked() -> None:
        raise OperationalError("UPDATE session", {}, Exception("database is locked"))

    with TestClient(test_app, raise_server_exceptions=False) as client:
        yield client


def test_unexpected_errors_answer_a_safe_message(failing_client: TestClient) -> None:
    response = failing_client.get("/boom")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "hunter2" not in response.text and "Traceback" not in response.text


def test_a_locked_database_answers_503_with_retry_after(failing_client: TestClient) -> None:
    response = failing_client.get("/locked")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert "busy" in response.json()["detail"]


def test_file_databases_wait_for_each_other_instead_of_failing(tmp_path: Any) -> None:
    from sqlalchemy import text

    from app.core.db import SQLITE_BUSY_TIMEOUT_S, _create_engine

    engine = _create_engine(f"sqlite:///{(tmp_path / 'locked.db').as_posix()}")
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == SQLITE_BUSY_TIMEOUT_S * 1000
    engine.dispose()
