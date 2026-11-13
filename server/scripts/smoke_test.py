"""End-to-end check of a running server, with one PASS or FAIL line per step.

Start the server first, then run from server/ with the virtual environment active:

    python scripts/smoke_test.py [base_url]

The default base_url is http://localhost:8000. The admin login comes from server/.env. Each run
adds one test patient with one session (a calibration, six warm-up results and one
run each of reach_activate, balloon_pop and fruit_catch with 20 trials, one run each of bloom,
finger_piano, path_trace, paint_wall, pick_place and grip_hold with 4 trials whose targets have
no place, and a cool-down questionnaire with pain 5) to the database. Its pain alert is marked
reviewed. A second session then checks the adaptive engine (POST /api/engine/next): a
reach_activate run of 20 trials (12 successes, then 8 failures) whose level rises and then falls,
with a logged decision at the start and after every trial, and a run that tires (5 quick
successes, then 5 slow failures) and gets the "rest" cue. A third session checks the Bayesian
engine and the planner: the admin switches the patient to L2; the plan has a reason for every game;
a change to it is stored; an L2 run of 8 trials returns a sector each time and its beliefs update;
and the facts plan the next session once it ends. A fourth session uses the muscle sensor: a real
sensor's calibration on mains power is refused; one with the nine readiness results is saved; a
grip_hold run with input_source "emg" uploads a %MVC trace and EMG measures with every trial; and
the session's metrics and facts then hold the EMG measures (E2, E3, E5, E6, E8, E9). The patient
is deactivated at the end.

It also turns Bloom off and changes a Grip and hold default in the game library, checks that the
patient's game settings follow, and then puts both games' settings back as they were. After the
session ends it checks the server's measures: the session metrics, the admin's metrics table,
the session facts for the feedback module (no name or email), and both CSV exports.

Feedback reports: the questionnaire queues the session's report; the script waits for it to be
written (up to 150 s), checks the fixed stop notice comes first, that the patient never gets the
therapist summary and the admin gets it with the facts snapshot, rates it once, and has a Bangla
report written. Run the server with the mock model so this takes seconds:

    $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"
    python -m uvicorn app.main:app

The exit code is 0 if every step passes and 1 otherwise.
"""

import math
import secrets
import time
from functools import partial
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

DEFAULT_BASE_URL = "http://localhost:8000"
#: The longest wait for a feedback report (the model on a laptop GPU, or the mock).
REPORT_WAIT_S = 150
#: The adaptive engine's run: this many trials, the first ENGINE_SUCCESSES of them successes.
ENGINE_TRIALS = 20
ENGINE_SUCCESSES = 12
#: The L2 run's trials.
L2_TRIALS = 8
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


# Movement-quality games: their targets have no place either, but carry a path or a stripe.
MOVEMENT_GAME_IDS = ("path_trace", "paint_wall")
UNPLACED_GAME_IDS = HAND_GAME_IDS + MOVEMENT_GAME_IDS
PATH_TRACE_PARAMS: dict[str, float] = {
    "shape_index": 2,
    "path_length_frac": 0.6,
    "guide_speed_sw_s": 0.25,
    "corridor_width_sw": 0.4,
    "ring_frac": 0.7,
    "direction": 1,
    "start_hold_ms": 500,
    "rest_ms": 2000,
}
PAINT_WALL_PARAMS: dict[str, float] = {
    "required_range_frac": 0.75,
    "sweeps_needed": 3,
    "time_limit_ms": 30000,
    "elbow_bent_deg": 70,
    "elbow_straight_deg": 150,
    "rest_ms": 2000,
}
PATH = [[round(0.1 * i, 2), round(0.2 * math.sin(i / 3), 4)] for i in range(10)]
#: Per trace: time in the corridor (the fourth is a miss) and SPARC.
TRACES = [(85.0, -1.7), (92.0, -1.5), (95.0, -1.6), (55.0, -2.4)]
#: Per stripe: elbow range reached and full sweeps (the fourth runs out of time).
STRIPES = [(70.0, 3), (74.0, 3), (72.0, 3), (50.0, 1)]


