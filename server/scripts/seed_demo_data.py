"""Create two demo patients with two weeks of synthetic sessions, for showing the dashboards.

Run from server/ with the virtual environment active:

    python scripts/seed_demo_data.py          # remove old demo patients, then create them again
    python scripts/seed_demo_data.py --clear  # only remove demo patients and all their data

Only patients marked is_demo are ever removed. The data comes from a fixed random seed, so it is
the same every time; only the dates follow today's date and the passwords are new on every run.

Demo Rahim (left side affected) improves steadily. Demo Salma (right side affected) improves more
slowly and has one unreviewed pain alert. Every session plays the three reaching games and the
two hand games, Bloom and Finger piano.
"""

import argparse
import math
import random
import secrets
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Delete, delete
from sqlmodel import Session, col, select

from app.core.db import create_db_and_tables, engine
from app.models import (
    Calibration,
    GameRun,
    PatientProfile,
    SessionFeedback,
    Trial,
    User,
    WarmupResult,
)
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import Side
from app.schemas.game import GameSummary, TrialCreate
from app.schemas.patient import PatientCreate
from app.schemas.session import DIRECTIONS_DEG, CalibrationCreate
from app.schemas.session_feedback import SessionFeedbackCreate
from app.schemas.warmup import ExerciseId, WarmupResultCreate
from app.services import safety
from app.services.patients import create_patient

SEED = 20261110
TRIALS_PER_GAME = 20
REACH_GAMES = ("reach_activate", "balloon_pop", "fruit_catch")
HAND_GAMES = ("bloom", "finger_piano")
MOVEMENT_GAMES = ("path_trace", "paint_wall")
GAMES = REACH_GAMES + HAND_GAMES + MOVEMENT_GAMES
GameName = Literal[
    "reach_activate",
    "balloon_pop",
    "fruit_catch",
    "bloom",
    "finger_piano",
    "path_trace",
    "paint_wall",
]
#: Trials in one run of each game, as in the games: 15 flowers, 12 melodies, 10 traces, 8 stripes.
TRIAL_COUNTS: dict[str, int] = {
    "reach_activate": TRIALS_PER_GAME,
    "balloon_pop": TRIALS_PER_GAME,
    "fruit_catch": TRIALS_PER_GAME,
    "bloom": 15,
    "finger_piano": 12,
    "path_trace": 10,
    "paint_wall": 8,
}
# The hand rests low and close to the body before each reach, in the body frame.
REST_POINT = (0.15, -0.85)
TRAJECTORY_POINTS = 12


@dataclass(frozen=True)
class DemoPatient:
    email: str
    full_name: str
    affected_side: Side
    dominant_side: Side
    age_band: Literal["50-59", "60-69"]
    months_since_stroke: int
    #: Days before today on which a session was completed, oldest first.
    days_ago: tuple[int, ...]
    #: How much better the last session is than the first, 0 to 1.
    improvement: float
    #: The session index with a pain score of 5, which raises an unreviewed alert.
    pain_session: int | None = None


DEMO_PATIENTS = (
    DemoPatient(
        email="demo.rahim@example.com",
        full_name="Demo Rahim",
        affected_side="left",
        dominant_side="right",
        age_band="60-69",
        months_since_stroke=5,
        days_ago=(13, 11, 9, 8, 6, 4, 2, 0),
        improvement=1.0,
    ),
    DemoPatient(
        email="demo.salma@example.com",
        full_name="Demo Salma",
        affected_side="right",
        dominant_side="right",
        age_band="50-59",
        months_since_stroke=9,
        days_ago=(13, 10, 8, 5, 3, 1),
        improvement=0.4,
        pain_session=3,
    ),
)


def lerp(start: float, end: float, share: float) -> float:
    return start + (end - start) * share


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


# Calibration


#: Reach in shoulder widths per direction (0 is outward, 90 up, 180 across, 270 down) at the start.
BASE_RADII = (1.0, 0.9, 0.8, 0.65, 0.55, 0.5, 0.6, 0.85)


