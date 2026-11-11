"""End-to-end check of a running server, with one PASS or FAIL line per step.

Start the server first, then run from server/ with the virtual environment active:

    python scripts/smoke_test.py [base_url]

The default base_url is http://localhost:8000. The admin login comes from server/.env. Each run
adds one test patient with one session (a calibration, six warm-up results and one
run each of reach_activate, balloon_pop and fruit_catch with 20 trials, one run each of the hand
games bloom and finger_piano with 4 trials whose targets have no place, and a cool-down
questionnaire with pain 5) to the database. Its pain alert is marked reviewed, and the patient is
deactivated at the end.
The exit code is 0 if every step passes and 1 otherwise.
"""

import math
import secrets
from functools import partial
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


GAME_TRIALS = 20
BATCH_SIZE = 10
GAME_IDS = ("reach_activate", "balloon_pop", "fruit_catch")
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
BALLOON_POP_PARAMS: dict[str, float] = {
    "height_frac": 0.7,
    "direction_deg": 90,
    "balloon_radius_sw": 0.45,
    "rise_ms": 2500,
    "hover_ms": 7000,
    "squeeze_to_pop": 0,
    "rest_ms": 1200,
}
FRUIT_CATCH_PARAMS: dict[str, float] = {
    "fall_speed_sw_s": 0.35,
    "spread_frac": 0.7,
    "basket_width_sw": 0.7,
    "spawn_interval_ms": 4000,
    "max_on_screen": 1,
}
PARAMS: dict[str, dict[str, float]] = {
    "reach_activate": REACH_ACTIVATE_PARAMS,
    "balloon_pop": BALLOON_POP_PARAMS,
    "fruit_catch": FRUIT_CATCH_PARAMS,
}

# Hand games: the hand only has to be visible, so their targets have no place in the body frame.
HAND_GAME_IDS = ("bloom", "finger_piano")
HAND_TRIALS = 4
ALL_GAME_IDS = GAME_IDS + HAND_GAME_IDS
BLOOM_PARAMS: dict[str, float] = {
    "open_demand": 0.7,
    "open_hold_ms": 800,
    "close_demand": 0.6,
    "phase_time_limit_ms": 8000,
    "close_hold_ms": 300,
    "rest_ms": 1500,
}
PIANO_PARAMS: dict[str, float] = {
    "finger_count": 4,
    "sequence_length": 4,
    "note_interval_ms": 2000,
    "hit_window_ms": 1200,
    "touch_threshold": 0.3,
    "preview_ms": 2000,
    "rest_ms": 1500,
}
MELODY = ["index", "middle", "ring", "little"]