def path_trial(trial_no: int) -> dict[str, Any]:
    """A trace of an S-curve: the fingertip's raw path follows it closely."""
    in_corridor, smoothness = TRACES[trial_no - 1]
    return {
        "trial_no": trial_no,
        "params": PATH_TRACE_PARAMS,
        "target": {"kind": "path", "shape": "s_curve", "points": PATH},
        "outcome": "success" if in_corridor >= 70 else "miss",
        "timings": {"spawn": 0, "enter": 1000, "dwell_done": 1500, "end": 5500},
        "metrics": {
            "peak_speed_sw_s": 0.45,
            "mean_tracking_error_sw": 0.06,
            "mean_path_error_sw": 0.03,
            "time_in_corridor_pct": in_corridor,
            "lag_ms": 280,
            "coverage_pct": min(100.0, in_corridor + 5),
            "sparc": smoothness,
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": [[1500 + 400 * i, x, y + 0.02] for i, (x, y) in enumerate(PATH)],
    }


def wall_trial(trial_no: int) -> dict[str, Any]:
    """A stripe of the wall; the fourth runs out of time with one full sweep."""
    achieved, full = STRIPES[trial_no - 1]
    return {
        "trial_no": trial_no,
        "params": PAINT_WALL_PARAMS,
        "target": {"kind": "stripe", "index": trial_no - 1, "target_frac": 0.75},
        "outcome": "success" if full >= 3 else "miss",
        "timings": {"spawn": 0, "end": 7000 if full >= 3 else 30000},
        "metrics": {
            "achieved_range_deg": achieved,
            "max_bend_deg": 150 - achieved,
            "max_straight_deg": 150.0,
            "full_sweeps": full,
            "partial_sweeps": 1,
            "mean_sweep_ms": 2100,
            "angular_sparc": -1.9,
            "upper_arm_motion_deg": 8.0,
        },
        "compensation": {
            "flagged": False,
            "type": None,
            "max_values": {"upper_arm_motion_deg": 8.0},
        },
        "trajectory": [[0, 0.3, -0.6], [1000, 0.31, -0.3], [2000, 0.3, -0.6]],
    }


def movement_summary(game_id: str, trials: list[dict[str, Any]]) -> dict[str, Any]:
    """The summary each movement-quality game sends, with the details its measures read."""
    successes = sum(1 for trial in trials if trial["outcome"] == "success")
    if game_id == "path_trace":
        # Stars: 2 for 85%, 3 for 92% and 95%, 1 for 55%.
        details: dict[str, Any] = {
            "mean_in_corridor_pct": 81.8,
            "total_stars": 9,
            "best_sparc": -1.5,
        }
    else:
        details = {"mean_range_deg": 66.5, "best_range_deg": 74.0}
    return {
        "successes": successes,
        "success_rate": successes / len(trials),
        "compensated_trials": 0,
        "details": details,
    }


# Pick and place and Grip and hold: a target with no place, carrying positions or a band.
FUNCTION_GAME_IDS = ("pick_place", "grip_hold")
UNPLACED_GAME_IDS = UNPLACED_GAME_IDS + FUNCTION_GAME_IDS
PICK_PLACE_PARAMS: dict[str, float] = {
    "object_radius_sw": 0.35,
    "pick_distance_frac": 0.6,
    "place_distance_frac": 0.7,
    "box_size_sw": 0.7,
    "carry_angle_deg": 90,
    "time_limit_ms": 15000,
    "carry_direction": 0,
    "rest_ms": 1500,
}
PICK_PLACE_TARGET: dict[str, Any] = {
    "kind": "pick_place",
    "pick": [-0.4, 0.6],
    "place": [0.6, 0.6],
    "object_radius_sw": 0.35,
    "box_size_sw": 0.7,
}
#: Per object: carry time (None: not placed in time) and drops.
CARRIES = [(2000, 0), (2400, 1), (2600, 0), (None, 2)]
GRIP_HOLD_PARAMS: dict[str, float] = {
    "band_center": 0.5,
    "band_width": 0.3,
    "hold_ms": 3000,
    "time_limit_ms": 15000,
    "relax_below": 0.15,
    "relax_within_ms": 3000,
    "rest_ms": 2000,
}
#: Per hold: steadiness, relaxation time and the phase that ran out (the fourth never relaxed).
HOLDS = [(0.04, 700, None), (0.03, 900, None), (0.05, 800, None), (0.06, None, "relax")]


def pick_trial(trial_no: int) -> dict[str, Any]:
    """An object carried outward to the box; the fourth runs out of time after two drops."""
    transport, drops = CARRIES[trial_no - 1]
    placed = transport is not None
    return {
        "trial_no": trial_no,
        "params": PICK_PLACE_PARAMS,
        "target": PICK_PLACE_TARGET,
        "outcome": "success" if placed else "miss",
        "timings": {"spawn": 0, "enter": 1200, "dwell_done": 1700, "end": 6000 if placed else 15000},
        "metrics": {
            "reach_ms": 1200,
            "grasp_latency_ms": 500,
            "transport_ms": transport,
            "transport_path_efficiency": 0.86 if placed else None,
            "drops": drops,
            "release_error_sw": 0.12 if placed else None,
            "sparc": -1.6 if placed else None,
            "peak_speed_sw_s": 0.7 if placed else None,
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": [[0, 0.1, -0.8], [1200, -0.4, 0.6], [4000, 0.6, 0.6]],
    }


def grip_trial(trial_no: int) -> dict[str, Any]:
    """A hold in the band, then relaxing; the fourth does not relax in time."""
    steadiness, relaxation, failed = HOLDS[trial_no - 1]
    return {
        "trial_no": trial_no,
        "params": GRIP_HOLD_PARAMS,
        "target": {"kind": "grip_band", "center": 0.5, "width": 0.3},
        "outcome": "success" if failed is None else "miss",
        "timings": {"spawn": 0, "activation_start": 800, "activation_done": 4200, "end": 5000},
        "metrics": {
            "time_to_band_ms": 800,
            "time_in_band_pct": 80.0,
            "longest_continuous_hold_ms": 2500,
            "overshoot_count": 1,
            "max_overshoot": 0.05,
            "steadiness": steadiness,
            "relaxation_ms": relaxation,
            "input_source": "keyboard",
            "failed_phase": failed,
        },
        "compensation": {"flagged": False, "type": None, "max_values": {}},
        "trajectory": [],
    }


def function_summary(game_id: str, trials: list[dict[str, Any]]) -> dict[str, Any]:
    """The summary Pick and place and Grip and hold send, with the details their measures read."""
    successes = sum(1 for trial in trials if trial["outcome"] == "success")
    if game_id == "pick_place":
        details: dict[str, Any] = {"mean_transport_ms": 2333, "total_drops": 3}
    else:
        details = {
            "mean_in_band_pct": 80.0,
            "best_hold_ms": 2500,
            "best_steadiness": 0.03,
            "mean_relaxation_ms": 800,
        }
    return {
        "successes": successes,
        "success_rate": successes / len(trials),
        "compensated_trials": 0,
        "details": details,
    }


#: How the smoke test plays each game whose targets have no place: settings, trials, summary.
UNPLACED_GAMES: dict[str, tuple[dict[str, float], Callable[[int], dict[str, Any]], Any]] = {
    "bloom": (BLOOM_PARAMS, bloom_trial, hand_summary),
    "finger_piano": (PIANO_PARAMS, piano_trial, hand_summary),
    "path_trace": (PATH_TRACE_PARAMS, path_trial, movement_summary),
    "paint_wall": (PAINT_WALL_PARAMS, wall_trial, movement_summary),
    "pick_place": (PICK_PLACE_PARAMS, pick_trial, function_summary),
    "grip_hold": (GRIP_HOLD_PARAMS, grip_trial, function_summary),
}
ALL_GAME_IDS = GAME_IDS + UNPLACED_GAME_IDS
# The muscle-sensor session: rest 200 +- 10 mV, MVC 1500 mV (threshold 230 mV), and a Grip and
# hold run whose peak %MVC falls by 5 each trial (fatigue slope E9 = -5).
EMG_REST_MEAN_MV = 200.0
EMG_REST_SD_MV = 10.0
EMG_MVC_MV = 1500.0
EMG_PEAKS = [60.0, 55.0, 50.0, 45.0]
EMG_READINESS_CHECKS = (
    "webSerial",
    "connected",
    "responding",
    "rate",
    "gaps",
    "contact",
    "saturation",
    "relaxed",
    "squeeze",
)


def emg_calibration_payload(battery_ok: bool) -> dict[str, Any]:
    """A real sensor's calibration at the flexors, with the nine readiness results."""
    return {
        "site": "flexors",
        "source": "serial",
        "firmware_version": "1.0.0",
        "sample_rate": 500,
        "rest_mean_mv": EMG_REST_MEAN_MV,
        "rest_sd_mv": EMG_REST_SD_MV,
        "mvc_mv": EMG_MVC_MV,
        "mvc_attempts": [1460.0, 1500.0, 1480.0],
        "readiness": {check: {"pass": True, "value": None} for check in EMG_READINESS_CHECKS},
        "quality": {"gaps_pct": 0.0, "saturated_attempts": 0},
        "battery_ok": battery_ok,
        "gain_note": "smoke test",
    }


def emg_grip_trial(trial_no: int) -> dict[str, Any]:
    """A Grip and hold trial driven by the muscle sensor: its 50 Hz %MVC trace (rest, a ramp to
    the hold, the hold, then relaxing) and the browser's EMG measures."""
    trial = grip_trial(trial_no)
    trial["metrics"]["input_source"] = "emg"
    peak = EMG_PEAKS[trial_no - 1]
    trace = []
    for ms in range(0, 5000, 20):
        if ms < 600:
            value = 1.0
        elif ms < 4200:
            value = peak - (2.0 if (ms // 20) % 2 else 0.0)
        else:
            value = 1.0
        trace.append([ms, value])
    trial["emg"] = {
        "site": "flexors",
        "trace": trace,
        "metrics": {
            "peak_mvc": peak,
            "mean_mvc_active": peak - 1.0,
            "onset_latency_ms": 600 + 20 * trial_no,
            "relaxation_ms": 300 + 20 * trial_no,
            "onset_ms": 600,
            "offset_ms": 4200,
            "time_in_band_pct": 100.0 if peak >= 35 else 0.0,
            "steadiness": 0.01,
        },
    }
    return trial


#: The games whose library settings the smoke test changes, then puts back.
SETTING_GAMES = ("bloom", "grip_hold")


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
        state["patient_code"] = body["patient_code"]

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

    def play_unplaced_game(game_id: str) -> None:
        """Starts a run of a game without placed targets, uploads its trials in one batch and
        ends it."""
        params, make, summarise = UNPLACED_GAMES[game_id]
        url = f"/api/sessions/{state['session_id']}/games"
        payload = {
            "game_id": game_id,
            "engine": "L0",
            "input_source": "keyboard",
            "params_initial": params,
            "trials_planned": HAND_TRIALS,
        }
        run = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        trials = [make(n) for n in range(1, HAND_TRIALS + 1)]
        url = f"/api/games/{run['id']}/trials"
        body = expect(client.post(url, json=trials, headers=bearer("patient")), 200)
        require(body["trials_done"] == HAND_TRIALS, f"trials_done is {body['trials_done']}")
        summary = summarise(game_id, trials)
        score = 100 * summary["successes"]
        state[game_id] = {"run_id": run["id"], "trials": trials, "score": score}
        end = {"status": "completed", "score": score, "summary": summary}
        body = expect(
            client.post(f"/api/games/{run['id']}/end", json=end, headers=bearer("patient")), 200
        )
        require(body["status"] == "completed", f"the {game_id} run is not completed")
        require(body["summary"]["details"] == summary["details"], "summary details differ")

    def admin_changes_game_settings() -> None:
        """Turns Bloom off and gives Grip and hold a 5 s hold and 10 turns, keeping what was
        there before so it can be put back."""
        games = expect(client.get("/api/admin/games", headers=bearer("admin")), 200)
        require(len(games) == 9, f"expected 9 games in the library, got {len(games)}")
        state["saved_settings"] = {
            game["spec"]["id"]: game for game in games if game["spec"]["id"] in SETTING_GAMES
        }
        bloom = {"enabled": False, "default_params": {}, "trials_default": None, "notes": None}
        body = expect(
            client.put("/api/admin/games/bloom", json=bloom, headers=bearer("admin")), 200
        )
        require(body["enabled"] is False, "Bloom is still enabled")
        grip = {
            "enabled": True,
            "default_params": {"hold_ms": 5000},
            "trials_default": 10,
            "notes": "Smoke test",
        }
        body = expect(
            client.put("/api/admin/games/grip_hold", json=grip, headers=bearer("admin")), 200
        )
        require(body["effective_params"]["hold_ms"] == 5000, "the hold time was not saved")
        out_of_range = {**grip, "default_params": {"hold_ms": 9000}}
        expect(
            client.put("/api/admin/games/grip_hold", json=out_of_range, headers=bearer("admin")),
            422,
        )

    def patient_settings_follow() -> None:
        games = expect(client.get("/api/games/settings", headers=bearer("patient")), 200)
        ids = [game["game_id"] for game in games]
        require("bloom" not in ids, "the patient still sees Bloom")
        require(len(ids) == 8, f"expected 8 games for the patient, got {ids}")
        grip = next(game for game in games if game["game_id"] == "grip_hold")
        require(grip["params"]["hold_ms"] == 5000, f"Grip and hold's hold is {grip['params']}")
        require(grip["trials"] == 10, f"Grip and hold has {grip['trials']} turns")

    def admin_restores_game_settings() -> None:
        for game_id, saved in state["saved_settings"].items():
            if saved["updated_at"] is None:
                url = f"/api/admin/games/{game_id}/reset"
                expect(client.post(url, headers=bearer("admin")), 200)
                continue
            setting = {
                key: saved[key] for key in ("enabled", "default_params", "trials_default", "notes")
            }
            url = f"/api/admin/games/{game_id}"
            expect(client.put(url, json=setting, headers=bearer("admin")), 200)
        games = expect(client.get("/api/admin/games", headers=bearer("admin")), 200)
        for game in games:
            saved = state["saved_settings"].get(game["spec"]["id"])
            if saved is not None:
                require(
                    game["enabled"] == saved["enabled"]
                    and game["default_params"] == saved["default_params"]
                    and game["trials_default"] == saved["trials_default"],
                    f"{game['spec']['id']}'s settings were not put back",
                )

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
        trace, wall = body["games"][5], body["games"][6]
        require(trace["success_rate"] == 0.75, "Path trace's success rate is wrong")
        require(
            trace["main_measure"] == {"name": "stars", "value": 9, "unit": "count"},
            f"Path trace's main measure is {trace['main_measure']}",
        )
        require(
            [(m["name"], m["value"]) for m in trace["extra_measures"]]
            == [("mean_in_corridor_pct", 81.8), ("best_sparc", -1.5)],
            f"Path trace's extra measures are {trace['extra_measures']}",
        )
        require(wall["success_rate"] == 0.75, "Paint the wall's success rate is wrong")
        require(
            wall["main_measure"] == {"name": "stripes_finished", "value": 3, "unit": "count"},
            f"Paint the wall's main measure is {wall['main_measure']}",
        )
        require(
            wall["extra_measures"] == [{"name": "best_range_deg", "value": 74.0, "unit": "deg"}],
            f"Paint the wall's extra measures are {wall['extra_measures']}",
        )
        pick, grip = body["games"][7], body["games"][8]
        require(pick["success_rate"] == 0.75, "Pick and place's success rate is wrong")
        require(
            pick["main_measure"] == {"name": "objects_placed", "value": 3, "unit": "count"},
            f"Pick and place's main measure is {pick['main_measure']}",
        )
        require(
            [(m["name"], m["value"]) for m in pick["extra_measures"]]
            == [("total_drops", 3), ("mean_transport_ms", 2333)],
            f"Pick and place's extra measures are {pick['extra_measures']}",
        )
        require(
            grip["main_measure"] == {"name": "holds_completed", "value": 3, "unit": "count"},
            f"Grip and hold's main measure is {grip['main_measure']}",
        )
        require(
            [(m["name"], m["value"]) for m in grip["extra_measures"]]
            == [("best_steadiness", 0.03), ("mean_relaxation_ms", 800)],
            f"Grip and hold's extra measures are {grip['extra_measures']}",
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
        # Every fourth reaching trial, flower, trace, stripe, object and hold is not a success;
        # every melody is: 45 + 3 + 4 + 3 + 3 + 3 + 3 = 64 of 84.
        rate = point["game_success_rate"]
        require(rate is not None and abs(rate - 64 / 84) < 1e-9, f"success rate is {rate}")
        # Pick and place: carries of 2000, 2400 and 2600 ms. Grip and hold: steadiness 0.04,
        # 0.03, 0.05 and 0.06, and relaxing in 700, 900 and 800 ms.
        transport = point["pick_transport_ms"]
        require(
            transport is not None and abs(transport - 7000 / 3) < 1e-6,
            f"Pick and place's carry time is {transport}",
        )
        steadiness = point["grip_steadiness"]
        require(
            steadiness is not None and abs(steadiness - 0.045) < 1e-9,
            f"Grip and hold's steadiness is {steadiness}",
        )
        require(point["grip_relaxation_ms"] == 800, "Grip and hold's relaxation time is wrong")
        # Path trace: SPARC -1.7, -1.5, -1.6 and -2.4. Paint the wall: 70, 74, 72 and 50 degrees.
        smoothness = point["path_sparc"]
        require(
            smoothness is not None and abs(smoothness + 1.8) < 1e-9,
            f"Path trace's smoothness is {smoothness}",
        )
        require(point["elbow_range_deg"] == 66.5, f"the elbow range is {point['elbow_range_deg']}")
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
        require(len(all_runs) == 9, f"expected 9 game runs, got {len(all_runs)}")
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

        trace, wall = all_runs[5], all_runs[6]
        require(len(trace["trials"]) == HAND_TRIALS, "a Path trace trial is missing")
        traced = trace["trials"][0]
        require(
            traced["target"] == {"kind": "path", "shape": "s_curve", "points": PATH},
            f"the path target is {traced['target']}",
        )
        require(len(traced["trajectory"]) == len(PATH), "the trace's raw path is missing")
        require(traced["metrics"]["sparc"] == -1.7, "the trace's SPARC is wrong")
        require(trace["trials"][3]["outcome"] == "miss", "the wobbly trace is not a miss")
        require(len(wall["trials"]) == HAND_TRIALS, "a Paint the wall trial is missing")
        stripes = [trial["target"] for trial in wall["trials"]]
        require(
            stripes == [{"kind": "stripe", "index": n, "target_frac": 0.75} for n in range(4)],
            f"the stripe targets are {stripes}",
        )
        require(wall["trials"][3]["metrics"]["full_sweeps"] == 1, "the last stripe's sweeps differ")

        pick, grip = all_runs[7], all_runs[8]
        require(len(pick["trials"]) == HAND_TRIALS, "a Pick and place trial is missing")
        require(
            pick["trials"][0]["target"] == PICK_PLACE_TARGET,
            f"the pick and place target is {pick['trials'][0]['target']}",
        )
        late = pick["trials"][3]
        require(late["outcome"] == "miss", "the last object is not a miss")
        require(late["metrics"]["drops"] == 2, "the last object's drops differ")
        require(late["metrics"]["transport_ms"] is None, "a missed object has a carry time")
        require(len(grip["trials"]) == HAND_TRIALS, "a Grip and hold trial is missing")
        require(
            grip["trials"][0]["target"] == {"kind": "grip_band", "center": 0.5, "width": 0.3},
            f"the grip band target is {grip['trials'][0]['target']}",
        )
        require(
            all(trial["metrics"]["input_source"] == "keyboard" for trial in grip["trials"]),
            "a hold's input source is missing",
        )
        require(
            grip["trials"][3]["metrics"]["failed_phase"] == "relax",
            "the last hold's failed phase is not relax",
        )

    def session_metrics_exist() -> None:
        url = f"/api/admin/sessions/{state['session_id']}"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        rows = {(row["metric_id"], row["game_id"]): row for row in body["session_metrics"]}
        require(rows.get(("K1", None), {}).get("value") == 2.0, "the reach area metric is missing")
        require(("G1", None) in rows, "the game success rate metric is missing")
        require(rows.get(("P1", None), {}).get("value") == 5, "the pain metric is missing")
        require(("H5", "pick_place") in rows, "Pick and place's transport time is missing")
        require(("H3", "grip_hold") in rows, "Grip and hold's steadiness is missing")
        moving = [run for run in body["games"] if run["game_id"] == "reach_activate"]
        require(
            all(trial["metrics_server"] is not None for run in moving for trial in run["trials"]),
            "a reach trial has no server measures",
        )

    def admin_metrics_table() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/metrics"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(body["mdc_provisional"] is True, "the MDC values are not marked provisional")
        rows = {(row["metric_id"], row["game_id"]): row for row in body["metrics"]}
        area = rows.get(("K1", None))
        require(area is not None and area["latest"] == 2.0, "the table has no reach area")
        # One completed session: nothing can be judged yet.
        require(
            all(row["status"] == "no_baseline" for row in body["metrics"]),
            "a measure has a status without a baseline",
        )

    def session_facts() -> None:
        url = f"/api/sessions/{state['session_id']}/facts"
        response = client.get(url, headers=bearer("patient"))
        facts = expect(response, 200)
        require(facts["patient_code"] == state["patient_code"], "the facts have another code")
        require("Smoke Test" not in response.text, "the facts contain the patient's name")
        require(
            email not in response.text and "@" not in response.text, "the facts contain an email"
        )
        require(facts["safety_notice_present"] is True, "pain 5 did not set the safety notice")
        require(facts["self_report"]["pain_0_10"] == 5, "the facts have no self-report")
        require(len(facts["metrics"]) <= 8, "the facts have more than eight measures")
        next_session = facts["next_session"]
        require(next_session is not None, "the facts have no plan for the next session")
        # Pain 5 in this session: the next plan is the lighter one, with three games.
        planned = next_session["planned_games"]
        require(len(planned) == 3, f"the next plan has {len(planned)} games, not 3")
        expect(client.get(url, headers=bearer("admin")), 200)

    def export_patient_metrics() -> None:
        url = f"/api/admin/patients/{state['patient_id']}/export.csv"
        response = client.get(url, headers=bearer("admin"))
        expect_csv(response)
        lines = response.text.splitlines()
        require(lines[0].startswith("patient_code,session_id,"), "the metrics CSV header is wrong")
        require(len(lines) > 10, f"the metrics CSV has only {len(lines) - 1} rows")
        require(
            all(line.startswith(state["patient_code"] + ",") for line in lines[1:]),
            "a row has another code",
        )
        require(
            "Smoke Test" not in response.text and email not in response.text,
            "the CSV names the patient",
        )

    def export_all_trials() -> None:
        response = client.get("/api/admin/export/trials.csv", headers=bearer("admin"))
        expect_csv(response)
        lines = response.text.splitlines()
        require(
            lines[0].startswith("patient_code,is_demo,session_id,"),
            "the trials CSV header is wrong",
        )
        mine = [line for line in lines[1:] if line.startswith(state["patient_code"] + ",")]
        # 20 trials for each reaching game and 4 for each other game.
        require(len(mine) == 84, f"expected 84 trials of the test patient, got {len(mine)}")
        require(
            "Smoke Test" not in response.text and email not in response.text,
            "the CSV names the patient",
        )

    def expect_csv(response: httpx.Response) -> None:
        require(response.status_code == 200, f"expected 200, got {response.status_code}")
        require(
            response.headers.get("content-type", "").startswith("text/csv"),
            f"the export is {response.headers.get('content-type')}, not CSV",
        )
        require(
            "attachment" in response.headers.get("content-disposition", ""),
            "the export is not a download",
        )

    # The adaptive engine, in a second session so the first stays exactly as checked above.
    def engine_session() -> None:
        body = expect(client.post("/api/sessions", headers=bearer("patient")), 201)
        require(body["id"] != state["session_id"], "the first session was reused")
        state["engine_session_id"] = body["id"]

    def engine_run() -> int:
        url = f"/api/sessions/{state['engine_session_id']}/games"
        payload = {
            "game_id": "reach_activate",
            "engine": "L1",
            "input_source": "keyboard",
            "params_initial": PARAMS["reach_activate"],
            "trials_planned": ENGINE_TRIALS,
        }
        run = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(run["engine"] == "L1", f"the run's engine is {run['engine']}, not L1")
        return int(run["id"])

    def engine_next(run_id: int, last: dict[str, Any] | None) -> dict[str, Any]:
        payload = {"run_id": run_id, "last_trial": last}
        body: dict[str, Any] = expect(
            client.post("/api/engine/next", json=payload, headers=bearer("patient")), 200
        )
        require(1 <= body["level"] <= 10, f"level {body['level']} is outside 1-10")
        return body

    def end_engine_run(run_id: int) -> None:
        end = {"status": "aborted", "score": 0}
        expect(client.post(f"/api/games/{run_id}/end", json=end, headers=bearer("patient")), 200)

    def engine_staircase() -> None:
        """12 successes then 8 reach failures: the level rises, then falls."""
        run_id = engine_run()
        state["engine_run_id"] = run_id
        levels = [engine_next(run_id, None)["level"]]
        for n in range(1, ENGINE_TRIALS + 1):
            success = n <= ENGINE_SUCCESSES
            last = {
                "trial_no": n,
                "outcome": "success" if success else "reach_fail",
                "movement_ms": 900,
            }
            levels.append(engine_next(run_id, last)["level"])
        peak = max(levels[: ENGINE_SUCCESSES + 1])
        require(peak > levels[0], f"the level did not rise: {levels}")
        require(levels[-1] < peak, f"the level did not fall after the failures: {levels}")
        state["engine_levels"] = levels
        end_engine_run(run_id)

    def engine_log_rows() -> None:
        url = f"/api/admin/sessions/{state['engine_session_id']}"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        run = next(run for run in body["games"] if run["id"] == state["engine_run_id"])
        trial_nos = [row["trial_no"] for row in run["adaptation"]]
        # One row at the start of the run (trial 0) and one after each of the 20 trials.
        expected = list(range(ENGINE_TRIALS + 1))
        require(trial_nos == expected, f"logged decisions for trials {trial_nos}")
        require(
            [row["level"] for row in run["adaptation"]] == state["engine_levels"],
            "the logged levels differ from the answers",
        )
        require(all(row["decision"] for row in run["adaptation"]), "a decision has no reason")

    def engine_fatigue_rest() -> None:
        """5 quick successes, then 5 slow failures: the tenth answer asks for a rest."""
        run_id = engine_run()
        engine_next(run_id, None)
        answer: dict[str, Any] = {}
        for n in range(1, 11):
            quick = n <= 5
            last = {
                "trial_no": n,
                "outcome": "success" if quick else "reach_fail",
                "movement_ms": 800 if quick else 1600,
            }
            answer = engine_next(run_id, last)
        require(answer["cue"] == "rest", f"the cue after trial 10 is {answer['cue']}, not rest")
        override = answer["safety_override"] or ""
        require("Signs of tiring" in override, f"no tiring override: {override!r}")
        end_engine_run(run_id)

    def end_engine_session() -> None:
        url = f"/api/sessions/{state['engine_session_id']}/end"
        body = expect(client.post(url, json={"status": "completed"}, headers=bearer("patient")), 200)
        require(body["status"] == "completed", "the second session is not completed")

    # The Bayesian engine (L2) and the planner, in a third session.
    def admin_switches_to_l2() -> None:
        url = f"/api/admin/patients/{state['patient_id']}"
        body = expect(client.patch(url, json={"engine_mode": "L2"}, headers=bearer("admin")), 200)
        require(body["engine_mode"] == "L2", f"engine_mode is {body['engine_mode']}, not L2")

    def plan_with_reasons() -> None:
        body = expect(client.post("/api/sessions", headers=bearer("patient")), 201)
        state["plan_session_id"] = body["id"]
        url = f"/api/sessions/{body['id']}/plan"
        plan = expect(client.get(url, headers=bearer("patient")), 200)
        games = plan["games"]
        require(3 <= len(games) <= 4, f"the plan has {len(games)} games")
        require(all(game["reason_key"] for game in games), "a planned game has no reason")
        require(plan["total_minutes"] > 0, "the plan has no length")
        again = expect(client.get(url, headers=bearer("patient")), 200)
        require(again == plan, "asking again gave a different plan")
        state["planned"] = [game["game_id"] for game in games]

    def plan_override_stored() -> None:
        url = f"/api/sessions/{state['plan_session_id']}/plan/override"
        kept = list(reversed(state["planned"][1:]))
        body = expect(client.post(url, json={"games": kept}, headers=bearer("patient")), 201)
        [entry] = body["overrides"]
        require(entry["removed"] == state["planned"][:1], f"removed {entry['removed']}")
        require(entry["reordered"] is (len(kept) > 1), "the new order was not noticed")

    def l2_run_learns_by_sector() -> None:
        url = f"/api/sessions/{state['plan_session_id']}/games"
        payload = {
            "game_id": "reach_activate",
            "engine": "L0",
            "input_source": "keyboard",
            "params_initial": PARAMS["reach_activate"],
            "trials_planned": L2_TRIALS,
        }
        run = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(run["engine"] == "L2", f"the run's engine is {run['engine']}, not L2")
        answer = engine_next(int(run["id"]), None)
        for n in range(1, L2_TRIALS + 1):
            require(
                isinstance(answer.get("sector"), str) and answer["sector"].startswith("D"),
                f"no sector in the answer: {answer.get('sector')}",
            )
            require(answer["direction_deg"] is not None, "no direction in the answer")
            last = {
                "trial_no": n,
                "outcome": "success" if n % 3 else "reach_fail",
                "movement_ms": 900,
                "direction_deg": answer["direction_deg"],
                "distance_frac": answer["distance_frac"],
            }
            answer = engine_next(int(run["id"]), last)
        end_engine_run(int(run["id"]))
        url = f"/api/admin/sessions/{state['plan_session_id']}"
        detail = expect(client.get(url, headers=bearer("admin")), 200)
        rows = next(item for item in detail["games"] if item["id"] == run["id"])["adaptation"]
        require(len(rows) == L2_TRIALS + 1, f"{len(rows)} decisions logged")
        first = rows[0]["state_after"]["extra"]["sectors"]
        last_beliefs = rows[-1]["state_after"]["extra"]["sectors"]
        changed = [name for name in first if first[name] != last_beliefs.get(name)]
        require(changed, "no sector's belief changed")
        require(all(row["details"] and row["details"]["target"] for row in rows), "a decision has no target")

    def facts_plan_next_session() -> None:
        session_id = state["plan_session_id"]
        facts = expect(client.get(f"/api/sessions/{session_id}/facts", headers=bearer("patient")), 200)
        require(facts["next_session"] is None, "the facts planned ahead before the session ended")
        url = f"/api/sessions/{session_id}/end"
        expect(client.post(url, json={"status": "completed"}, headers=bearer("patient")), 200)
        facts = expect(client.get(f"/api/sessions/{session_id}/facts", headers=bearer("patient")), 200)
        nxt = facts["next_session"]
        require(nxt is not None and nxt["planned_games"], "the facts have no next-session plan")

    def wait_for_report(job_id: int, token: str) -> dict[str, Any]:
        """Polls a report job until it is written (the model, or the template)."""
        deadline = time.monotonic() + REPORT_WAIT_S
        while True:
            body = expect(client.get(f"/api/feedback/jobs/{job_id}", headers=bearer(token)), 200)
            if body["status"] in ("done", "fallback"):
                return dict(body)
            require(body["status"] != "failed", "the report job failed")
            require(time.monotonic() < deadline, f"the report is still {body['status']}")
            time.sleep(0.5)

    def questionnaire_report() -> None:
        # The questionnaire queued it, in the patient's language.
        url = f"/api/sessions/{state['session_id']}/feedback"
        current = expect(client.get(url, headers=bearer("patient")), 200)
        body = wait_for_report(current["job_id"], "patient")
        state["report_id"] = body["job_id"]
        require(body["language"] == "en", f"the report is in {body['language']}")
        require(body["report"]["patient_summary"], "the report has no summary")
        require("therapist_summary" not in body["report"], "the patient got the therapist summary")
        notices = body["safety_notices"]
        require(
            len(notices) == 1 and notices[0].startswith("Please stop practising for today"),
            "pain 5 did not bring the fixed stop notice",
        )
        require(body["meta"]["prompt_version"], "the report has no prompt version")

    def admin_reads_report() -> None:
        url = f"/api/admin/reports/{state['report_id']}"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        require(body["report"]["therapist_summary"], "the admin has no therapist summary")
        require(body["facts"] and body["facts"]["session_no"] >= 1, "the facts snapshot is missing")
        require(body["candidates"] is not None, "the candidates were not stored")
        require(body["superseded"] is False, "the report is marked superseded")
        listed = expect(
            client.get(f"/api/admin/patients/{state['patient_id']}/reports", headers=bearer("admin")),
            200,
        )
        require(state["report_id"] in [item["job_id"] for item in listed], "not in the admin list")

    def patient_lists_and_rates_report() -> None:
        listed = expect(client.get("/api/patient/reports", headers=bearer("patient")), 200)
        require([item["job_id"] for item in listed] == [state["report_id"]], "the list is wrong")
        url = f"/api/feedback/{state['report_id']}/ratings"
        rating = {"rater": "participant", "scores": {"usefulness": 4}, "comment": "Smoke test"}
        body = expect(client.post(url, json=rating, headers=bearer("patient")), 201)
        require(body["scores"] == {"usefulness": 4}, "the rating was not saved as sent")
        again = client.post(url, json=rating, headers=bearer("patient")).status_code
        require(again == 409, f"a second rating got HTTP {again}, not 409")
        ratings = expect(
            client.get(f"/api/admin/reports/{state['report_id']}/ratings", headers=bearer("admin")),
            200,
        )
        require(len(ratings) == 1 and ratings[0]["rater"] == "participant", "admin sees no rating")

    def bangla_report() -> None:
        url = f"/api/sessions/{state['session_id']}/feedback"
        job = expect(client.post(url, json={"language": "bn"}, headers=bearer("patient")), 202)
        body = wait_for_report(job["job_id"], "patient")
        require(body["language"] == "bn", "the report is not in Bangla")
        text = body["report"]["patient_summary"]
        letters = [char for char in text if char.isalpha()]
        bengali = sum(1 for char in letters if "\u0980" <= char <= "\u09ff")
        require(letters and bengali / len(letters) > 0.6, "the summary is not in Bengali script")
        require(body["safety_notices"][0].startswith("অনুগ্রহ করে"), "the notice is not in Bangla")
        # The English report is still the current one in English.
        english = expect(client.get(url, headers=bearer("patient")), 200)
        require(english["job_id"] == state["report_id"], "the English report was replaced")

    def feedback_health() -> None:
        body = expect(client.get("/api/feedback/health", headers=bearer("admin")), 200)
        require(isinstance(body["queue_length"], int), "the health has no queue length")
        require(body["provider"] in ("mock", "ollama"), f"unknown provider {body['provider']}")

    # The muscle sensor, in a fourth session.
    def emg_session() -> None:
        body = expect(client.post("/api/sessions", headers=bearer("patient")), 201)
        state["emg_session_id"] = body["id"]

    def emg_calibration_needs_battery() -> None:
        url = f"/api/sessions/{state['emg_session_id']}/emg-calibration"
        payload = emg_calibration_payload(battery_ok=False)
        expect(client.post(url, json=payload, headers=bearer("patient")), 422)

    def emg_calibration_saved() -> None:
        url = f"/api/sessions/{state['emg_session_id']}/emg-calibration"
        payload = emg_calibration_payload(battery_ok=True)
        body = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(body["threshold_mv"] == 230.0, f"the threshold is {body['threshold_mv']}, not 230")
        require(
            sorted(body["readiness"]) == sorted(EMG_READINESS_CHECKS),
            "the readiness results were not stored",
        )
        latest = expect(
            client.get("/api/patient/emg-calibration/latest", headers=bearer("patient")), 200
        )
        require(latest["id"] == body["id"], "the latest EMG calibration is another one")

    def emg_grip_hold_run() -> None:
        url = f"/api/sessions/{state['emg_session_id']}/games"
        payload = {
            "game_id": "grip_hold",
            "engine": "L0",
            "input_source": "emg",
            "params_initial": GRIP_HOLD_PARAMS,
            "trials_planned": len(EMG_PEAKS),
        }
        run = expect(client.post(url, json=payload, headers=bearer("patient")), 201)
        require(run["input_source"] == "emg", f"the run's input is {run['input_source']}")
        trials = [emg_grip_trial(n) for n in range(1, len(EMG_PEAKS) + 1)]
        url = f"/api/games/{run['id']}/trials"
        body = expect(client.post(url, json=trials, headers=bearer("patient")), 200)
        require(body["trials_done"] == len(EMG_PEAKS), f"trials_done is {body['trials_done']}")
        summary = function_summary("grip_hold", trials)
        end = {"status": "completed", "score": 100 * summary["successes"], "summary": summary}
        url = f"/api/games/{run['id']}/end"
        expect(client.post(url, json=end, headers=bearer("patient")), 200)
        url = f"/api/sessions/{state['emg_session_id']}/end"
        body = expect(client.post(url, json={"status": "completed"}, headers=bearer("patient")), 200)
        require(body["status"] == "completed", "the muscle-sensor session is not completed")

    def emg_session_metrics() -> None:
        url = f"/api/admin/sessions/{state['emg_session_id']}"
        body = expect(client.get(url, headers=bearer("admin")), 200)
        calibration = body["emg_calibration"]
        require(calibration is not None, "the session detail has no EMG calibration")
        require(calibration["mvc_mv"] == EMG_MVC_MV, "the session detail has another MVC")
        trials = [trial for run in body["games"] for trial in run["trials"]]
        require(
            all(trial["emg"] and len(trial["emg"]["trace"]) == 250 for trial in trials),
            "a trial lost its %MVC trace",
        )
        rows = {(row["metric_id"], row["game_id"]): row for row in body["session_metrics"]}
        for key in (
            ("E2", None),
            ("E3", "grip_hold"),
            ("E5", "grip_hold"),
            ("E6", "grip_hold"),
            ("E8", "grip_hold"),
            ("E9", None),
        ):
            require(key in rows, f"the session metrics have no {key[0]}")
        require(rows[("E2", None)]["value"] == EMG_MVC_MV, "E2 is not the calibration's MVC")
        require(rows[("E3", "grip_hold")]["value"] == 0.75, "E3 is not 3 of 4")
        require(abs(rows[("E9", None)]["value"] + 5.0) < 1e-6, "E9 is not -5 %MVC per trial")

    def emg_session_facts() -> None:
        url = f"/api/sessions/{state['emg_session_id']}/facts"
        response = client.get(url, headers=bearer("patient"))
        facts = expect(response, 200)
        ids = {metric["id"] for metric in facts["metrics"]}
        require(len(facts["metrics"]) <= 8, "the facts have more than eight measures")
        require({"E2", "E5"} <= ids, f"the facts have no EMG measures: {sorted(ids)}")
        require("Smoke Test" not in response.text, "the facts contain the patient's name")
        require("\"trace\":" not in response.text, "the facts contain an EMG trace")

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
        ("Admin turns Bloom off and changes a Grip and hold default", admin_changes_game_settings),
        ("Patient's game settings follow the admin's", patient_settings_follow),
        ("Admin puts both games' settings back", admin_restores_game_settings),
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
            (
                f"Patient plays a {game_id} run with non-spatial targets",
                partial(play_unplaced_game, game_id),
            )
            for game_id in UNPLACED_GAME_IDS
        ],
        ("Dashboard shows the last session's nine games", dashboard_last_games),
        ("Patient sends the cool-down with pain 5 and gets the pain flag", cooldown_with_pain),
        ("Patient ends the session", end_session),
        ("Patient reads the session summary", session_summary),
        ("Patient reads their progress", patient_progress),
        ("Admin lists the patient's sessions", admin_lists_sessions),
        ("Admin lists the patient's calibrations", admin_lists_calibrations),
        ("Admin reads the patient's warm-up history", admin_reads_warmup_history),
        ("Admin reads the full session detail", admin_reads_session_detail),
        ("The session's metrics were computed when it ended", session_metrics_exist),
        ("Admin reads the patient's metrics table", admin_metrics_table),
        ("Patient reads the session facts, with no name or email", session_facts),
        ("The questionnaire's report is written, with the fixed stop notice", questionnaire_report),
        ("Admin reads the report, its facts snapshot and the list", admin_reads_report),
        ("Patient lists the report and rates it once", patient_lists_and_rates_report),
        ("A Bangla report is written in Bangla", bangla_report),
        ("Feedback health answers", feedback_health),
        ("Admin downloads the patient's metrics CSV", export_patient_metrics),
        ("Admin downloads all trials as CSV", export_all_trials),
        ("Admin sees the pain alert", admin_sees_alert),
        ("Admin marks the alert reviewed", admin_reviews_alert),
        ("Patient starts a second session for the adaptive engine", engine_session),
        ("Engine: 12 successes raise the level, 8 failures lower it", engine_staircase),
        ("Engine: a decision is logged at the start and after each trial", engine_log_rows),
        ("Engine: quick successes then slow failures ask for a rest", engine_fatigue_rest),
        ("Patient ends the second session", end_engine_session),
        ("Admin switches the patient to the Bayesian engine (L2)", admin_switches_to_l2),
        ("Patient gets today's plan, with a reason for each game", plan_with_reasons),
        ("Patient's change to the plan is stored", plan_override_stored),
        ("L2: a run returns sectors and its beliefs update", l2_run_learns_by_sector),
        ("Facts plan the next session once this one ends", facts_plan_next_session),
        ("Patient starts a fourth session, with the muscle sensor", emg_session),
        ("A real sensor's calibration on mains power is refused", emg_calibration_needs_battery),
        ("Patient saves an EMG calibration with its readiness results", emg_calibration_saved),
        ("Patient plays Grip and hold with input_source emg and EMG data", emg_grip_hold_run),
        ("The session metrics hold E2, E3, E5, E6, E8 and E9", emg_session_metrics),
        ("The session facts hold the EMG measures, without traces", emg_session_facts),
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
