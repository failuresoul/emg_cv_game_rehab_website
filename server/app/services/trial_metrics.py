"""The server's own trial measures, from the RAW data the browser saved.

Spatial games (reach_activate, balloon_pop, fruit_catch, path_trace, pick_place) have their
movement measures (catalog K5-K10) recomputed from the RAW fingertip trajectory and the trial's
timings, with app/metrics. The other games (paint_wall, bloom, finger_piano, grip_hold) measure
things the trajectory does not hold (elbow angles, hand shape, grip level), so their client
measures are checked and copied.

Each trial gets `metrics_server` and `data_quality`:

- data_quality: the number of points, their sampling rate, gaps of more than 200 ms, and a
  `mismatches` entry for each measure where the server's value differs from the client's by
  more than 10% (both values kept).

Recomputing replaces both fields, so running it again gives the same result.
"""

import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from pydantic import ValidationError
from sqlmodel import Session, col, select

from app.metrics.kinematics import (
    movement_ms,
    onset_ms,
    path_efficiency,
    path_length,
    peak_speed,
    speed_peak_count,
    straight_distance,
    window,
)
from app.metrics.signal import FloatArray, smoothed_speed, speed_from_trajectory, usable_samples
from app.metrics.sparc import sparc
from app.models import GameRun, Trial
from app.models import Session as SessionRecord
from app.schemas.game import TrialMetrics

logger = logging.getLogger(__name__)

#: Bumped whenever the computation changes, so stored results say how they were made.
ENGINE_VERSION = 1
SPATIAL_GAMES = frozenset(
    {"reach_activate", "balloon_pop", "fruit_catch", "path_trace", "pick_place"}
)
COPIED_GAMES = frozenset({"paint_wall", "bloom", "finger_piano", "grip_hold"})
#: A server measure differing from the client's by more than this share is a mismatch.
MISMATCH_SHARE = 0.10
#: Two RAW points further apart than this, in ms, are a gap in tracking.
GAP_MS = 200.0


def data_quality(trajectory: Sequence[Sequence[float]]) -> dict[str, Any]:
    """Points, sampling rate (points per second over their span), and gaps over 200 ms."""
    points = usable_samples([list(point) for point in trajectory], min_width=3)
    count = int(points.shape[0])
    if count < 2:
        return {"n_points": count, "sampling_hz": None, "gaps_over_200ms": 0, "max_gap_ms": None}
    steps = np.diff(points[:, 0])
    span_s = float(points[-1, 0] - points[0, 0]) / 1000
    return {
        "n_points": count,
        "sampling_hz": round((count - 1) / span_s, 2) if span_s > 0 else None,
        "gaps_over_200ms": int(np.sum(steps > GAP_MS)),
        "max_gap_ms": round(float(np.max(steps)), 1),
    }


def _round(value: float | None, places: int) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, places)


@dataclass(frozen=True)
class MovementMeasures:
    reaction_ms: float | None
    movement_ms: float | None
    path_length_sw: float | None
    straight_dist_sw: float | None
    path_efficiency: float | None
    sparc: float | None
    peak_speed_sw_s: float | None
    speed_peaks: int | None


NO_MOVEMENT = MovementMeasures(None, None, None, None, None, None, None, None)


def movement_measures(
    points: FloatArray, end_ms: float | None, find_onset: bool = True, start_ms: float = 0.0
) -> MovementMeasures:
    """K5-K10 for one movement. With `find_onset`, the movement runs from the onset (the speed
    first above 0.15 SW/s for 50 ms after `start_ms`) to `end_ms`, or to the last point if the
    end never came; without, it runs from `start_ms` to `end_ms`. Path measures use the RAW
    points, SPARC their RAW speed (as the web app), onset and peaks a filtered speed."""
    span = window(points, from_ms=start_ms, to_ms=end_ms)
    if span.shape[0] < 2:
        return NO_MOVEMENT
    onset: float | None = start_ms
    if find_onset:
        onset = onset_ms(smoothed_speed(span))
        if onset is None:
            return NO_MOVEMENT
    moving = window(span, from_ms=onset)
    if moving.shape[0] < 2:
        return NO_MOVEMENT
    filtered = smoothed_speed(moving)
    return MovementMeasures(
        reaction_ms=_round(onset - start_ms, 0) if find_onset and onset is not None else None,
        movement_ms=_round(movement_ms(onset, end_ms), 0) if find_onset else None,
        path_length_sw=_round(path_length(moving), 4),
        straight_dist_sw=_round(straight_distance(moving), 4),
        path_efficiency=_round(path_efficiency(moving), 4),
        sparc=_round(_sparc(moving), 4),
        peak_speed_sw_s=_round(peak_speed(filtered), 4),
        speed_peaks=speed_peak_count(filtered) if filtered.shape[0] > 0 else None,
    )


def _sparc(points: FloatArray) -> float | None:
    value = sparc(speed_from_trajectory(points))
    return None if value is None else min(0.0, value)


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _as_dict(measures: MovementMeasures, keys: Sequence[str]) -> dict[str, Any]:
    values = {
        "reaction_ms": measures.reaction_ms,
        "movement_ms": measures.movement_ms,
        "path_length_sw": measures.path_length_sw,
        "straight_dist_sw": measures.straight_dist_sw,
        "path_efficiency": measures.path_efficiency,
        "sparc": measures.sparc,
        "peak_speed_sw_s": measures.peak_speed_sw_s,
        "speed_peaks": measures.speed_peaks,
    }
    return {key: values[key] for key in keys}


REACH_KEYS = (
    "reaction_ms",
    "movement_ms",
    "path_length_sw",
    "straight_dist_sw",
    "path_efficiency",
    "sparc",
    "peak_speed_sw_s",
    "speed_peaks",
)