def bloom_trial(trial_no: int) -> dict[str, Any]:
    """A flower; the fourth one is a miss that ran out of time while opening."""
    success = trial_no % 4 != 0
    return {
        "trial_no": trial_no,
        "params": BLOOM_PARAMS,
        "target": {"kind": "bloom"},
        "outcome": "success" if success else "miss",
        "timings": {
            "spawn": 0,
            "activation_start": 3000 if success else None,
            "activation_done": 3300 if success else None,
            "end": 3300 if success else 8000,
        },
        "metrics": {
            "time_to_open_ms": 1200 if success else None,
            "peak_openness": 0.85 if success else 0.5,
            "hold_stability": 0.03 if success else None,
            "time_to_close_ms": 700 if success else None,
            "peak_grip": 0.8 if success else None,
            "openness_rise_rate": 1.1,
            "failed_phase": None if success else "open",
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": [],
    }


def piano_trial(trial_no: int) -> dict[str, Any]:
    """A melody: three of four notes played, one with a wrong finger (a success at 75%)."""
    return {
        "trial_no": trial_no,
        "params": {**PIANO_PARAMS, **{f"note_{i + 1}": i for i in range(len(MELODY))}},
        "target": {"kind": "sequence", "notes": MELODY},
        "outcome": "success",
        "timings": {"spawn": 0, "end": 11600},
        "metrics": {
            "notes_total": 4,
            "hits": 3,
            "wrong_finger": 1,
            "missed": 0,
            "hit_rate": 0.75,
            "mean_timing_error_ms": 180,
            "per_finger": {
                "index": {"hits": 1, "attempts": 1},
                "middle": {"hits": 1, "attempts": 1},
                "ring": {"hits": 1, "attempts": 1},
                "little": {"hits": 0, "attempts": 1},
            },
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": [],
    }


def hand_summary(game_id: str, trials: list[dict[str, Any]]) -> dict[str, Any]:
    """The summary each hand game sends, with the details its main measures read."""
    successes = sum(1 for trial in trials if trial["outcome"] == "success")
    if game_id == "bloom":
        details: dict[str, Any] = {"mean_time_to_open_ms": 1200, "best_openness": 0.85}
    else:
        details = {
            "note_hit_rate": 0.75,
            "best_finger": "index",
            **{f"hit_rate_{finger}": 0.0 if finger == "little" else 1.0 for finger in MELODY},
        }
    return {
        "successes": successes,
        "success_rate": successes / len(trials),
        "compensated_trials": 0,
        "details": details,
    }


def straight_path(to: tuple[float, float]) -> list[list[float]]:
    """One second at 30 Hz from the shoulder straight to a point: a raw fingertip path."""
    return [
        [round(i * 1000 / 30, 1), round(to[0] * i / 30, 4), round(to[1] * i / 30, 4)]
        for i in range(31)
    ]


def no_metrics() -> dict[str, Any]:
    return {
        "reaction_ms": 33,
        "movement_ms": 967,
        "path_length_sw": 0.7,
        "straight_dist_sw": 0.7,
        "path_efficiency": 1.0,
        "peak_speed_sw_s": 0.7,
        "activation_latency_ms": None,
        "activation_peak": None,
    }


def trial_payload(game_id: str, trial_no: int) -> dict[str, Any]:
    """A synthetic trial. Every fourth one is not a success: a missed squeeze for Reach and
    squeeze, and a "miss" for the balloons and fruit."""
    success = trial_no % 4 != 0
    base: dict[str, Any] = {
        "trial_no": trial_no,
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "timings": {
            "spawn": 0,
            "move_onset": 33,
            "enter": 1000 if success else None,
            "dwell_done": None,
            "activation_start": None,
            "activation_done": None,
            "end": 1900 if success else 4500,
        },
        "metrics": no_metrics(),
    }
    if game_id == "reach_activate":
        index = (trial_no - 1) % 8
        direction = index * 45
        target = (0.7 * math.cos(math.radians(direction)), 0.7 * math.sin(math.radians(direction)))
        return {
            **base,
            "params": {**REACH_ACTIVATE_PARAMS, "direction_deg": direction, "direction_index": index},
            "target": {
                "x_sw": round(target[0], 4),
                "y_sw": round(target[1], 4),
                "radius_sw": 0.45,
                "direction_deg": direction,
                "distance_frac": 0.7,
                "sector": f"D{index}R2",
            },
            "outcome": "success" if success else "activation_fail",
            "timings": {
                **base["timings"],
                "enter": 1000,
                "dwell_done": 1500,
                "activation_start": 1700 if success else None,
                "activation_done": 1900 if success else None,
            },
            "metrics": {
                **base["metrics"],
                "activation_latency_ms": 200 if success else None,
                "activation_peak": 0.8 if success else 0.3,
            },
            "trajectory": straight_path(target),
        }
    if game_id == "balloon_pop":
        index = 1 + (trial_no - 1) % 3
        direction = index * 45
        height = (0.55, 0.7, 0.85)[(trial_no - 1) // 3 % 3]
        target = (height * math.cos(math.radians(direction)), height * math.sin(math.radians(direction)))
        return {
            **base,
            "params": {**BALLOON_POP_PARAMS, "direction_deg": direction, "height_frac": height},
            "target": {
                "x_sw": round(target[0], 4),
                "y_sw": round(target[1], 4),
                "radius_sw": 0.45,
                "direction_deg": direction,
                "distance_frac": height,
                "sector": f"D{index}R{1 if height < 0.55 else 2 if height <= 0.85 else 3}",
            },
            "outcome": "success" if success else "miss",
            "metrics": {**base["metrics"], "peak_arm_elevation_deg": 95.0 if success else 40.0},
            "trajectory": straight_path(target),
        }
    side = "out" if trial_no % 2 == 1 else "across"
    x = 0.6 if side == "out" else -0.4
    return {
        **base,
        "params": {**FRUIT_CATCH_PARAMS, "target_side": 1 if side == "out" else -1, "target_frac": 0.7},
        "target": {
            "x_sw": x,
            "y_sw": -0.3,
            "radius_sw": 0.13,
            "direction_deg": 0 if side == "out" else 180,
            "distance_frac": 0.5,
            "sector": "D0R1" if side == "out" else "D4R1",
        },
        "outcome": "success" if success else "miss",
        "metrics": {
            **base["metrics"],
            "lateral_distance_sw": abs(x),
            "lateral_path_efficiency": 0.95,
            "overshoot_sw": 0.05,
            "side": side,
        },
        "trajectory": straight_path((x, -0.3)),
    }


def game_summary(game_id: str, trials: list[dict[str, Any]]) -> dict[str, Any]:
    successes = [trial for trial in trials if trial["outcome"] == "success"]
    details: dict[str, Any] = {}
    if game_id == "balloon_pop":
        details["highest_popped_frac"] = max(trial["target"]["distance_frac"] for trial in successes)
    if game_id == "fruit_catch":
        details["widest_catch_frac"] = 0.5
    return {
        "successes": len(successes),
        "success_rate": len(successes) / len(trials),
        "mean_movement_ms": 967.0,
        "mean_path_efficiency": 1.0,
        "compensated_trials": 0,
        "details": details,
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

    def start_game(game_id: str) -> None:
        url = f"/api/sessions/{state['session_id']}/games"
        payload = {
            "game_id": game_id,
            "engine": "L0",
            "input_source": "keyboard",
            "params_initial": PARAMS[game_id],
            "trials_planned": GAME_TRIALS,
        }
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(body["status"] == "active", "game run is not active")
        require(body["game_id"] == game_id, f"the run is {body['game_id']}, not {game_id}")
        state[game_id] = {
            "run_id": body["id"],
            "trials": [trial_payload(game_id, n) for n in range(1, GAME_TRIALS + 1)],
        }

    def upload_batch(game_id: str, batch: int) -> None:
        game = state[game_id]
        url = f"/api/games/{game['run_id']}/trials"
        trials = game["trials"][batch * BATCH_SIZE : (batch + 1) * BATCH_SIZE]
        body = expect(client.post(url, json=trials, headers=bearer("patient")), 200)
        done = (batch + 1) * BATCH_SIZE
        require(body["trials_done"] == done, f"trials_done is {body['trials_done']}, not {done}")

    def end_game(game_id: str) -> None:
        game = state[game_id]
        url = f"/api/games/{game['run_id']}/end"
        summary = game_summary(game_id, game["trials"])
        game["score"] = 100 * summary["successes"]
        payload = {"status": "completed", "score": game["score"], "summary": summary}
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 200)
        require(body["status"] == "completed", "game run is not completed")
        require(body["trials_done"] == GAME_TRIALS, f"trials_done is {body['trials_done']}")
        require(body["summary"]["details"] == summary["details"], "summary details differ")

    def play_hand_game(game_id: str) -> None:
        """Starts a hand-game run, uploads its trials in one batch and ends it."""
        url = f"/api/sessions/{state['session_id']}/games"
        payload = {
            "game_id": game_id,
            "engine": "L0",
            "input_source": "keyboard",
            "params_initial": BLOOM_PARAMS if game_id == "bloom" else PIANO_PARAMS,
            "trials_planned": HAND_TRIALS,
        }
        run = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        make = bloom_trial if game_id == "bloom" else piano_trial
        trials = [make(n) for n in range(1, HAND_TRIALS + 1)]
        url = f"/api/games/{run['id']}/trials"
        body = expect(client.post(url, json=trials, headers=bearer("patient")), 200)
        require(body["trials_done"] == HAND_TRIALS, f"trials_done is {body['trials_done']}")
        summary = hand_summary(game_id, trials)
        score = 100 * summary["successes"]
        state[game_id] = {"run_id": run["id"], "trials": trials, "score": score}
        end = {"status": "completed", "score": score, "summary": summary}
        body = expect(
            client.post(f"/api/games/{run['id']}/end", json=end, headers=bearer("patient")), 200
        )
        require(body["status"] == "completed", f"the {game_id} run is not completed")
        require(body["summary"]["details"] == summary["details"], "summary details differ")

    def dashboard_last_games() -> None:
        body = expect(client.get("/api/patient/dashboard", headers=bearer("patient")), 200)
        games = body["last_session"]["games"]
        require(
            [game["game_id"] for game in games] == list(ALL_GAME_IDS),
            f"dashboard games are {[game['game_id'] for game in games]}",
        )
        for game in games:
            expected = state[game["game_id"]]["score"]
            require(game["score"] == expected, f"{game['game_id']} score is {game['score']}")

    def cooldown_with_pain() -> None:
        url = f"/api/sessions/{state['session_id']}/questionnaire"
        answers = {
            "pain_0_10": 5,
            "fatigue_0_10": 4,
            "enjoyment_1_5": 4,
            "difficulty": "just_right",
            "new_symptoms": False,
            "comment": "Smoke test: pain 5",
        }
        body = expect(client.post(url, json=answers, headers=bearer("patient")), 201)
        require(body["flags"] == ["pain"], f"flags are {body['flags']}, not ['pain']")
        require(body["needs_review"] is True, "the session is not marked for review")

    def session_summary() -> None:
        url = f"/api/sessions/{state['session_id']}/summary"
        body = expect(client.get(url, headers=bearer("patient")), 200)
        require(
            [game["game_id"] for game in body["games"]] == list(ALL_GAME_IDS),
            "the summary's games are wrong",
        )
        bloom, piano = body["games"][3], body["games"][4]
        require(bloom["success_rate"] == 0.75, "Bloom's success rate is wrong")
        require(
            bloom["main_measure"] == {"name": "flowers_grown", "value": 3, "unit": "count"},
            f"Bloom's main measure is {bloom['main_measure']}",
        )
        require(bloom["extra_measures"][0]["value"] == 0.85, "Bloom's best openness is wrong")
        require(piano["success_rate"] == 1.0, "Finger piano's success rate is wrong")
        require(
            piano["main_measure"] == {"name": "note_hit_rate", "value": 0.75, "unit": "share"},
            f"Finger piano's main measure is {piano['main_measure']}",
        )
        require(
            piano["extra_measures"][0]["value"] == "index", "Finger piano's best finger is wrong"
        )
        require(body["warmup"]["goals_reached"] == 6, "the summary's warm-up goals are wrong")
        require(body["reach"]["hull_area_sw2"] == 2.0, "the summary's reach is wrong")
        require(body["feedback"]["pain_0_10"] == 5, "the summary has no questionnaire")
        require(body["flags"] == ["pain"], "the summary has no pain flag")
        require(body["active_seconds"] > 0, "the summary has no active time")

    def patient_progress() -> None:
        body = expect(client.get("/api/patient/progress", headers=bearer("patient")), 200)
        series = body["series"]
        require(len(series) == 1, f"expected 1 completed session, got {len(series)}")
        point = series[0]
        require(point["session_id"] == state["session_id"], "progress shows another session")
        require(point["warmup_goals_reached"] == 6, "progress warm-up goals are wrong")
        # Every fourth reaching trial and flower is not a success; every melody is: 52 of 68.
        rate = point["game_success_rate"]
        require(rate is not None and abs(rate - 52 / 68) < 1e-9, f"success rate is {rate}")
        # Bloom: three flowers opened to 0.85 and one to 0.5. Finger piano: 12 of 16 notes.
        openness = point["bloom_peak_openness"]
        require(
            openness is not None and abs(openness - 0.7625) < 1e-9,
            f"Bloom's peak openness is {openness}",
        )
        require(point["piano_hit_rate"] == 0.75, f"the hit rate is {point['piano_hit_rate']}")
        require(body["streak_days"] >= 1, "the streak is empty")
        require(len(body["calendar"]) == 28, "the calendar does not have 28 days")

    def admin_sees_alert() -> None:
        params = {"reviewed": "false"}
        body = expect(client.get("/api/admin/alerts", params=params, headers=bearer("admin")), 200)
        alert = next((item for item in body if item["session_id"] == state["session_id"]), None)
        require(alert is not None, "the pain alert is not listed")
        require(alert["flags"] == ["pain"], f"the alert's flags are {alert['flags']}")
        stats = expect(client.get("/api/admin/stats", headers=bearer("admin")), 200)
        require(stats["open_alerts"] >= 1, "open_alerts does not count the alert")
        state["open_alerts"] = stats["open_alerts"]

    def admin_reviews_alert() -> None:
        url = f"/api/admin/alerts/{state['session_id']}/review"
        note = {"note": "Smoke test: reviewed"}
        body = expect(client.post(url, json=note, headers=bearer("admin")), 200)
        require(body["reviewed"] is True, "the alert is not reviewed")
        params = {"reviewed": "false"}
        open_alerts = expect(
            client.get("/api/admin/alerts", params=params, headers=bearer("admin")), 200
        )
        require(
            all(item["session_id"] != state["session_id"] for item in open_alerts),
            "the reviewed alert is still open",
        )
        stats = expect(client.get("/api/admin/stats", headers=bearer("admin")), 200)
        expected = state["open_alerts"] - 1
        require(stats["open_alerts"] == expected, f"open_alerts is {stats['open_alerts']}")

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
        all_runs = body["games"]
        require(len(all_runs) == 5, f"expected 5 game runs, got {len(all_runs)}")
        require(
            [run["game_id"] for run in all_runs] == list(ALL_GAME_IDS), "the runs are out of order"
        )
        runs = all_runs[:3]
        trials = [trial for run in runs for trial in run["trials"]]
        require(len(trials) == 3 * GAME_TRIALS, f"expected 60 trials, got {len(trials)}")
        for run in runs:
            numbers = [trial["trial_no"] for trial in run["trials"]]
            require(numbers == list(range(1, GAME_TRIALS + 1)), f"{run['game_id']} trials are missing")
        misses = sum(1 for trial in trials if trial["outcome"] == "miss")
        require(misses == 10, f"expected 10 misses, got {misses}")
        require(all(len(trial["trajectory"]) == 31 for trial in trials), "a trajectory is missing")

        bloom, piano = all_runs[3], all_runs[4]
        require(len(bloom["trials"]) == HAND_TRIALS, "a Bloom trial is missing")
        require(
            all(trial["target"] == {"kind": "bloom"} for trial in bloom["trials"]),
            "a Bloom target is not just its kind",
        )
        missed = bloom["trials"][3]
        require(missed["outcome"] == "miss", "the fourth flower is not a miss")
        require(missed["metrics"]["failed_phase"] == "open", "the miss has no failed phase")
        require(len(piano["trials"]) == HAND_TRIALS, "a Finger piano trial is missing")
        first = piano["trials"][0]
        require(
            first["target"] == {"kind": "sequence", "notes": MELODY},
            f"the melody target is {first['target']}",
        )
        require(first["metrics"]["hits"] == 3, "the melody's hits are wrong")
        require(
            first["metrics"]["per_finger"]["little"] == {"hits": 0, "attempts": 1},
            "the per-finger tally is wrong",
        )
        hand_trials = bloom["trials"] + piano["trials"]
        require(all(trial["trajectory"] == [] for trial in hand_trials), "a hand trial has a path")

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
        *[
            step
            for game_id in GAME_IDS
            for step in (
                (f"Patient starts a {game_id} run", partial(start_game, game_id)),
                (f"Patient uploads {game_id} trials 1 to 10", partial(upload_batch, game_id, 0)),
                (f"Patient uploads {game_id} trials 11 to 20", partial(upload_batch, game_id, 1)),
                (f"Patient ends the {game_id} run with a summary", partial(end_game, game_id)),
            )
        ],
        *[
            (f"Patient plays a {game_id} run with non-spatial targets", partial(play_hand_game, game_id))
            for game_id in HAND_GAME_IDS
        ],
        ("Dashboard shows the last session's five games", dashboard_last_games),
        ("Patient sends the cool-down with pain 5 and gets the pain flag", cooldown_with_pain),
        ("Patient ends the session", end_session),
        ("Patient reads the session summary", session_summary),
        ("Patient reads their progress", patient_progress),
        ("Admin lists the patient's sessions", admin_lists_sessions),
        ("Admin lists the patient's calibrations", admin_lists_calibrations),
        ("Admin reads the patient's warm-up history", admin_reads_warmup_history),
        ("Admin reads the full session detail", admin_reads_session_detail),
        ("Admin sees the pain alert", admin_sees_alert),
        ("Admin marks the alert reviewed", admin_reviews_alert),
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