def convex_hull(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    """Andrew's monotone chain, counter-clockwise, without repeated end points."""
    ordered = sorted(set(points))
    if len(ordered) <= 2:
        return ordered

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def polygon_area(points: Sequence[tuple[float, float]]) -> float:
    total = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def make_calibration(
    rng: random.Random, side: Side, progress: float, improvement: float
) -> CalibrationCreate:
    """Reach grows by up to 22% across the sessions for full improvement, with a little noise."""
    growth = 1 + 0.22 * improvement * progress
    radii = [
        round(clamp(base * growth + rng.uniform(-0.03, 0.03), 0.2, 3.0), 3) for base in BASE_RADII
    ]
    points = [
        (
            round(radius * math.cos(math.radians(degrees)), 4),
            round(radius * math.sin(math.radians(degrees)), 4),
        )
        for radius, degrees in zip(radii, DIRECTIONS_DEG, strict=True)
    ]
    hull = convex_hull(points)
    valid = [True] * len(DIRECTIONS_DEG)
    # Now and then one direction could not be measured cleanly.
    if rng.random() < 0.2:
        valid[rng.randrange(len(valid))] = False
    return CalibrationCreate(
        affected_side=side,
        shoulder_width_px=round(rng.uniform(170, 190), 1),
        directions_deg=list(DIRECTIONS_DEG),
        reach_radii_sw=radii,
        reach_points_sw=points,
        hull_sw=hull,
        hull_area_sw2=round(polygon_area(hull), 4),
        quality={
            "valid": valid,
            "retries": rng.choice((0, 0, 0, 1)),
            "max_trunk_displacement_sw": round(rng.uniform(0.02, 0.09), 3),
        },
    )


# Warm-up, mirroring web/src/warmup/exercises.ts and personalise.ts


@dataclass(frozen=True)
class ExerciseSpec:
    exercise_id: ExerciseId
    unit: Literal["deg", "arm_ratio", "palm_ratio"]
    #: "up": a rep must reach high; "down": a rep must reach low.
    direction: Literal["up", "down"]
    standard: tuple[float, float]
    gentle: tuple[float, float]
    target_reps: int
    step: float
    #: The gap kept between the two lines when the target moves.
    gap: float
    hand: bool = False
    sequence: bool = False


EXERCISES = (
    ExerciseSpec("shoulder_flexion", "deg", "up", (30, 90), (30, 60), 10, 5, 25),
    ExerciseSpec("shoulder_abduction", "deg", "up", (30, 80), (30, 50), 10, 5, 25),
    ExerciseSpec("elbow_flexion", "deg", "down", (70, 140), (90, 125), 10, 5, 25),
    ExerciseSpec("forward_reach", "arm_ratio", "up", (0.45, 0.8), (0.4, 0.65), 10, 0.05, 0.2),
    ExerciseSpec(
        "hand_open_close", "palm_ratio", "up", (1.2, 1.6), (1.15, 1.45), 10, 0.05, 0.2, hand=True
    ),
    ExerciseSpec(
        "thumb_opposition",
        "palm_ratio",
        "down",
        (0.25, 0.4),
        (0.35, 0.5),
        5,
        0.03,
        0.15,
        hand=True,
        sequence=True,
    ),
)
RAISE_SUCCESS = 0.9
RAISE_MAX_COMPENSATION = 0.2
LOWER_SUCCESS = 0.6
LOWER_COMPENSATION = 0.3
MAX_PAST_STANDARD = 0.15


@dataclass
class ExerciseHistory:
    """What the next session's personal target is worked out from."""

    full_reps: int
    target_reps: int
    compensation_rate: float
    target: float
    best_peak: float | None


def target_of(spec: ExerciseSpec, thresholds: tuple[float, float]) -> float:
    return thresholds[1] if spec.direction == "up" else thresholds[0]


def thresholds_for(spec: ExerciseSpec, target: float) -> tuple[float, float]:
    low, high = spec.standard
    if spec.sequence:
        return round(target, 3), round(target + (high - low), 3)
    if spec.direction == "up":
        return round(min(low, target - spec.gap), 3), round(target, 3)
    return round(target, 3), round(max(high, target + spec.gap), 3)


def next_target(spec: ExerciseSpec, last: ExerciseHistory) -> tuple[float, str]:
    """Today's target and the saved reason, as the web app's personaliseThresholds works it out."""
    success = last.full_reps / last.target_reps if last.target_reps else 0
    change, word = 0, "kept"
    if success >= RAISE_SUCCESS and last.compensation_rate < RAISE_MAX_COMPENSATION:
        change, word = 1, "raised"
    elif last.compensation_rate > LOWER_COMPENSATION:
        change, word = -1, "lowered for compensation"
    elif success < LOWER_SUCCESS:
        change, word = -1, "lowered"

    sign = 1 if spec.direction == "up" else -1
    difficulty = sign * last.target + change * spec.step
    standard_target = target_of(spec, spec.standard)
    hardest = sign * standard_target * (1 + sign * MAX_PAST_STANDARD)
    easiest = sign * target_of(spec, spec.gentle)
    limit = ""
    if last.best_peak is not None and difficulty > sign * last.best_peak + spec.step:
        difficulty, limit = sign * last.best_peak + spec.step, "best peak"
    if difficulty > hardest:
        difficulty, limit = hardest, "standard max"
    if difficulty < easiest:
        difficulty, limit = easiest, "gentle floor"
    target = round(sign * difficulty, 3)
    moved = (target > last.target) - (target < last.target)
    if limit and moved * sign != change:
        word = "adjusted"
    percent = round(last.compensation_rate * 100)
    suffix = f"; limited by {limit}" if limit else ""
    reason = f"{word}: {last.full_reps}/{last.target_reps} reps, {percent}% compensated{suffix}"
    return target, reason


def make_warmup_result(
    rng: random.Random,
    spec: ExerciseSpec,
    progress: float,
    improvement: float,
    last: ExerciseHistory | None,
) -> tuple[WarmupResultCreate, ExerciseHistory]:
    """One exercise: more full reps and less compensation as the sessions go on."""
    if last is None:
        target = target_of(spec, spec.standard)
        personalisation = {
            "previous_high": None,
            "new_high": target,
            "reason": "first time: standard target",
        }
        preset = "standard"
    else:
        target, reason = next_target(spec, last)
        personalisation = {"previous_high": last.target, "new_high": target, "reason": reason}
        preset = "personal"
    thresholds = thresholds_for(spec, target)

    success = clamp(lerp(0.65, 0.65 + 0.35 * improvement, progress) + rng.uniform(-0.1, 0.1), 0, 1)
    full_reps = round(spec.target_reps * success)
    partial_reps = rng.randint(0, 2) if full_reps < spec.target_reps else rng.randint(0, 1)
    compensation = clamp(
        lerp(0.32, 0.32 - 0.24 * improvement, progress) + rng.uniform(-0.05, 0.05), 0, 1
    )

    sign = 1 if spec.direction == "up" else -1
    margin = spec.step * 1.5
    reps: list[dict[str, Any]] = []
    for index in range(1, full_reps + partial_reps + 1):
        full = index <= full_reps
        # Full reps go past the target; partial ones stop short of it.
        offset = rng.uniform(0, margin) if full else -rng.uniform(spec.step * 0.3, margin * 1.5)
        peak = round(target + sign * offset, 3)
        compensated = rng.random() < compensation
        reps.append(
            {
                "index": index,
                "peak": peak,
                "duration_ms": round(rng.uniform(1600, 3200) - 600 * progress * improvement),
                "compensated": compensated,
                "compensation_type": ("trunk_lean" if not spec.hand else None)
                if compensated
                else None,
            }
        )
    # Keep the order a session would have: full and partial reps mixed.
    rng.shuffle(reps)
    for index, rep in enumerate(reps, start=1):
        rep["index"] = index
    peaks = [rep["peak"] for rep in reps]
    best_peak = (max(peaks) if sign > 0 else min(peaks)) if peaks else None
    compensated_reps = sum(1 for rep in reps if rep["compensated"])
    full_durations = [rep["duration_ms"] for rep in reps if sign * (rep["peak"] - target) >= 0]

    result = WarmupResultCreate.model_validate(
        {
            "exercise_id": spec.exercise_id,
            "preset": preset,
            "thresholds": {"low": thresholds[0], "high": thresholds[1], "unit": spec.unit},
            "personalisation": personalisation,
            "full_reps": full_reps,
            "partial_reps": partial_reps,
            "target_reps": spec.target_reps,
            "best_peak": best_peak,
            "mean_duration_ms": (
                round(sum(full_durations) / len(full_durations)) if full_durations else None
            ),
            "active_time_ms": round(sum(rep["duration_ms"] for rep in reps) + 8000),
            "paused_time_ms": rng.choice((0, 0, 0, 2500)),
            "measure_source": "2d" if spec.hand else "3d",
            "trunk_reference": "n/a" if spec.hand else "hip",
            "compensated_reps": compensated_reps,
            "compensation_rate": round(compensated_reps / len(reps), 3) if reps else 0.0,
            "reps": reps,
            "skipped": False,
        }
    )
    history = ExerciseHistory(
        full_reps=full_reps,
        target_reps=spec.target_reps,
        compensation_rate=result.compensation_rate,
        target=target,
        best_peak=best_peak,
    )
    return result, history


def make_warmup(
    rng: random.Random,
    progress: float,
    improvement: float,
    histories: dict[ExerciseId, ExerciseHistory],
) -> list[WarmupResultCreate]:
    """All six exercises. Updates `histories` for the next session."""
    results: list[WarmupResultCreate] = []
    for spec in EXERCISES:
        result, history = make_warmup_result(
            rng, spec, progress, improvement, histories.get(spec.exercise_id)
        )
        histories[spec.exercise_id] = history
        results.append(result)
    return results


# Games


def ring_for(distance_frac: float) -> int:
    if distance_frac < 0.55:
        return 1
    return 2 if distance_frac <= 0.85 else 3


def trajectory(
    rng: random.Random, start: tuple[float, float], end: tuple[float, float], duration_ms: float
) -> list[tuple[float, float, float]]:
    """A short, slightly curved, slightly wobbly path: [t_ms, x_sw, y_sw]."""
    bend = rng.uniform(-0.12, 0.12)
    points: list[tuple[float, float, float]] = []
    for index in range(TRAJECTORY_POINTS):
        share = index / (TRAJECTORY_POINTS - 1)
        # Slow at both ends, like a real reach.
        eased = 0.5 - 0.5 * math.cos(math.pi * share)
        x = lerp(start[0], end[0], eased) + bend * math.sin(math.pi * share)
        y = lerp(start[1], end[1], eased) + rng.uniform(-0.015, 0.015)
        points.append((round(duration_ms * share), round(x, 4), round(y, 4)))
    return points


@dataclass(frozen=True)
class GameSkill:
    """How well the patient plays at this point in their sessions."""

    success: float
    movement_ms: float
    efficiency: float
    compensation: float
    #: Bloom: the usual peak openness, from 0 (fist) to 1 (fully open).
    openness: float
    #: Bloom: the usual wobble of openness while holding the hand open (standard deviation).
    hold_sd: float
    #: Bloom: the usual time from the bud appearing to holding the hand open, in ms.
    open_ms: float
    #: Finger piano: the chance of playing a note with the right finger in time.
    note_hit: float
    #: Finger piano: the usual |touch - arrival| of a note played, in ms.
    timing_error_ms: float
    #: Path trace: the usual share of a trace inside the corridor, in %.
    in_corridor_pct: float
    #: Path trace: the usual smoothness of the fingertip (SPARC, closer to 0 is smoother).
    trace_sparc: float
    #: Paint the wall: the usual elbow range reached in a stripe, in degrees.
    elbow_range_deg: float
    #: Paint the wall: the usual smoothness of the elbow (SPARC of its angular speed).
    elbow_sparc: float


def skill_at(progress: float, improvement: float) -> GameSkill:
    gain = progress * improvement
    return GameSkill(
        success=lerp(0.6, 0.92, gain),
        movement_ms=lerp(2300, 1350, gain),
        efficiency=lerp(0.62, 0.86, gain),
        compensation=lerp(0.28, 0.07, gain),
        openness=lerp(0.77, 0.9, gain),
        hold_sd=lerp(0.07, 0.025, gain),
        open_ms=lerp(2800, 1300, gain),
        note_hit=lerp(0.62, 0.9, gain),
        timing_error_ms=lerp(330, 170, gain),
        in_corridor_pct=lerp(68, 92, gain),
        trace_sparc=lerp(-2.3, -1.55, gain),
        elbow_range_deg=lerp(54, 82, gain),
        elbow_sparc=lerp(-2.6, -1.8, gain),
    )


def _compensation(rng: random.Random, skill: GameSkill) -> dict[str, Any]:
    if rng.random() >= skill.compensation:
        return {"flagged": False, "type": None, "max_values": {}}
    kind = rng.choice(("trunk_lean", "trunk_shift", "shoulder_hike"))
    return {"flagged": True, "type": kind, "max_values": {kind: round(rng.uniform(0.1, 0.2), 3)}}


def make_reach_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    index = rng.randrange(len(DIRECTIONS_DEG))
    degrees = DIRECTIONS_DEG[index]
    distance = round(rng.uniform(0.45, 0.9), 2)
    radius = radii[index] * distance
    target = (
        round(radius * math.cos(math.radians(degrees)), 4),
        round(radius * math.sin(math.radians(degrees)), 4),
    )
    roll = rng.random()
    # Of the failures, most do not reach the target and the rest reach it but do not squeeze.
    if roll < skill.success:
        outcome = "success"
    elif roll < skill.success + (1 - skill.success) * 0.6:
        outcome = "reach_fail"
    else:
        outcome = "activation_fail"
    reaction = round(rng.uniform(380, 700))
    movement = round(skill.movement_ms * rng.uniform(0.8, 1.25))
    reached = outcome != "reach_fail"
    end_point = target if reached else (target[0] * 0.75, target[1] * 0.75)
    path = trajectory(rng, REST_POINT, end_point, reaction + movement)
    straight = math.dist(REST_POINT, end_point)
    efficiency = round(clamp(skill.efficiency + rng.uniform(-0.08, 0.06), 0.3, 1), 4)
    enter = reaction + movement if reached else None
    dwell = enter + 300 if enter is not None else None
    squeeze = round(rng.uniform(250, 700)) if outcome == "success" else None
    activation_done = dwell + squeeze if dwell is not None and squeeze is not None else None
    end = activation_done or (dwell + 4000 if dwell is not None else 6000)
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {
                "distance_frac": distance,
                "target_radius_sw": 0.25,
                "demand": 0.5,
                "hold_ms": 400,
            },
            "target": {
                "x_sw": target[0],
                "y_sw": target[1],
                "radius_sw": 0.25,
                "direction_deg": degrees,
                "distance_frac": distance,
                "sector": f"D{index}R{ring_for(distance)}",
            },
            "outcome": outcome,
            "timings": {
                "spawn": 0,
                "move_onset": reaction,
                "enter": enter,
                "dwell_done": dwell,
                "activation_start": dwell,
                "activation_done": activation_done,
                "end": end,
            },
            "metrics": {
                "reaction_ms": reaction,
                "movement_ms": movement if reached else None,
                "path_length_sw": round(straight / efficiency, 4),
                "straight_dist_sw": round(straight, 4),
                "path_efficiency": efficiency,
                "peak_speed_sw_s": round(straight / (movement / 1000) * 1.8, 4),
                "activation_latency_ms": squeeze,
                "activation_peak": round(rng.uniform(0.55, 0.95), 3) if dwell else None,
            },
            "compensation": _compensation(rng, skill),
            "trajectory": path,
        }
    )


