"""End-to-end check of a running server, with one PASS or FAIL line per step.

Start the server first, then run from server/ with the virtual environment active:

    python scripts/smoke_test.py [base_url]

The default base_url is http://localhost:8000. The admin login comes from server/.env. Each run
adds one test patient with one session (a calibration, six warm-up results and one
reach_activate run with 20 trials) to the database,
and deactivates the patient at the end.
The exit code is 0 if every step passes and 1 otherwise.
"""

import math
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


DIRECTION_SECTORS = 8
GAME_TRIALS = 20
BATCH_SIZE = 10
REACH_ACTIVATE_PARAMS: dict[str, float] = {
    "distance_frac": 0.7,
    "target_radius_sw": 0.45,
    "dwell_ms": 500,
    "activation_demand": 0.5,
    "activation_hold_ms": 200,
    "activation_window_ms": 3000,
    "reach_time_limit_ms": 8000,
    "rest_ms": 1500,
}


def trial_payload(trial_no: int) -> dict[str, Any]:
    """A synthetic reach_activate trial: every fourth one misses, the rest reach and squeeze.

    The direction cycles through all eight, and the trajectory is a straight raw path at 30 Hz.
    """
    index = (trial_no - 1) % DIRECTION_SECTORS
    direction_deg = index * 45
    radians = math.radians(direction_deg)
    distance = 0.7
    target = (distance * math.cos(radians), distance * math.sin(radians))
    success = trial_no % 4 != 0
    trajectory = [
        [round(i * 1000 / 30, 1), round(target[0] * i / 30, 4), round(target[1] * i / 30, 4)]
        for i in range(31)
    ]
    return {
        "trial_no": trial_no,
        "params": {**REACH_ACTIVATE_PARAMS, "direction_deg": direction_deg, "direction_index": index},
        "target": {
            "x_sw": round(target[0], 4),
            "y_sw": round(target[1], 4),
            "radius_sw": 0.45,
            "direction_deg": direction_deg,
            "distance_frac": 0.7,
            "sector": f"D{index}R2",
        },
        "outcome": "success" if success else "activation_fail",
        "timings": {
            "spawn": 0,
            "move_onset": 33,
            "enter": 1000,
            "dwell_done": 1500,
            "activation_start": 1700 if success else None,
            "activation_done": 1900 if success else None,
            "end": 1900 if success else 4500,
        },
        "metrics": {
            "reaction_ms": 33,
            "movement_ms": 967,
            "path_length_sw": 0.7,
            "straight_dist_sw": 0.7,
            "path_efficiency": 1.0,
            "peak_speed_sw_s": 0.7,
            "activation_latency_ms": 200 if success else None,
            "activation_peak": 0.8 if success else 0.3,
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": trajectory,
    }


def game_summary(trials: list[dict[str, Any]]) -> dict[str, Any]:
    successes = sum(1 for trial in trials if trial["outcome"] == "success")
    return {
        "successes": successes,
        "success_rate": successes / len(trials),
        "mean_movement_ms": 967.0,
        "mean_path_efficiency": 1.0,
        "compensated_trials": 0,
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

    def start_game() -> None:
        url = f"/api/sessions/{state['session_id']}/games"
        payload = {
            "game_id": "reach_activate",
            "engine": "L0",
            "input_source": "keyboard",
            "params_initial": REACH_ACTIVATE_PARAMS,
            "trials_planned": GAME_TRIALS,
        }
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(body["status"] == "active", "game run is not active")
        state["run_id"] = body["id"]
        state["trials"] = [trial_payload(n) for n in range(1, GAME_TRIALS + 1)]

    def upload_batch(batch: int) -> None:
        url = f"/api/games/{state['run_id']}/trials"
        trials = state["trials"][batch * BATCH_SIZE : (batch + 1) * BATCH_SIZE]
        body = expect(client.post(url, json=trials, headers=bearer("patient")), 200)
        done = (batch + 1) * BATCH_SIZE
        require(body["trials_done"] == done, f"trials_done is {body['trials_done']}, not {done}")

    def end_game() -> None:
        url = f"/api/games/{state['run_id']}/end"
        summary = game_summary(state["trials"])
        state["score"] = 100 * summary["successes"]
        payload = {"status": "completed", "score": state["score"], "summary": summary}
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 200)
        require(body["status"] == "completed", "game run is not completed")
        require(body["trials_done"] == GAME_TRIALS, f"trials_done is {body['trials_done']}")

    def dashboard_last_games() -> None:
        body = expect(client.get("/api/patient/dashboard", headers=bearer("patient")), 200)
        games = body["last_session"]["games"]
        require(len(games) == 1, f"expected 1 game on the dashboard, got {len(games)}")
        require(games[0]["game_id"] == "reach_activate", "the dashboard game is not reach_activate")
        require(games[0]["score"] == state["score"], f"dashboard score is {games[0]['score']}")

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

    def admin_reads_session_detail() -> None:
        url = f"/api/admin/sessions/{state['session_id']}"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(body["calibration"] is not None, "calibration is missing")
        require(len(body["warmup_results"]) == 6, "a warm-up result is missing")
        require(len(body["games"]) == 1, "the game run is missing")
        trials = body["games"][0]["trials"]
        require(len(trials) == GAME_TRIALS, f"expected {GAME_TRIALS} trials, got {len(trials)}")
        numbers = [trial["trial_no"] for trial in trials]
        require(numbers == list(range(1, GAME_TRIALS + 1)), "trials are missing or out of order")
        require(all(len(trial["trajectory"]) == 31 for trial in trials), "a trajectory is missing")

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
        ("Patient starts a reach_activate run", start_game),
        ("Patient uploads trials 1 to 10", lambda: upload_batch(0)),
        ("Patient uploads trials 11 to 20", lambda: upload_batch(1)),
        ("Patient ends the run with a summary", end_game),
        ("Dashboard shows the last session's game", dashboard_last_games),
        ("Patient ends the session", end_session),
        ("Admin lists the patient's sessions", admin_lists_sessions),
        ("Admin lists the patient's calibrations", admin_lists_calibrations),
        ("Admin reads the patient's warm-up history", admin_reads_warmup_history),
        ("Admin reads the full session detail", admin_reads_session_detail),
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
