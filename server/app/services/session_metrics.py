"""One clean summary per session: every catalogue measure the session has.

From the calibration (K1), the warm-up (R1, R2, R4, H1, G3, G4), the game trials (K5-K10, K12,
R3, H2-H6, G1), the time spent (G2) and the cool-down questionnaire (P1-P3). Trial measures use
the server's own values (Trial.metrics_server) and fall back to the browser's where the server
did not compute the measure. Trials the patient stopped are left out.

- Trial measures: the median per game, with the quartiles in `details`.
- Range measures (R): the best value.
- Rates (G1, K12, H2): over every counted item.

A measure the session lacks (no games, a skipped exercise, no questionnaire) has no row.
Computing again replaces the session's rows, so it is idempotent.
"""

import logging
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, col, delete, select

from app.metrics.aggregate import flagged_rate, success_rate, summarise
from app.models import Calibration, EmgCalibration, GameRun, SessionFeedback, Trial, WarmupResult
from app.models import Session as SessionRecord
from app.models.session_metric import SessionMetric
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.services.metrics_catalog import get_metric
from app.services.warmup_summary import goal_reached

logger = logging.getLogger(__name__)

#: Games with a reach to a target, and those with a movement measured from the trajectory.
REACH_GAMES = ("reach_activate", "balloon_pop", "fruit_catch", "pick_place")
MOVING_GAMES = ("reach_activate", "balloon_pop", "fruit_catch", "path_trace", "pick_place")
#: Trial measures summarised by their median: metric id to the trial metric of each game.
MEDIAN_MEASURES: dict[str, dict[str, str]] = {
    "K5": {game: "reaction_ms" for game in REACH_GAMES},
    "K6": {game: "movement_ms" for game in REACH_GAMES},
    "K7": {
        "reach_activate": "path_efficiency",
        "balloon_pop": "path_efficiency",
        "fruit_catch": "path_efficiency",
        "pick_place": "transport_path_efficiency",
    },
    "K8": {game: "sparc" for game in MOVING_GAMES},
    "K9": {game: "peak_speed_sw_s" for game in MOVING_GAMES},
    "K10": {game: "speed_peaks" for game in MOVING_GAMES},
    "H3": {"grip_hold": "steadiness"},
    "H4": {"grip_hold": "relaxation_ms"},
    "H5": {"pick_place": "transport_ms"},
    "H6": {"bloom": "peak_openness"},
}
#: Games the muscle sensor can drive, and their EMG measures summarised by the median.
EMG_GAMES = ("reach_activate", "grip_hold", "bloom")
EMG_MEDIANS: dict[str, tuple[str, tuple[str, ...]]] = {
    "E5": ("onset_latency_ms", EMG_GAMES),
    "E6": ("relaxation_ms", EMG_GAMES),
    "E8": ("steadiness", ("grip_hold",)),
}
#: The fatigue slope needs at least this many activations.
MIN_FATIGUE_TRIALS = 4
#: Range measures from trials, summarised by their best (largest) value.
BEST_TRIAL_MEASURES: dict[str, dict[str, str]] = {"R3": {"paint_wall": "achieved_range_deg"}}
#: Range measures from the warm-up: the exercise's best peak.
WARMUP_BEST: dict[str, str] = {
    "R1": "shoulder_flexion",
    "R2": "shoulder_abduction",
    "R4": "forward_reach",
}


@dataclass
class _Row:
    metric_id: str
    value: float
    n: int
    game_id: str | None = None
    details: dict[str, Any] | None = field(default=None)


@dataclass(frozen=True)
class _TrialValue:
    value: float
    #: "server" or "client": where the value came from.
    source: str


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if number == number and abs(number) != float("inf") else None


def trial_value(trial: Trial, key: str) -> _TrialValue | None:
    """The server's value of a trial measure, or the browser's when the server did not compute
    that measure (such as a trial not recomputed yet). A server value of None means the server
    found none (no movement onset, say), so the browser's is not used in its place."""
    server_metrics = trial.metrics_server or {}
    if key in server_metrics:
        server = _number(server_metrics[key])
        return _TrialValue(server, "server") if server is not None else None
    client = _number((trial.metrics or {}).get(key))
    return _TrialValue(client, "client") if client is not None else None


def _median_row(metric_id: str, game_id: str, found: Sequence[_TrialValue]) -> _Row | None:
    summary = summarise(item.value for item in found)
    if summary is None:
        return None
    return _Row(
        metric_id=metric_id,
        value=summary.median,
        n=summary.count,
        game_id=game_id,
        details={
            "statistic": "median",
            "q1": summary.q1,
            "q3": summary.q3,
            "iqr": summary.iqr,
            "mean": summary.mean,
            "min": summary.min,
            "max": summary.max,
            "from_server": sum(1 for item in found if item.source == "server"),
            "from_client": sum(1 for item in found if item.source == "client"),
        },
    )