def make_balloon_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    # Balloons float up outward, straight up or across: directions 45, 90 and 135 degrees.
    index = rng.choice((1, 2, 3))
    degrees = DIRECTIONS_DEG[index]
    height = round(rng.uniform(0.4, 0.95), 2)
    radius = radii[index] * height
    target = (
        round(radius * math.cos(math.radians(degrees)), 4),
        round(radius * math.sin(math.radians(degrees)), 4),
    )
    outcome = "success" if rng.random() < skill.success else "miss"
    reaction = round(rng.uniform(350, 650))
    movement = round(skill.movement_ms * rng.uniform(0.85, 1.2))
    popped = outcome == "success"
    end_point = target if popped else (target[0] * 0.7, target[1] * 0.7)
    straight = math.dist(REST_POINT, end_point)
    efficiency = round(clamp(skill.efficiency + rng.uniform(-0.07, 0.06), 0.3, 1), 4)
    touch = reaction + movement if popped else None
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {"height_frac": height, "balloon_radius_sw": 0.22, "rise_ms": 1800},
            "target": {
                "x_sw": target[0],
                "y_sw": target[1],
                "radius_sw": 0.22,
                "direction_deg": degrees,
                "distance_frac": height,
                "sector": f"D{index}R{ring_for(height)}",
            },
            "outcome": outcome,
            "timings": {
                "spawn": 0,
                "move_onset": reaction,
                "enter": touch,
                "end": touch if touch is not None else 1800 + 4000,
            },
            "metrics": {
                "reaction_ms": reaction,
                "movement_ms": movement if popped else None,
                "path_length_sw": round(straight / efficiency, 4),
                "straight_dist_sw": round(straight, 4),
                "path_efficiency": efficiency,
                "peak_speed_sw_s": round(straight / (movement / 1000) * 1.8, 4),
                "peak_arm_elevation_deg": round(
                    clamp(40 + 110 * height + rng.uniform(-8, 8), 0, 180), 1
                ),
            },
            "compensation": _compensation(rng, skill),
            "trajectory": trajectory(rng, REST_POINT, end_point, reaction + movement),
        }
    )


