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
        }
    )
