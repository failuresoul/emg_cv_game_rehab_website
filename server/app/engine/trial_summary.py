"""A saved trial as the engine learns from it, as the browser sends it (web/src/ai/trialSummary.ts).

Used where the server replays trials itself, such as the demo data. Keep the two in step.
"""

from app.schemas.engine import LastTrial
from app.schemas.game import TrialCreate


def failure_type(game_id: str, trial: TrialCreate) -> str | None:
    """Which kind of difficulty a failure points at; None for a success or a stopped trial."""
    outcome, metrics = trial.outcome, trial.metrics
    if outcome in ("success", "aborted"):
        return None
    if outcome in ("reach_fail", "activation_fail"):
        return outcome
    if game_id == "balloon_pop":
        return "activation_fail" if trial.timings.enter is not None else "miss"
    if game_id in ("bloom", "grip_hold"):
        return "activation_fail"
    if game_id == "path_trace":
        return "reach_fail"
    if game_id == "paint_wall":
        return "reach_fail" if (metrics.full_sweeps or 0) == 0 else "miss"
    if game_id == "pick_place":
        return "reach_fail" if metrics.grasp_latency_ms is None else "miss"
    return "miss"


#: Pick and place's carry_direction (0 outward, 1 inward, 2 up, 3 down) as degrees.
CARRY_DEGREES = {0: 0.0, 1: 180.0, 2: 90.0, 3: 270.0}


def _number(params: dict[str, object], name: str) -> float | None:
    value = params.get(name)
    return float(value) if isinstance(value, int | float) else None


def target_location(game_id: str, trial: TrialCreate) -> dict[str, object]:
    """Where the trial's target was, for L2: direction_deg, distance_frac and side (Fruit
    catch), from the trial's settings. Empty for games without directions."""
    p = trial.params
    location: dict[str, object] = {}
    if game_id == "reach_activate":
        location = {"direction_deg": _number(p, "direction_deg"), "distance_frac": _number(p, "distance_frac")}
        if trial.target is not None:
            location["direction_deg"] = trial.target.direction_deg if trial.target.direction_deg is not None else location["direction_deg"]
            location["distance_frac"] = trial.target.distance_frac if trial.target.distance_frac is not None else location["distance_frac"]
    elif game_id == "balloon_pop":
        location = {"direction_deg": _number(p, "direction_deg"), "distance_frac": _number(p, "height_frac")}
    elif game_id == "fruit_catch":
        side = _number(p, "target_side")
        spread, share = _number(p, "spread_frac"), _number(p, "target_frac")
        location = {
            "side": None if side is None else ("out" if side > 0 else "across"),
            "distance_frac": spread * share if spread is not None and share is not None else spread,
        }
    elif game_id == "pick_place":
        carry = _number(p, "carry_direction")
        location = {
            "direction_deg": CARRY_DEGREES.get(int(carry)) if carry is not None else None,
            "distance_frac": _number(p, "pick_distance_frac"),
        }
    elif game_id == "path_trace":
        direction = _number(p, "direction")
        location = {
            "direction_deg": None if direction is None else (0.0 if direction > 0 else 180.0),
            "distance_frac": _number(p, "path_length_frac"),
        }
    found = {key: value for key, value in location.items() if value is not None}
    if isinstance(found.get("direction_deg"), float):
        found["direction_deg"] = float(found["direction_deg"]) % 360  # type: ignore[arg-type]
    if isinstance(found.get("distance_frac"), float):
        found["distance_frac"] = round(min(2.0, max(0.0, float(found["distance_frac"]))), 4)  # type: ignore[arg-type]
    return found


def last_trial(game_id: str, trial: TrialCreate) -> LastTrial:
    metrics, timings = trial.metrics, trial.timings
    movement = metrics.movement_ms
    peak = metrics.activation_peak
    if peak is None:
        peak = metrics.peak_grip if metrics.peak_grip is not None else metrics.peak_openness
    return LastTrial.model_validate(
        {
            "trial_no": trial.trial_no,
            "outcome": trial.outcome,
            "failure_type": failure_type(game_id, trial),
            "compensated": trial.compensation.flagged,
            "movement_ms": movement,
            "completion_ms": (
                max(0.0, timings.end - timings.spawn)
                if movement is None and timings.end is not None
                else None
            ),
            "activation_peak": peak,
            **target_location(game_id, trial),
        }
    )