BASKET_LINE_Y_SW = -0.3
FRUIT_RADIUS_SW = 0.13


def make_fruit_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    side = "out" if rng.random() < 0.6 else "across"
    reach = radii[0] if side == "out" else radii[4]
    share = round(rng.uniform(0.3, 0.9), 3)
    x = round(share * reach * (1 if side == "out" else -1), 4)
    outcome = "success" if rng.random() < skill.success else "miss"
    reaction = round(rng.uniform(300, 600))
    movement = round(skill.movement_ms * 0.8 * rng.uniform(0.85, 1.2))
    start = (0.0, BASKET_LINE_Y_SW)
    caught = outcome == "success"
    end_x = x if caught else x * 0.7
    distance = abs(x)
    efficiency = round(clamp(skill.efficiency + rng.uniform(-0.06, 0.06), 0.3, 1), 4)
    straight = abs(end_x)
    under = reaction + movement if caught else None
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {"fall_speed_sw_s": 0.45, "basket_width_sw": 0.35, "target_side": side},
            "target": {
                "x_sw": x,
                "y_sw": BASKET_LINE_Y_SW,
                "radius_sw": FRUIT_RADIUS_SW,
                "direction_deg": 0 if side == "out" else 180,
                "distance_frac": share,
                "sector": f"D{0 if side == 'out' else 4}R{ring_for(share)}",
            },
            "outcome": outcome,
            "timings": {
                "spawn": 0,
                "move_onset": reaction,
                "enter": under,
                "end": (under or reaction + movement) + 400,
            },
            "metrics": {
                "reaction_ms": reaction,
                "movement_ms": movement if caught else None,
                "path_length_sw": round(straight / efficiency, 4),
                "straight_dist_sw": round(straight, 4),
                "path_efficiency": efficiency,
                "peak_speed_sw_s": round(straight / (movement / 1000) * 1.8, 4),
                "lateral_distance_sw": round(distance, 4),
                "lateral_path_efficiency": efficiency,
                "overshoot_sw": round(rng.uniform(0, 0.08), 4),
                "side": side,
            },
            "compensation": _compensation(rng, skill),
            "trajectory": trajectory(rng, start, (end_x, BASKET_LINE_Y_SW), reaction + movement),
        }
    )


# Hand games: the hand only has to be visible, so they have no place and no trajectory.

BLOOM_PARAMS = {
    "open_demand": 0.7,
    "open_hold_ms": 800,
    "close_demand": 0.6,
    "phase_time_limit_ms": 8000,
    "close_hold_ms": 300,
    "rest_ms": 1500,
}
BLOOM_SHOW_MS = 1000
FINGERS = ("index", "middle", "ring", "little")
PIANO_PREVIEW_MS = 2000
PIANO_FALL_MS = 3000
PIANO_INTERVAL_MS = 2000
PIANO_WINDOW_MS = 1200
#: A melody counts as played well from this share of its notes, as in the game.
PIANO_SUCCESS_RATE = 0.75


def _trunk_only(rng: random.Random, skill: GameSkill) -> dict[str, Any]:
    """Hand games check the trunk only, and patients move it less than when reaching."""
    if rng.random() >= skill.compensation / 2:
        return {"flagged": False, "type": None, "max_values": {}}
    moved = round(rng.uniform(0.15, 0.22), 3)
    return {"flagged": True, "type": "trunk", "max_values": {"trunk_displacement_sw": moved}}