def _trial_rows(trials_by_game: dict[str, list[Trial]]) -> list[_Row]:
    rows: list[_Row] = []
    for metric_id, keys in MEDIAN_MEASURES.items():
        for game_id, key in keys.items():
            found = [v for t in trials_by_game.get(game_id, []) if (v := trial_value(t, key))]
            row = _median_row(metric_id, game_id, found)
            if row is not None:
                rows.append(row)
    for metric_id, keys in BEST_TRIAL_MEASURES.items():
        for game_id, key in keys.items():
            found = [v for t in trials_by_game.get(game_id, []) if (v := trial_value(t, key))]
            if found:
                best = max(item.value for item in found)
                rows.append(_Row(metric_id, best, len(found), game_id, {"statistic": "best"}))

    # H2: notes played over notes asked, over every melody.
    hits = notes = melodies = 0
    for trial in trials_by_game.get("finger_piano", []):
        hit = trial_value(trial, "hits")
        total = trial_value(trial, "notes_total")
        if hit is not None and total is not None and total.value > 0:
            hits += int(hit.value)
            notes += int(total.value)
            melodies += 1
    if notes > 0:
        rows.append(
            _Row("H2", hits / notes, melodies, "finger_piano", {"hits": hits, "notes": notes})
        )

    every = [trial for trials in trials_by_game.values() for trial in trials]
    rate = success_rate(trial.outcome for trial in every)
    if rate is not None:
        per_game = {
            game_id: success_rate(trial.outcome for trial in trials)
            for game_id, trials in trials_by_game.items()
        }
        rows.append(_Row("G1", rate, len(every), None, {"per_game": per_game}))
    compensated = flagged_rate(bool((trial.compensation or {}).get("flagged")) for trial in every)
    if compensated is not None:
        rows.append(_Row("K12", compensated, len(every)))
    return rows


def _emg_value(trial: Trial, key: str) -> float | None:
    return _number(((trial.emg or {}).get("metrics") or {}).get(key))


def fatigue_slope(peaks: Sequence[float]) -> float | None:
    """The least-squares slope of peak %MVC against the activation's order (per activation);
    None for fewer than MIN_FATIGUE_TRIALS."""
    n = len(peaks)
    if n < MIN_FATIGUE_TRIALS:
        return None
    mean_x = (n - 1) / 2
    mean_y = sum(peaks) / n
    spread = sum((x - mean_x) ** 2 for x in range(n))
    return sum((x - mean_x) * (y - mean_y) for x, y in enumerate(peaks)) / spread


def _emg_rows(
    calibration: EmgCalibration | None, ordered: Sequence[tuple[str, Trial]]
) -> list[_Row]:
    """The muscle sensor's measures: the calibration's MVC (E2), and from the trials it drove
    activation success (E3), onset latency (E5), relaxation (E6), steadiness (E8) and the
    fatigue slope of their peaks (E9)."""
    rows: list[_Row] = []
    if calibration is not None and _number(calibration.mvc_mv) is not None:
        rows.append(
            _Row(
                "E2",
                float(calibration.mvc_mv),
                len(calibration.mvc_attempts or []) or 1,
                None,
                {"site": calibration.site, "attempts": calibration.mvc_attempts},
            )
        )
    with_emg = [(game_id, trial) for game_id, trial in ordered if trial.emg]
    by_game: dict[str, list[Trial]] = defaultdict(list)
    for game_id, trial in with_emg:
        by_game[game_id].append(trial)
    for game_id, trials in by_game.items():
        rate = success_rate(trial.outcome for trial in trials)
        if rate is not None:
            rows.append(_Row("E3", rate, len(trials), game_id))
    for metric_id, (key, games) in EMG_MEDIANS.items():
        for game_id in games:
            found = [
                _TrialValue(value, "client")
                for trial in by_game.get(game_id, [])
                if (value := _emg_value(trial, key)) is not None
            ]
            row = _median_row(metric_id, game_id, found)
            if row is not None:
                rows.append(row)
    peaks = [value for _, trial in with_emg if (value := _emg_value(trial, "peak_mvc")) is not None]
    slope = fatigue_slope(peaks)
    if slope is not None:
        rows.append(_Row("E9", slope, len(peaks), None, {"first": peaks[0], "last": peaks[-1]}))
    return rows


def _warmup_rows(results: Sequence[WarmupResult]) -> list[_Row]:
    done = [result for result in results if not result.skipped]
    if not done:
        return []
    by_exercise = {result.exercise_id: result for result in done}
    rows: list[_Row] = []
    for metric_id, exercise_id in WARMUP_BEST.items():
        result = by_exercise.get(exercise_id)
        peak = _number(result.best_peak) if result else None
        if peak is not None:
            details = {"statistic": "best", "exercise": exercise_id}
            rows.append(_Row(metric_id, peak, 1, None, details))
    hand = by_exercise.get("hand_open_close")
    if hand is not None:
        peak, low = _number(hand.best_peak), _number((hand.thresholds or {}).get("low"))
        if peak is not None and low is not None:
            rows.append(
                _Row("H1", max(0.0, peak - low), 1, None, {"best_peak": peak, "closed": low})
            )
    rows.append(_Row("G3", float(sum(result.full_reps for result in done)), len(done)))
    reached = sum(1 for result in done if goal_reached(result))
    rows.append(_Row("G4", float(reached), len(done), None, {"exercises_total": len(results)}))
    return rows