def spatial_metrics(
    game_id: str,
    trajectory: Sequence[Sequence[float]],
    timings: dict[str, Any],
    client: dict[str, Any],
) -> dict[str, Any]:
    """K5-K10 of one trial of a spatial game, from its RAW trajectory and timings."""
    points = usable_samples([list(point) for point in trajectory], min_width=3)
    enter = _number(timings.get("enter"))
    end = _number(timings.get("end"))

    if game_id in ("reach_activate", "balloon_pop"):
        # Spawn to entering the target (or touching the balloon).
        return _as_dict(movement_measures(points, enter), REACH_KEYS)
    if game_id == "fruit_catch":
        # The basket moves sideways only, so the movement is measured along x, as in the game.
        sideways = points.copy()
        if sideways.shape[0] > 0:
            sideways[:, 2] = 0.0
        return _as_dict(movement_measures(sideways, enter), REACH_KEYS)
    if game_id == "path_trace":
        # The guide sets the pace: no reaction or movement time, the trace from start to end.
        start = _number(timings.get("dwell_done"))
        if start is None:
            return _as_dict(NO_MOVEMENT, ("sparc", "peak_speed_sw_s", "speed_peaks"))
        measures = movement_measures(points, end, find_onset=False, start_ms=start)
        return _as_dict(measures, ("sparc", "peak_speed_sw_s", "speed_peaks"))
    if game_id == "pick_place":
        # Reaching to the object, then (for an object placed) the carry that ended in the box:
        # the client's transport time back from the end.
        reach = movement_measures(points, enter)
        transport_ms = _number(client.get("transport_ms"))
        carry = (
            movement_measures(points, end, find_onset=False, start_ms=end - transport_ms)
            if transport_ms is not None and end is not None
            else NO_MOVEMENT
        )
        return {
            "reaction_ms": reach.reaction_ms,
            "movement_ms": reach.movement_ms,
            "transport_path_efficiency": carry.path_efficiency,
            "sparc": carry.sparc,
            "peak_speed_sw_s": carry.peak_speed_sw_s,
            "speed_peaks": carry.speed_peaks,
        }
    raise ValueError(f"{game_id} is not a spatial game")


def copied_metrics(client: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """The client's measures after checking them against the trial schema, without the empty
    ones; and whether they were valid (invalid ones are not copied)."""
    try:
        checked = TrialMetrics.model_validate(client)
    except ValidationError:
        return {}, False
    return checked.model_dump(mode="json", exclude_none=True), True


def mismatches(server: dict[str, Any], client: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Each measure both sides have where the server's differs from the client's by more than
    10% of the client's value (any difference when the client's is 0)."""
    found: dict[str, dict[str, float]] = {}
    for key, value in server.items():
        mine, theirs = _number(value), _number(client.get(key))
        if mine is None or theirs is None:
            continue
        allowed = MISMATCH_SHARE * abs(theirs) if theirs != 0 else 1e-9
        if abs(mine - theirs) > allowed:
            found[key] = {"client": theirs, "server": mine}
    return found


def compute(game_id: str, trial: Trial) -> tuple[dict[str, Any], dict[str, Any]]:
    """`metrics_server` and `data_quality` for one trial."""
    client = dict(trial.metrics or {})
    quality: dict[str, Any] = {
        "engine_version": ENGINE_VERSION,
        **data_quality(trial.trajectory or []),
    }
    if game_id in SPATIAL_GAMES:
        server = spatial_metrics(game_id, trial.trajectory or [], dict(trial.timings or {}), client)
        quality["source"] = "trajectory"
        quality["mismatches"] = mismatches(server, client)
    else:
        server, valid = copied_metrics(client)
        quality["source"] = "client"
        quality["client_metrics_valid"] = valid
        quality["mismatches"] = {}
    return server, quality


@dataclass(frozen=True)
class RecomputeResult:
    sessions: int
    runs: int
    trials: int
    #: Trials with at least one mismatch.
    mismatched_trials: int


def recompute_runs(session: Session, runs: Sequence[GameRun]) -> RecomputeResult:
    """Recomputes every trial of the runs and saves the results. Idempotent."""
    trials_done = 0
    mismatched = 0
    for run in runs:
        assert run.id is not None
        for trial in session.exec(select(Trial).where(Trial.game_run_id == run.id)).all():
            server, quality = compute(run.game_id, trial)
            trial.metrics_server = server
            trial.data_quality = quality
            session.add(trial)
            trials_done += 1
            if quality["mismatches"]:
                mismatched += 1
    session.commit()
    return RecomputeResult(
        sessions=len({run.session_id for run in runs}),
        runs=len(runs),
        trials=trials_done,
        mismatched_trials=mismatched,
    )


def recompute_run(session: Session, run: GameRun) -> RecomputeResult | None:
    """For a run that has just ended. Never raises: a failure is logged and leaves the trials
    without server measures, which an admin can recompute later."""
    try:
        return recompute_runs(session, [run])
    except Exception:
        session.rollback()
        logger.exception("Recomputing the metrics of game run %s failed", run.id)
        return None


class SessionNotFoundError(LookupError):
    """No session has this id."""


def recompute(session: Session, session_id: int | None = None) -> RecomputeResult:
    """Every trial of one session, or of every session when `session_id` is None."""
    statement = select(GameRun).order_by(col(GameRun.id))
    if session_id is not None:
        if session.get(SessionRecord, session_id) is None:
            raise SessionNotFoundError(session_id)
        statement = statement.where(GameRun.session_id == session_id)
    runs = list(session.exec(statement).all())
    result = recompute_runs(session, runs)
    if session_id is not None:
        return RecomputeResult(1, result.runs, result.trials, result.mismatched_trials)
    return result