def make_bloom_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    """One flower: open the hand and hold it (bloom), then make a fist (collect the seed)."""
    del radii  # The hand only has to be visible.
    demand = BLOOM_PARAMS["open_demand"]
    limit = BLOOM_PARAMS["phase_time_limit_ms"]
    peak = round(clamp(skill.openness + rng.uniform(-0.1, 0.06), 0.3, 1), 3)
    opened = peak >= demand + 0.02 and rng.random() < 0.95
    closed = opened and rng.random() < skill.success + 0.05
    metrics: dict[str, Any] = {"peak_openness": peak}
    timings: dict[str, Any] = {"spawn": 0}
    if not opened:
        rise = peak / (limit / 1000 * rng.uniform(0.4, 0.7))
        metrics |= {"openness_rise_rate": round(rise, 3), "failed_phase": "open"}
        timings["end"] = limit
    else:
        to_open = round(skill.open_ms * rng.uniform(0.8, 1.25))
        close_start = to_open + BLOOM_PARAMS["open_hold_ms"] + BLOOM_SHOW_MS
        metrics |= {
            "time_to_open_ms": to_open,
            "hold_stability": round(skill.hold_sd * rng.uniform(0.7, 1.3), 4),
            "openness_rise_rate": round(demand / (to_open / 1000 * rng.uniform(0.5, 0.8)), 3),
        }
        if closed:
            to_close = round(rng.uniform(450, 1400))
            grip = round(rng.uniform(0.66, 0.95), 3)
            done = close_start + to_close + BLOOM_PARAMS["close_hold_ms"]
            metrics |= {
                "time_to_close_ms": to_close,
                "peak_grip": grip,
                "activation_latency_ms": to_close,
                "activation_peak": grip,
                "failed_phase": None,
            }
            timings |= {
                "activation_start": close_start + to_close,
                "activation_done": done,
                "end": done,
            }
        else:
            grip = round(rng.uniform(0.3, 0.55), 3)
            metrics |= {"peak_grip": grip, "activation_peak": grip, "failed_phase": "close"}
            timings["end"] = close_start + limit
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": BLOOM_PARAMS,
            "target": {"kind": "bloom"},
            "outcome": "success" if closed else "miss",
            "timings": timings,
            "metrics": metrics,
            "compensation": _trunk_only(rng, skill),
            "trajectory": [],
        }
    )


def make_melody(rng: random.Random, length: int) -> list[str]:
    """Every finger once, then steps to a neighbour, never three of a finger in a row."""
    melody = list(FINGERS)
    rng.shuffle(melody)
    while len(melody) < length:
        at = FINGERS.index(melody[-1])
        options = [FINGERS[i] for i in (at - 1, at + 1) if 0 <= i < len(FINGERS)]
        if melody[-2:] == [melody[-1]] * 2:
            options = [finger for finger in options if finger != melody[-1]]
        melody.append(rng.choice(options))
    return melody[:length]


def make_piano_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    """One melody: each note is played with the right finger in time, a wrong finger, or missed."""
    del radii  # The hand only has to be visible.
    # Longer melodies once the patient plays well.
    length = 5 if skill.note_hit >= 0.8 else 4
    melody = make_melody(rng, length)
    per_finger: dict[str, dict[str, int]] = {}
    hits = wrong = missed = 0
    errors: list[float] = []
    for finger in melody:
        tally = per_finger.setdefault(finger, {"hits": 0, "attempts": 0})
        tally["attempts"] += 1
        # The little and ring fingers are harder to reach with the thumb.
        ease = {"index": 0.06, "middle": 0.03, "ring": -0.03, "little": -0.07}[finger]
        roll = rng.random()
        if roll < clamp(skill.note_hit + ease, 0, 1):
            hits += 1
            tally["hits"] += 1
            errors.append(skill.timing_error_ms * rng.uniform(0.4, 1.6))
        elif rng.random() < 0.45:
            wrong += 1
        else:
            missed += 1
    rate = hits / length
    end = PIANO_PREVIEW_MS + PIANO_FALL_MS + (length - 1) * PIANO_INTERVAL_MS + PIANO_WINDOW_MS / 2
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {
                "finger_count": 4,
                "sequence_length": length,
                "note_interval_ms": PIANO_INTERVAL_MS,
                "hit_window_ms": PIANO_WINDOW_MS,
                "touch_threshold": 0.3,
                "preview_ms": PIANO_PREVIEW_MS,
                "rest_ms": 1500,
                **{f"note_{i + 1}": FINGERS.index(finger) for i, finger in enumerate(melody)},
            },
            "target": {"kind": "sequence", "notes": melody},
            "outcome": "success" if rate >= PIANO_SUCCESS_RATE else "miss",
            "timings": {"spawn": 0, "end": end},
            "metrics": {
                "notes_total": length,
                "hits": hits,
                "wrong_finger": wrong,
                "missed": missed,
                "hit_rate": round(rate, 4),
                "mean_timing_error_ms": round(sum(errors) / len(errors)) if errors else None,
                "per_finger": per_finger,
            },
            "compensation": _trunk_only(rng, skill),
            "trajectory": [],
        }
    )


# Movement-quality games.

PATH_SHAPES = ("line", "arc", "s_curve", "circle_part")
PATH_POINTS = 60
GUIDE_SPEED_SW_S = 0.25
CORRIDOR_WIDTH_SW = 0.4
START_HOLD_MS = 500


def path_points(shape: str, outward: bool) -> list[tuple[float, float]]:
    """One of the four path shapes, about 1 SW long, across the middle of a typical reach."""
    points: list[tuple[float, float]] = []
    for index in range(PATH_POINTS):
        share = index / (PATH_POINTS - 1)
        if shape == "line":
            x, y = -0.5 + share, -0.15 + 0.3 * share
        elif shape == "arc":
            angle = math.radians(210 - 240 * share)
            x, y = 0.55 * math.cos(angle), 0.55 * math.sin(angle) - 0.2
        elif shape == "s_curve":
            x, y = -0.5 + share, 0.25 * math.sin(2 * math.pi * share)
        else:
            angle = 1.5 * math.pi * share
            x, y = 0.4 * math.cos(angle), 0.4 * math.sin(angle)
        # Centred at the middle of the reach: out and a little up from the shoulder.
        points.append((round(0.55 + x, 4), round(0.25 + y, 4)))
    if (points[-1][0] >= points[0][0]) != outward:
        points.reverse()
    return points


def _stars(in_corridor_pct: float) -> int:
    return 3 if in_corridor_pct >= 90 else 2 if in_corridor_pct >= 70 else 1


