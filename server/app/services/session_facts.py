"""The facts of one session for the LLM feedback module (docs/session-facts.md).

Only numbers, codes and short labels: never the patient's name or email. The module words its
feedback from these facts alone, so everything it may mention is here, and nothing else.
"""

from collections import defaultdict
from collections.abc import Sequence

import numpy as np
from sqlmodel import Session, col, select

from app.metrics.aggregate import flagged_rate, success_rate
from app.metrics.signal import usable_samples
from app.models import GameRun, PatientProfile, SessionFeedback, SessionMetric, Trial
from app.models import Session as SessionRecord
from app.schemas.metrics import (
    FactsAdherence,
    FactsDirections,
    FactsFlags,
    FactsGame,
    FactsMetric,
    FactsNextSession,
    FactsSelfReport,
    SessionFacts,
)
from app.services import levels, planner
from app.services.metrics_catalog import get_metric
from app.services.progress import (
    BASELINE_SESSIONS,
    judge_change,
    local_day,
    sessions_this_week,
)
from app.services.sessions import duration_seconds
from app.services.trial_metrics import GAP_MS, SPATIAL_GAMES

#: At most this many measures are given to the feedback module.
MAX_FACT_METRICS = 8
#: After the measures that changed, the ones shown first when nothing changed, in this order.
KEY_METRICS = (
    "G1", "K6", "K7", "K8", "R1", "R3", "H1", "H5", "H3", "K1",
    "K5", "K9", "K10", "R2", "R4", "H2", "H4", "H6", "K12", "G2", "G3", "G4",
)  # fmt: skip
#: Self-report answers are given separately, not as measures.
SELF_REPORT_METRICS = frozenset({"P1", "P2", "P3"})
WEAK_BELOW = 0.5
STRONG_ABOVE = 0.85
SAFETY_FLAGS = frozenset({"pain", "new_symptoms"})


def _patient_sessions(session: Session, patient_id: int) -> list[SessionRecord]:
    statement = (
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id)
        .order_by(col(SessionRecord.started_at), col(SessionRecord.id))
    )
    return list(session.exec(statement).all())


def _metrics(
    session: Session, record: SessionRecord, history: Sequence[SessionRecord]
) -> list[FactsMetric]:
    """This session's measures against the baseline of the sessions up to it."""
    assert record.id is not None
    # Completed sessions before this one, then this one (whatever its status).
    earlier = [
        item.id
        for item in history
        if item.status == "completed" and item.id != record.id and item.id is not None
    ]
    order = [*earlier, record.id]
    rows = session.exec(
        select(SessionMetric).where(col(SessionMetric.session_id).in_(order))
    ).all()
    by_key: dict[tuple[str, str | None], dict[int, float]] = defaultdict(dict)
    for row in rows:
        by_key[(row.metric_id, row.game_id)][row.session_id] = row.value

    facts: list[FactsMetric] = []
    for (metric_id, game_id), values in by_key.items():
        metric = get_metric(metric_id)
        if metric is None or metric_id in SELF_REPORT_METRICS or record.id not in values:
            continue
        series = [values[session_id] for session_id in order if session_id in values]
        result = judge_change(metric_id, metric.better_when, series)
        facts.append(
            FactsMetric(
                id=metric_id,
                game_id=game_id,
                name=metric.name,
                value=round(series[-1], 4),
                baseline=None if result.baseline is None else round(result.baseline, 4),
                unit=metric.unit,
                change_mdc=result.change_mdc,
                mdc_status=result.status,
            )
        )
    return choose_metrics(facts)


def choose_metrics(facts: Sequence[FactsMetric]) -> list[FactsMetric]:
    """Up to eight: the measures that improved or got worse first (largest change first), then
    the key ones that did not change, in KEY_METRICS order."""
    changed = sorted(
        (fact for fact in facts if fact.mdc_status in ("improved", "worse")),
        key=lambda fact: -abs(fact.change_mdc or 0),
    )
    rank = {metric_id: index for index, metric_id in enumerate(KEY_METRICS)}
    unchanged = sorted(
        (fact for fact in facts if fact.mdc_status not in ("improved", "worse")),
        key=lambda fact: (rank.get(fact.id, len(rank)), fact.game_id or ""),
    )
    return [*changed, *unchanged][:MAX_FACT_METRICS]


def _games(
    session: Session, runs: Sequence[GameRun], trials: dict[int, list[Trial]]
) -> dict[str, FactsGame]:
    played: dict[str, list[Trial]] = defaultdict(list)
    run_levels = levels.run_levels(session, [run.id for run in runs if run.id is not None])
    starts: dict[str, int] = {}
    ends: dict[str, int] = {}
    for run in runs:
        assert run.id is not None
        played[run.game_id].extend(trials.get(run.id, []))
        found = run_levels.get(run.id)
        if found:
            # The first run of the game sets the start; the last one the end.
            starts.setdefault(run.game_id, found.start)
            ends[run.game_id] = found.end
    return {
        game_id: FactsGame(
            trials=len(found),
            success_rate=success_rate(trial.outcome for trial in found),
            level_start=starts.get(game_id),
            level_end=ends.get(game_id),
        )
        for game_id, found in played.items()
        if found
    }