def _active_minutes(results: Sequence[WarmupResult], runs: Sequence[GameRun]) -> _Row | None:
    """Warm-up exercise time plus each finished game's time, as the session summary counts it."""
    done = [result for result in results if not result.skipped]
    ended = [run for run in runs if run.ended_at is not None]
    if not done and not ended:
        return None
    active_ms = sum(result.active_time_ms for result in done)
    for run in ended:
        assert run.ended_at is not None
        elapsed = as_utc(run.ended_at) - as_utc(run.started_at)
        active_ms += max(elapsed.total_seconds(), 0) * 1000
    return _Row("G2", active_ms / 60000, len(done) + len(ended))


def _feedback_rows(feedback: SessionFeedback | None) -> list[_Row]:
    if feedback is None:
        return []
    return [
        _Row("P1", float(feedback.pain_0_10), 1),
        _Row("P2", float(feedback.fatigue_0_10), 1),
        _Row("P3", float(feedback.enjoyment_1_5), 1),
    ]


def build_rows(session: Session, session_id: int) -> list[_Row]:
    """Every catalogue measure the session has, without saving them."""
    calibration = session.exec(
        select(Calibration).where(Calibration.session_id == session_id)
    ).first()
    results = list(
        session.exec(select(WarmupResult).where(WarmupResult.session_id == session_id)).all()
    )
    runs = list(
        session.exec(
            select(GameRun).where(GameRun.session_id == session_id).order_by(col(GameRun.id))
        ).all()
    )
    trials_by_game: dict[str, list[Trial]] = defaultdict(list)
    # Every trial in the order played (run, then trial number), for the fatigue slope.
    ordered: list[tuple[str, Trial]] = []
    run_ids = {run.id: run.game_id for run in runs}
    if run_ids:
        statement = (
            select(Trial)
            .where(col(Trial.game_run_id).in_(list(run_ids)))
            .order_by(col(Trial.game_run_id), col(Trial.trial_no))
        )
        for trial in session.exec(statement).all():
            if trial.outcome != "aborted":
                trials_by_game[run_ids[trial.game_run_id]].append(trial)
                ordered.append((run_ids[trial.game_run_id], trial))
    emg_calibration = session.exec(
        select(EmgCalibration).where(EmgCalibration.session_id == session_id)
    ).first()
    feedback = session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == session_id)
    ).first()

    rows: list[_Row] = []
    if calibration is not None and _number(calibration.hull_area_sw2) is not None:
        rows.append(_Row("K1", float(calibration.hull_area_sw2), 1))
    rows.extend(_warmup_rows(results))
    rows.extend(_trial_rows(trials_by_game))
    active = _active_minutes(results, runs)
    if active is not None:
        rows.append(active)
    rows.extend(_feedback_rows(feedback))
    rows.extend(_emg_rows(emg_calibration, ordered))
    return rows


class SessionNotFoundError(LookupError):
    """No session has this id."""


def compute_session_metrics(session: Session, session_id: int) -> list[SessionMetric]:
    """Replaces the session's metric rows with freshly computed ones and returns them."""
    if session.get(SessionRecord, session_id) is None:
        raise SessionNotFoundError(session_id)
    rows = build_rows(session, session_id)
    session.exec(delete(SessionMetric).where(col(SessionMetric.session_id) == session_id))
    now = utc_now()
    saved: list[SessionMetric] = []
    for row in rows:
        metric = get_metric(row.metric_id)
        assert metric is not None, f"{row.metric_id} is not in the metrics catalogue"
        record = SessionMetric(
            session_id=session_id,
            metric_id=row.metric_id,
            value=row.value,
            unit=metric.unit,
            n=row.n,
            game_id=row.game_id,
            details=row.details,
            computed_at=now,
        )
        session.add(record)
        saved.append(record)
    session.commit()
    return saved


def compute_quietly(session: Session, session_id: int) -> list[SessionMetric] | None:
    """For the patient's own requests: a failure is logged, never raised, and the metrics can be
    computed again later (backfill or the admin's recompute)."""
    try:
        return compute_session_metrics(session, session_id)
    except Exception:
        session.rollback()
        logger.exception("Computing the metrics of session %s failed", session_id)
        return None


def list_session_metrics(session: Session, session_id: int) -> list[SessionMetric]:
    statement = (
        select(SessionMetric)
        .where(SessionMetric.session_id == session_id)
        .order_by(col(SessionMetric.metric_id), col(SessionMetric.game_id))
    )
    return list(session.exec(statement).all())



def compute_for_sessions(session: Session, session_ids: Sequence[int] | None = None) -> int:
    """Computes the metrics of the given sessions, or of every session when None. Returns how
    many metric rows were saved."""
    if session_ids is None:
        statement = select(SessionRecord.id).order_by(col(SessionRecord.id))
        session_ids = [found for found in session.exec(statement).all() if found is not None]
    return sum(len(compute_session_metrics(session, session_id)) for session_id in session_ids)