def make_path_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    """One trace: the shapes in turn, each both ways, as the game's provider chooses them."""
    del radii  # The path is placed inside a typical reach.
    position = trial_no - 1
    shape_index = position % len(PATH_SHAPES)
    direction = 1 if (position + position // len(PATH_SHAPES)) % 2 == 0 else -1
    path = path_points(PATH_SHAPES[shape_index], direction == 1)
    length = sum(math.dist(path[i - 1], path[i]) for i in range(1, len(path)))
    trace_ms = length / GUIDE_SPEED_SW_S * 1000
    in_corridor = round(clamp(skill.in_corridor_pct + rng.uniform(-12, 8), 20, 100), 1)
    # The fingertip wanders off the path more when it spends less time in the corridor.
    wobble = 0.03 + 0.25 * (1 - in_corridor / 100)
    enter = round(rng.uniform(800, 1800))
    trace_start = enter + START_HOLD_MS
    trajectory: list[tuple[float, float, float]] = []
    steps = int(trace_ms / (1000 / 30))
    for step in range(steps + 1):
        share = step / max(steps, 1)
        x, y = path[min(len(path) - 1, round(share * (len(path) - 1)))]
        drift = wobble * math.sin(2 * math.pi * 1.3 * share * trace_ms / 1000 + rng.uniform(0, 0.3))
        trajectory.append(
            (round(trace_start + share * trace_ms, 1), round(x, 4), round(y + drift, 4))
        )
    success = in_corridor >= 70
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {
                "shape_index": shape_index,
                "path_length_frac": 0.6,
                "guide_speed_sw_s": GUIDE_SPEED_SW_S,
                "corridor_width_sw": CORRIDOR_WIDTH_SW,
                "ring_frac": 0.7,
                "direction": direction,
                "start_hold_ms": START_HOLD_MS,
                "rest_ms": 2000,
            },
            "target": {"kind": "path", "shape": PATH_SHAPES[shape_index], "points": path},
            "outcome": "success" if success else "miss",
            "timings": {
                "spawn": 0,
                "enter": enter,
                "dwell_done": trace_start,
                "end": round(trace_start + trace_ms),
            },
            "metrics": {
                "peak_speed_sw_s": round(GUIDE_SPEED_SW_S * rng.uniform(1.4, 2.2), 4),
                "mean_tracking_error_sw": round(0.04 + wobble * rng.uniform(0.6, 1.0), 4),
                "mean_path_error_sw": round(wobble * rng.uniform(0.5, 0.75), 4),
                "time_in_corridor_pct": in_corridor,
                "lag_ms": round(rng.uniform(150, 450) * (1.6 - in_corridor / 100)),
                "coverage_pct": round(clamp(in_corridor + rng.uniform(0, 8), 0, 100), 1),
                "sparc": round(min(-1.0, skill.trace_sparc + rng.uniform(-0.25, 0.2)), 4),
            },
            "compensation": _compensation(rng, skill),
            "trajectory": trajectory,
        }
    )


WALL_TARGET_FRAC = 0.75
WALL_SWEEPS_NEEDED = 3
WALL_TIME_LIMIT_MS = 30000
#: The default elbow range: 70° bent (top of the wall) to 150° straight (bottom).
WALL_BENT_DEG = 70
WALL_STRAIGHT_DEG = 150
UPPER_ARM_LIMIT_DEG = 20


def make_wall_trial(
    rng: random.Random, trial_no: int, radii: Sequence[float], skill: GameSkill
) -> TrialCreate:
    """One stripe: elbow sweeps, full when they reach the target height (60° of the range)."""
    del radii  # The elbow moves the brush; no reaching.
    target_deg = WALL_TARGET_FRAC * (WALL_STRAIGHT_DEG - WALL_BENT_DEG)
    achieved = round(clamp(skill.elbow_range_deg + rng.uniform(-9, 6), 20, 120), 1)
    straight = round(rng.uniform(146, 156), 1)
    reaches_target = achieved >= target_deg
    full = WALL_SWEEPS_NEEDED if reaches_target and rng.random() < skill.success + 0.05 else 0
    if reaches_target and full == 0:
        full = rng.randint(1, WALL_SWEEPS_NEEDED - 1)
    partial = rng.randint(0, 1) if full == WALL_SWEEPS_NEEDED else rng.randint(1, 4)
    sweep_ms = lerp(2700, 1900, skill.success) * rng.uniform(0.85, 1.15)
    success = full >= WALL_SWEEPS_NEEDED
    end = round((full + partial) * sweep_ms + 1500) if success else WALL_TIME_LIMIT_MS
    moved = rng.random() < skill.compensation / 2
    upper_arm = round(rng.uniform(21, 30) if moved else rng.uniform(3, 14), 1)
    compensation: dict[str, Any] = {
        "flagged": moved,
        "type": "upper_arm" if moved else None,
        "max_values": {"upper_arm_motion_deg": upper_arm},
    }
    return TrialCreate.model_validate(
        {
            "trial_no": trial_no,
            "params": {
                "required_range_frac": WALL_TARGET_FRAC,
                "sweeps_needed": WALL_SWEEPS_NEEDED,
                "time_limit_ms": WALL_TIME_LIMIT_MS,
                "elbow_bent_deg": WALL_BENT_DEG,
                "elbow_straight_deg": WALL_STRAIGHT_DEG,
                "rest_ms": 2000,
            },
            "target": {"kind": "stripe", "index": trial_no - 1, "target_frac": WALL_TARGET_FRAC},
            "outcome": "success" if success else "miss",
            "timings": {"spawn": 0, "end": end},
            "metrics": {
                "achieved_range_deg": achieved,
                "max_bend_deg": round(straight - achieved, 1),
                "max_straight_deg": straight,
                "full_sweeps": full,
                "partial_sweeps": partial,
                "mean_sweep_ms": round(sweep_ms) if full > 0 else None,
                "angular_sparc": round(min(-1.0, skill.elbow_sparc + rng.uniform(-0.3, 0.25)), 4),
                "upper_arm_motion_deg": upper_arm,
            },
            "compensation": compensation,
            "trajectory": trajectory(rng, (0.35, -0.65), (0.3, -0.25), end),
        }
    )


TRIAL_MAKERS = {
    "reach_activate": make_reach_trial,
    "balloon_pop": make_balloon_trial,
    "fruit_catch": make_fruit_trial,
    "bloom": make_bloom_trial,
    "finger_piano": make_piano_trial,
    "path_trace": make_path_trial,
    "paint_wall": make_wall_trial,
}
#: The summary detail each reaching game fills in, as in web/src/features/games/results.ts.
SUMMARY_DETAILS = {
    "reach_activate": None,
    "balloon_pop": "highest_popped_frac",
    "fruit_catch": "widest_catch_frac",
    "bloom": None,
    "finger_piano": None,
    "path_trace": None,
    "paint_wall": None,
}


def make_game_trials(
    rng: random.Random,
    game_id: GameName,
    radii: Sequence[float],
    progress: float,
    improvement: float,
    count: int | None = None,
) -> list[TrialCreate]:
    """A run's trials; `count` defaults to the game's own number of trials."""
    skill = skill_at(progress, improvement)
    maker = TRIAL_MAKERS[game_id]
    total = TRIAL_COUNTS[game_id] if count is None else count
    return [maker(rng, number, radii, skill) for number in range(1, total + 1)]