def directions(reach_trials: Sequence[Trial]) -> FactsDirections:
    """Reach and squeeze's success rate per direction: weak below 0.5, strong above 0.85."""
    by_direction: dict[int, list[str]] = defaultdict(list)
    for trial in reach_trials:
        degrees = (trial.target or {}).get("direction_deg")
        if isinstance(degrees, int | float) and not isinstance(degrees, bool):
            by_direction[round(degrees)].append(trial.outcome)
    weak: list[int] = []
    strong: list[int] = []
    for degrees in sorted(by_direction):
        rate = success_rate(by_direction[degrees])
        if rate is None:
            continue
        if rate < WEAK_BELOW:
            weak.append(degrees)
        elif rate > STRONG_ABOVE:
            strong.append(degrees)
    return FactsDirections(weak=weak, strong=strong)


def hand_loss_pct(trials: Sequence[Trial]) -> float | None:
    """The share of the movement trials' time with no fingertip: gaps over 200 ms between RAW
    points, over the time each trial's points span, 0-100. None without trajectories."""
    lost = total = 0.0
    for trial in trials:
        points = usable_samples([list(point) for point in trial.trajectory or []], min_width=3)
        if points.shape[0] < 2:
            continue
        steps = np.diff(points[:, 0])
        lost += float(np.sum(steps[steps > GAP_MS]))
        total += float(points[-1, 0] - points[0, 0])
    return round(100 * lost / total, 1) if total > 0 else None


def _next_session(
    session: Session, profile: PatientProfile, record: SessionRecord
) -> FactsNextSession | None:
    """The planner's plan for the next session, from every completed session up to this one."""
    if record.status != "completed":
        return None
    plan = planner.plan_next(session, profile, record)
    return FactsNextSession(
        focus_movements=plan.focus.movements,
        focus_directions=plan.focus.directions,
        planned_games=[game.game_id for game in plan.games],
    )


def build_facts(session: Session, record: SessionRecord) -> SessionFacts:
    assert record.id is not None
    profile = session.get(PatientProfile, record.patient_id)
    assert profile is not None
    history = _patient_sessions(session, record.patient_id)
    position = next(index for index, item in enumerate(history) if item.id == record.id)
    completed_before = sum(1 for item in history[:position] if item.status == "completed")

    runs = list(
        session.exec(
            select(GameRun).where(GameRun.session_id == record.id).order_by(col(GameRun.id))
        ).all()
    )
    trials: dict[int, list[Trial]] = defaultdict(list)
    run_ids = [run.id for run in runs if run.id is not None]
    if run_ids:
        statement = select(Trial).where(col(Trial.game_run_id).in_(run_ids))
        for trial in session.exec(statement).all():
            if trial.outcome != "aborted":
                trials[trial.game_run_id].append(trial)
    every = [trial for found in trials.values() for trial in found]
    by_game = {run.id: run.game_id for run in runs}
    reach = [trial for trial in every if by_game.get(trial.game_run_id) == "reach_activate"]
    moving = [trial for trial in every if by_game.get(trial.game_run_id) in SPATIAL_GAMES]

    feedback = session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == record.id)
    ).first()
    flags = set(record.flags or [])
    day = local_day(record.started_at, 0)
    completed_days = [
        local_day(item.started_at, 0)
        for item in history
        if item.status == "completed" and local_day(item.started_at, 0) <= day
    ]
    seconds = duration_seconds(record)

    return SessionFacts(
        session_id=record.id,
        patient_code=profile.patient_code,
        session_no=position + 1,
        language=profile.language,  # type: ignore[arg-type]
        affected_side=profile.affected_side,  # type: ignore[arg-type]
        duration_min=None if seconds is None else round(seconds / 60, 1),
        baseline_available=completed_before >= BASELINE_SESSIONS,
        games=_games(session, runs, trials),
        metrics=_metrics(session, record, history),
        directions=directions(reach),
        flags=FactsFlags(
            compensation_rate=flagged_rate(
                bool((trial.compensation or {}).get("flagged")) for trial in every
            ),
            fatigue_flag="high_fatigue" in flags,
            hand_loss_pct=hand_loss_pct(moving),
        ),
        self_report=(
            FactsSelfReport(
                pain_0_10=feedback.pain_0_10,
                fatigue_0_10=feedback.fatigue_0_10,
                enjoyment_1_5=feedback.enjoyment_1_5,
            )
            if feedback
            else None
        ),
        adherence=FactsAdherence(
            sessions_this_week=sessions_this_week(completed_days, day),
            planned_this_week=profile.weekly_goal,
        ),
        next_session=_next_session(session, profile, record),
        safety_notice_present=bool(flags & SAFETY_FLAGS),
    )

