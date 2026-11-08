"""End-to-end check of a running server, with one PASS or FAIL line per step.

Start the server first, then run from server/ with the virtual environment active:

    python scripts/smoke_test.py [base_url]

The default base_url is http://localhost:8000. The admin login comes from server/.env. Each run
adds one test patient with one session (a calibration and six warm-up results) to the database,
and deactivates the patient at the end.
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
# Every warm-up exercise, with its unit, thresholds and target reps.
WARMUP_EXERCISES: list[tuple[str, str, float, float, int]] = [
    ("shoulder_flexion", "deg", 30, 90, 10),
    ("shoulder_abduction", "deg", 30, 80, 10),
    ("elbow_flexion", "deg", 70, 140, 10),
    ("forward_reach", "arm_ratio", 0.45, 0.8, 10),
    ("hand_open_close", "palm_ratio", 1.2, 1.6, 10),
    ("thumb_opposition", "palm_ratio", 0.25, 0.4, 5),
]


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


def warmup_payload() -> list[dict[str, Any]]:
    """Six results as the web app saves them: every target reached, 10% of reps compensated."""
    results = []
    for exercise_id, unit, low, high, target_reps in WARMUP_EXERCISES:
        hand = unit == "palm_ratio"
        results.append(
            {
                "exercise_id": exercise_id,
                "preset": "standard",
                "thresholds": {"low": low, "high": high, "unit": unit},
                "personalisation": {
                    "previous_high": None,
                    "new_high": low if exercise_id in ("elbow_flexion", "thumb_opposition") else high,
                    "reason": "first time: standard target",
                },
                "full_reps": target_reps,
                "partial_reps": 0,
                "target_reps": target_reps,
                "best_peak": high,
                "mean_duration_ms": 2500.0,
                "active_time_ms": 40000.0,
                "paused_time_ms": 0.0,
                "measure_source": "3d",
                "trunk_reference": "n/a" if hand else "hip",
                "compensated_reps": 1,
                "compensation_rate": 1 / target_reps,
                "reps": [
                    {
                        "index": 1,
                        "peak": high,
                        "duration_ms": 2500.0,
                        "compensated": True,
                        "compensation_type": "trunk",
                    }
                ],
                "skipped": False,
            }
        )
    return results


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

    def save_warmup() -> None:
        url = f"/api/sessions/{state['session_id']}/warmup"
        body = expect(client.post(url, json=warmup_payload(), headers=bearer("patient")), 200)
        require(len(body) == len(WARMUP_EXERCISES), f"saved {len(body)} results, not 6")

    def read_session_warmup() -> None:
        url = f"/api/sessions/{state['session_id']}/warmup"
        body = expect(client.get(url, headers=bearer("patient")), 200)
        saved = {item["exercise_id"] for item in body}
        require(saved == {exercise[0] for exercise in WARMUP_EXERCISES}, "an exercise is missing")

    def read_warmup_history() -> None:
        params = {"exercise_id": "thumb_opposition", "limit": 5}
        url = "/api/patient/warmup/history"
        body = expect(client.get(url, params=params, headers=bearer("patient")), 200)
        require(len(body) == 1, f"expected 1 result in the history, got {len(body)}")
        require(body[0]["session_id"] == state["session_id"], "history is from another session")
        require(body[0]["target_reps"] == 5, "thumb opposition does not have 5 target reps")

    def dashboard_last_warmup() -> None:
        body = expect(client.get("/api/patient/dashboard", headers=bearer("patient")), 200)
        last = body["last_warmup"]
        require(last is not None, "last_warmup is empty")
        require(last["session_id"] == state["session_id"], "last_warmup is another session")
        require(last["goals_reached"] == 6, f"expected 6 goals reached, got {last['goals_reached']}")

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
        summary = body[0]["warmup_summary"]
        require(summary is not None, "warm-up summary is missing")
        require(summary["exercises_total"] == 6, "warm-up summary does not count six exercises")

    def admin_lists_calibrations() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/calibrations"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(len(body) == 1, "calibration is not listed")
        require(body[0]["session_id"] == state["session_id"], "calibration is for another session")

    def admin_reads_warmup_history() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/warmup"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        exercises = {item["exercise_id"] for item in body}
        require(len(exercises) == 6, f"expected 6 exercises, got {len(exercises)}")
        points = [point for item in body for point in item["points"]]
        require(all(point["goal_reached"] for point in points), "a goal is not marked reached")
        require(
            all(point["personalisation"] is not None for point in points),
            "a personalisation decision is missing",
        )

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
        ("Patient saves six warm-up results", save_warmup),
        ("Patient reads the session's warm-up", read_session_warmup),
        ("Patient reads warm-up history", read_warmup_history),
        ("Dashboard shows the last warm-up", dashboard_last_warmup),
        ("Patient ends the session", end_session),
        ("Admin lists the patient's sessions", admin_lists_sessions),
        ("Admin lists the patient's calibrations", admin_lists_calibrations),
        ("Admin reads the patient's warm-up history", admin_reads_warmup_history),
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