def _hand_details(game_id: GameName, trials: Sequence[TrialCreate]) -> dict[str, Any]:
    """The summary details the hand games fill in, as the web app's games do."""
    played = [trial for trial in trials if trial.outcome != "aborted"]
    if game_id == "bloom":
        times = [
            trial.metrics.time_to_open_ms
            for trial in played
            if trial.outcome == "success" and trial.metrics.time_to_open_ms is not None
        ]
        peaks = [
            trial.metrics.peak_openness
            for trial in played
            if trial.metrics.peak_openness is not None
        ]
        return {
            "mean_time_to_open_ms": round(sum(times) / len(times)) if times else None,
            "best_openness": max(peaks) if peaks else None,
        }
    totals: dict[str, list[int]] = {}
    for trial in played:
        for finger, tally in (trial.metrics.per_finger or {}).items():
            total = totals.setdefault(finger, [0, 0])
            total[0] += tally.hits
            total[1] += tally.attempts
    hits = sum(total[0] for total in totals.values())
    notes = sum(total[1] for total in totals.values())
    rates = {finger: totals[finger][0] / totals[finger][1] for finger in FINGERS if finger in totals}
    # The best rate; with equal rates, more notes played; then the first in finger order.
    best = max(
        (finger for finger in rates if totals[finger][0] > 0),
        key=lambda finger: (rates[finger], totals[finger][0], -FINGERS.index(finger)),
        default=None,
    )
    return {
        "note_hit_rate": round(hits / notes, 4) if notes else None,
        "best_finger": best,
        **{f"hit_rate_{finger}": round(rate, 4) for finger, rate in rates.items()},
    }


def _movement_details(game_id: GameName, trials: Sequence[TrialCreate]) -> dict[str, Any]:
    """The summary details the movement-quality games fill in, as the web app's games do."""
    played = [trial for trial in trials if trial.outcome != "aborted"]

    def values(name: str) -> list[float]:
        found = [getattr(trial.metrics, name) for trial in played]
        return [value for value in found if isinstance(value, int | float)]

    if game_id == "path_trace":
        corridor = values("time_in_corridor_pct")
        smoothness = values("sparc")
        return {
            "mean_in_corridor_pct": round(sum(corridor) / len(corridor), 1) if corridor else None,
            "total_stars": sum(_stars(value) for value in corridor),
            "best_sparc": max(smoothness) if smoothness else None,
        }
    ranges = values("achieved_range_deg")
    return {
        "mean_range_deg": round(sum(ranges) / len(ranges), 1) if ranges else None,
        "best_range_deg": max(ranges) if ranges else None,
    }


def summarise_trials(game_id: GameName, trials: Sequence[TrialCreate]) -> GameSummary:
    successes = [trial for trial in trials if trial.outcome == "success"]
    movement = [
        trial.metrics.movement_ms for trial in successes if trial.metrics.movement_ms is not None
    ]
    efficiency = [
        trial.metrics.path_efficiency
        for trial in successes
        if trial.metrics.path_efficiency is not None
    ]
    details: dict[str, Any] = (
        _hand_details(game_id, trials)
        if game_id in HAND_GAMES
        else _movement_details(game_id, trials)
        if game_id in MOVEMENT_GAMES
        else {}
    )
    detail = SUMMARY_DETAILS[game_id]
    if detail is not None:
        fracs = [
            trial.target.distance_frac
            for trial in successes
            if trial.target is not None and trial.target.distance_frac is not None
        ]
        details[detail] = round(max(fracs), 3) if fracs else None
    return GameSummary(
        successes=len(successes),
        success_rate=round(len(successes) / len(trials), 4) if trials else 0,
        mean_movement_ms=round(sum(movement) / len(movement), 1) if movement else None,
        mean_path_efficiency=round(sum(efficiency) / len(efficiency), 4) if efficiency else None,
        compensated_trials=sum(1 for trial in trials if trial.compensation.flagged),
        details=details,
    )


def game_score(trials: Sequence[TrialCreate], game_id: GameName = "reach_activate") -> float:
    """As in the games: Finger piano scores 25 a note and 50 a melody played well; Path trace
    the % of time in the corridor and 50 for a success; Paint the wall 30 a full sweep, 10 a
    partial one and 50 a finished stripe; the others 100 per success plus a bonus for a quick
    reach (or, for Bloom, a quick opening)."""
    score = 0
    for trial in trials:
        success_bonus = 50 if trial.outcome == "success" else 0
        if game_id == "path_trace":
            score += round(trial.metrics.time_in_corridor_pct or 0) + success_bonus
            continue
        if game_id == "paint_wall":
            full = trial.metrics.full_sweeps or 0
            score += 30 * full + 10 * (trial.metrics.partial_sweeps or 0) + success_bonus
            continue
        if game_id == "finger_piano":
            score += 25 * (trial.metrics.hits or 0) + (50 if trial.outcome == "success" else 0)
            continue
        if trial.outcome != "success":
            continue
        if game_id == "bloom":
            to_open = trial.metrics.time_to_open_ms or 8000
            score += 100 + round(50 * clamp(1 - to_open / 8000, 0, 1))
            continue
        movement = trial.metrics.movement_ms or 6000
        score += 100 + round(50 * clamp(1 - movement / 6000, 0, 1))
    return float(score)


# Cool-down


def make_questionnaire(
    rng: random.Random, progress: float, improvement: float, pain: bool
) -> SessionFeedbackCreate:
    gain = progress * improvement
    if pain:
        difficulty: Literal["too_easy", "just_right", "too_hard"] = "too_hard"
    elif gain > 0.6:
        difficulty = rng.choice(("just_right", "just_right", "too_easy"))
    else:
        difficulty = rng.choice(("just_right", "just_right", "too_hard"))
    return SessionFeedbackCreate(
        pain_0_10=5 if pain else rng.choice((0, 0, 1, 1, 2)),
        fatigue_0_10=round(clamp(lerp(6, 3, gain) + rng.uniform(-1, 1), 0, 7)),
        enjoyment_1_5=round(clamp(lerp(3, 4.6, gain) + rng.uniform(-0.6, 0.6), 1, 5)),
        difficulty=difficulty,
        new_symptoms=False,
        comment=(
            "My shoulder hurt during the high balloons."
            if pain
            else rng.choice((None, None, "Felt good today.", "A bit tired at the end."))
        ),
    )


# The database


def session_start(days_ago: int, now: datetime, rng: random.Random) -> datetime:
    """A morning in Dhaka (UTC+6), never in the future."""
    day = (now - timedelta(days=days_ago)).date()
    start = datetime.combine(day, time(3, 30), tzinfo=UTC) + timedelta(minutes=rng.randrange(150))
    return min(start, now - timedelta(hours=1))


def _delete(session: Session, statement: Delete) -> None:
    # SQLModel types exec() for selects only; a bulk delete runs the same way.
    session.exec(statement)  # type: ignore[call-overload]


