"""End-to-end check of a running server, with one PASS or FAIL line per step.

Start the server first, then run from server/ with the virtual environment active:

    python scripts/smoke_test.py [base_url]

The default base_url is http://localhost:8000. The admin login comes from server/.env. Each run
adds one test patient and one session to the database, and deactivates the patient at the end.
The exit code is 0 if every step passes and 1 otherwise.
"""

import secrets
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

DEFAULT_BASE_URL = "http://localhost:8000"
DIRECTIONS_DEG = [0, 45, 90, 135, 180, 225, 270, 315]


class StepFailed(Exception):
    pass


class HttpClient(Protocol):
    """Met by httpx.Client and by FastAPI's TestClient."""

    def get(self, url: str, **kwargs: Any) -> httpx.Response: ...

    def post(self, url: str, **kwargs: Any) -> httpx.Response: ...


def expect(response: httpx.Response, status: int) -> Any:
    if response.status_code != status:
        raise StepFailed(f"expected HTTP {status}, got {response.status_code}")
    return response.json()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StepFailed(message)


def calibration_payload(affected_side: str) -> dict[str, Any]:
    return {
        "affected_side": affected_side,
        "shoulder_width_px": 160.0,
        "directions_deg": DIRECTIONS_DEG,
        "reach_radii_sw": [1.0] * 8,
        "reach_points_sw": [
            [1.0, 0.0],
            [0.7, 0.7],
            [0.0, 1.0],
            [-0.7, 0.7],
            [-1.0, 0.0],
            [-0.7, -0.7],
            [0.0, -1.0],
            [0.7, -0.7],
        ],
        "hull_sw": [[1.0, 0.0], [0.0, 1.0], [-1.0, 0.0], [0.0, -1.0]],
        "hull_area_sw2": 2.0,
        "quality": {"valid": [True] * 8, "retries": 0, "max_trunk_displacement_sw": 0.05},
    }


def run_smoke(client: HttpClient, admin_email: str, admin_password: str) -> bool:
    """Runs the steps in order and stops at the first failure, as each builds on the last."""
    email = f"smoke-{secrets.token_hex(6)}@example.com"
    password = secrets.token_urlsafe(16)
    side = "left"
    state: dict[str, Any] = {}

    def bearer(token_name: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {state[token_name]}"}

    def health() -> None:
        require(expect(client.get("/api/health"), 200)["status"] == "ok", "status is not ok")

    def admin_login() -> None:
        form = {"username": admin_email, "password": admin_password}
        body = expect(client.post("/api/auth/login", data=form), 200)
        require(body["user"]["role"] == "admin", "user is not an admin")
        state["admin"] = body["access_token"]

    def create_patient() -> None:
        payload = {
            "email": email,
            "full_name": "Smoke Test",
            "password": password,
            "affected_side": side,
            "dominant_side": "right",
            "age_band": "60-69",
            "notes": "Created by smoke_test.py",
        }
        body = expect(client.post("/api/admin/patients", json=payload, headers=bearer("admin")), 201)
        state["patient_id"] = body["id"]

    def patient_login() -> None:
        form = {"username": email, "password": password}
        state["patient"] = expect(client.post("/api/auth/login", data=form), 200)["access_token"]

    def patient_blocked_from_admin() -> None:
        expect_status = client.get("/api/admin/stats", headers=bearer("patient")).status_code
        require(expect_status == 403, f"expected HTTP 403, got {expect_status}")

    def start_session() -> None:
        body = expect(client.post("/api/sessions", headers=bearer("patient")), 201)
        require(body["status"] == "active", "session is not active")
        state["session_id"] = body["id"]

    def save_calibration() -> None:
        url = f"/api/sessions/{state['session_id']}/calibration"
        payload = calibration_payload(side)
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(body["session_id"] == state["session_id"], "saved to the wrong session")

    def latest_calibration() -> None:
        body = expect(client.get("/api/patient/calibration/latest", headers=bearer("patient")), 200)
        require(body["session_id"] == state["session_id"], "latest is from another session")
        require(body["hull_area_sw2"] == 2.0, "hull area differs from what was saved")

    def end_session() -> None:
        url = f"/api/sessions/{state['session_id']}/end"
        body = expect(client.post(url, json={"status": "completed"}, headers=bearer("patient")), 200)
        require(body["status"] == "completed", "session is not completed")
        require(body["ended_at"] is not None, "ended_at is empty")

    def admin_lists_sessions() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/sessions"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(len(body) == 1 and body[0]["id"] == state["session_id"], "session is not listed")
        require(body[0]["hull_area_sw2"] == 2.0, "hull area is missing")

    def admin_lists_calibrations() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/calibrations"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(len(body) == 1, "calibration is not listed")
        require(body[0]["session_id"] == state["session_id"], "calibration is for another session")

    def deactivate_patient() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/deactivate"
        body = expect(client.post(url, headers=bearer("admin")), 200)
        require(body["user"]["is_active"] is False, "patient is still active")

    steps: list[tuple[str, Callable[[], None]]] = [
        ("Server is healthy", health),
        ("Admin logs in", admin_login),
        ("Admin creates a test patient", create_patient),
        ("Patient logs in", patient_login),
        ("Patient is blocked from admin routes", patient_blocked_from_admin),
        ("Patient starts a session", start_session),
        ("Patient saves a valid calibration", save_calibration),
        ("Patient gets the latest calibration", latest_calibration),
        ("Patient ends the session", end_session),
        ("Admin lists the patient's sessions", admin_lists_sessions),
        ("Admin lists the patient's calibrations", admin_lists_calibrations),
        ("Admin deactivates the test patient", deactivate_patient),
    ]

    for name, step in steps:
        try:
            step()
        except (StepFailed, httpx.HTTPError, KeyError, ValueError) as error:
            print(f"FAIL  {name}: {error}")
            return False
        print(f"PASS  {name}")
    return True


def main() -> int:
    from app.core.config import settings

    base_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE_URL
    with httpx.Client(base_url=base_url, timeout=15) as client:
        passed = run_smoke(client, settings.ADMIN_EMAIL, settings.ADMIN_PASSWORD)
    print("All steps passed" if passed else "Smoke test failed")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