def clear_demo_data(session: Session) -> int:
    """Removes every is_demo patient with all their data. Returns how many were removed."""
    profiles = list(session.exec(select(PatientProfile).where(col(PatientProfile.is_demo))).all())
    profile_ids = [profile.id for profile in profiles if profile.id is not None]
    if not profile_ids:
        return 0
    session_ids = list(
        session.exec(
            select(SessionRecord.id).where(col(SessionRecord.patient_id).in_(profile_ids))
        ).all()
    )
    run_ids = list(
        session.exec(select(GameRun.id).where(col(GameRun.session_id).in_(session_ids))).all()
    )
    # Children first, so no row is ever left pointing at a deleted one.
    _delete(session, delete(Trial).where(col(Trial.game_run_id).in_(run_ids)))
    _delete(session, delete(GameRun).where(col(GameRun.session_id).in_(session_ids)))
    _delete(session, delete(WarmupResult).where(col(WarmupResult.session_id).in_(session_ids)))
    _delete(session, delete(Calibration).where(col(Calibration.session_id).in_(session_ids)))
    _delete(
        session, delete(SessionFeedback).where(col(SessionFeedback.session_id).in_(session_ids))
    )
    _delete(session, delete(SessionRecord).where(col(SessionRecord.id).in_(session_ids)))
    user_ids = [profile.user_id for profile in profiles]
    _delete(session, delete(PatientProfile).where(col(PatientProfile.id).in_(profile_ids)))
    _delete(session, delete(User).where(col(User.id).in_(user_ids)))
    session.commit()
    return len(profiles)


class DemoEmailTakenError(Exception):
    """A real patient already uses a demo email address."""


def _add_session(
    session: Session,
    rng: random.Random,
    profile: PatientProfile,
    demo: DemoPatient,
    index: int,
    started_at: datetime,
    histories: dict[ExerciseId, ExerciseHistory],
) -> None:
    progress = index / max(len(demo.days_ago) - 1, 1)
    calibration = make_calibration(rng, demo.affected_side, progress, demo.improvement)
    warmup = make_warmup(rng, progress, demo.improvement, histories)
    pain = demo.pain_session == index
    feedback = make_questionnaire(rng, progress, demo.improvement, pain)

    assert profile.id is not None
    record = SessionRecord(
        patient_id=profile.id,
        started_at=started_at,
        status="completed",
        device_info={"browser": "Chrome", "fps": round(rng.uniform(26, 31), 1), "delegate": "GPU"},
        current_step="summary",
        game_queue={"games": list(GAMES), "index": len(GAMES)},
    )
    session.add(record)
    session.flush()
    assert record.id is not None

    clock = started_at + timedelta(minutes=2)
    session.add(Calibration(**calibration.model_dump(), session_id=record.id, created_at=clock))
    clock += timedelta(minutes=3)
    for result in warmup:
        clock += timedelta(milliseconds=result.active_time_ms + result.paused_time_ms + 20_000)
        session.add(WarmupResult(**result.model_dump(), session_id=record.id, created_at=clock))

    for game_id in GAMES:
        trials = make_game_trials(
            rng, game_id, calibration.reach_radii_sw, progress, demo.improvement
        )
        summary = summarise_trials(game_id, trials)
        clock += timedelta(minutes=1)
        run_start = clock
        clock += timedelta(seconds=sum((trial.timings.end or 0) for trial in trials) / 1000 + 40)
        run = GameRun(
            session_id=record.id,
            game_id=game_id,
            engine="L0",
            input_source="cv_grip",
            params_initial={"seed": rng.randrange(1, 2**31)},
            started_at=run_start,
            ended_at=clock,
            status="completed",
            trials_planned=len(trials),
            trials_done=len(trials),
            score=game_score(trials, game_id),
            summary=summary.model_dump(),
        )
        session.add(run)
        session.flush()
        assert run.id is not None
        for trial in trials:
            session.add(
                Trial(**trial.model_dump(mode="json"), game_run_id=run.id, created_at=clock)
            )

    clock += timedelta(minutes=2)
    session.add(
        SessionFeedback(**feedback.model_dump(), session_id=record.id, created_at=clock)
    )
    flags = safety.flags_for(feedback)
    record.flags = list(flags)
    record.needs_review = safety.needs_review(flags)
    record.ended_at = clock + timedelta(seconds=30)
    session.add(record)


def seed_demo_data(
    session: Session, now: datetime | None = None, seed: int = SEED
) -> list[tuple[str, str]]:
    """Removes old demo patients, then creates them again. Returns (email, password) each.

    Raises DemoEmailTakenError, before changing anything, if a real patient uses a demo email.
    """
    for demo in DEMO_PATIENTS:
        user = session.exec(select(User).where(User.email == demo.email)).first()
        if user is None:
            continue
        owner = select(PatientProfile).where(PatientProfile.user_id == user.id)
        profile = session.exec(owner).first()
        if profile is None or not profile.is_demo:
            raise DemoEmailTakenError(demo.email)
    clear_demo_data(session)
    now = now or utc_now()
    rng = random.Random(seed)
    logins: list[tuple[str, str]] = []
    for demo in DEMO_PATIENTS:
        # Random, not from the seed, so no working login is ever committed or repeated.
        password = secrets.token_urlsafe(12)
        created = create_patient(
            session,
            PatientCreate(
                email=demo.email,
                full_name=demo.full_name,
                password=password,
                affected_side=demo.affected_side,
                dominant_side=demo.dominant_side,
                age_band=demo.age_band,
                months_since_stroke=demo.months_since_stroke,
                notes="Demo patient with synthetic data. Remove with seed_demo_data.py --clear.",
            ),
        )
        profile = session.get(PatientProfile, created.id)
        assert profile is not None
        profile.is_demo = True
        session.add(profile)

        histories: dict[ExerciseId, ExerciseHistory] = {}
        for index, days_ago in enumerate(demo.days_ago):
            started_at = session_start(days_ago, now, rng)
            _add_session(session, rng, profile, demo, index, started_at, histories)
        session.commit()
        logins.append((demo.email, password))
    return logins


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--clear", action="store_true", help="only remove demo patients and all their data"
    )
    args = parser.parse_args(argv)

    create_db_and_tables()
    with Session(engine) as session:
        if args.clear:
            removed = clear_demo_data(session)
            print(f"Removed {removed} demo patient(s) and all their data.")
            return 0
        try:
            logins = seed_demo_data(session)
        except DemoEmailTakenError as error:
            print(f"A patient who is not a demo patient already uses {error}. Nothing was changed.")
            return 1
    print("Demo patients created. Save these passwords: they are shown only once.")
    for email, password in logins:
        print(f"  {email}  {password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
