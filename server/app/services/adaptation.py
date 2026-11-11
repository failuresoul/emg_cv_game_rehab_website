"""One step of the adaptive difficulty for a game run: learn from the last trial, apply the safety
rules, choose the next trial's settings, then save the state and log the decision.

The engine's reasons go to the admin and the research data only; the patient sees a level from 1
to 10 and, sometimes, a gentle cue.
"""

from datetime import timedelta

from sqlmodel import Session, col, select

from app.core.config import settings
from app.engine.base import Decision, EngineData, TrialResult
from app.engine.difficulty import level_of
from app.engine.safety import SafetyInput, TrialRecord, apply_safety
from app.models import AdaptationLog, GameRun, PatientProfile
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.engine import EngineNextResponse, LastTrial
from app.services import engine_store


class RunEndedError(Exception):
    """The run has already ended."""


def describe(decision: Decision) -> str:
    """The decision in plain words with its numbers, such as "Two successes in a row: spatial a
    little harder (0.52 -> 0.58)"."""
    if not decision.changes:
        return decision.reason
    moves = ", ".join(
        f"{component} {before:.2f} -> {after:.2f}"
        for component, (before, after) in decision.changes.items()
    )
    return f"{decision.reason.rstrip('.')} ({moves})."


def _record(trial: dict[str, object] | LastTrial) -> TrialRecord:
    data = trial.model_dump() if isinstance(trial, LastTrial) else trial
    time_ms = data.get("movement_ms")
    if time_ms is None:
        time_ms = data.get("completion_ms")
    peak = data.get("activation_peak")
    return TrialRecord(
        trial_no=int(data["trial_no"]),  # type: ignore[call-overload]
        outcome=str(data["outcome"]),
        compensated=bool(data.get("compensated")),
        time_ms=float(time_ms) if isinstance(time_ms, int | float) else None,
        activation_peak=float(peak) if isinstance(peak, int | float) else None,
    )


def active_minutes(session: Session, run: GameRun) -> float:
    """Minutes of game play in the run's session so far: every run's time, this one's up to now."""
    runs = session.exec(select(GameRun).where(GameRun.session_id == run.session_id)).all()
    now = utc_now()
    total = timedelta()
    for item in runs:
        end = item.ended_at if item.ended_at is not None else (now if item.id == run.id else None)
        if end is not None:
            total += max(as_utc(end) - as_utc(item.started_at), timedelta())
    return total.total_seconds() / 60


def _response(log: AdaptationLog) -> EngineNextResponse:
    return EngineNextResponse(
        params={key: float(value) for key, value in log.params.items()},
        level=level_of(EngineData.from_json(log.state_after).d),
        cue=log.cue,  # type: ignore[arg-type]
        decision=log.decision,
        safety_override=log.safety_override,
        engine=log.engine,
    )


def next_step(
    session: Session, profile: PatientProfile, run: GameRun, last_trial: LastTrial | None
) -> EngineNextResponse:
    """The next trial's settings. Reporting the same trial again returns the same answer."""
    if run.status != "active":
        raise RunEndedError
    assert run.id is not None
    trial_no = last_trial.trial_no if last_trial else 0
    existing = session.exec(
        select(AdaptationLog).where(
            AdaptationLog.game_run_id == run.id, AdaptationLog.trial_no == trial_no
        )
    ).first()
    if existing is not None:
        return _response(existing)

    loaded = engine_store.load(session, profile, run.game_id, run.session_id)
    before = loaded.state
    logs = list(
        session.exec(
            select(AdaptationLog)
            .where(AdaptationLog.game_run_id == run.id)
            .order_by(col(AdaptationLog.trial_no))
        ).all()
    )

    if last_trial is None:
        after, decision = before, Decision(loaded.engine.name, "Start of the game.")
        history: list[TrialRecord] = []
    else:
        outcome = last_trial.failure_type or last_trial.outcome
        if last_trial.outcome in ("success", "aborted"):
            outcome = last_trial.outcome
        after, decision = loaded.engine.update(before, TrialResult(outcome), loaded.context)
        history = [_record(log.trial) for log in logs if log.trial is not None]
        history.append(_record(last_trial))
        history = [trial for trial in history if trial.outcome != "aborted"]

    rests = [log.trial_no for log in logs if log.cue == "rest"]
    checked = apply_safety(
        SafetyInput(
            before=before,
            after=after,
            history=history,
            max_difficulty=loaded.context.max_difficulty,
            active_minutes=active_minutes(session, run),
            trials_since_rest=trial_no - rests[-1] if rests else None,
            finish_soon_minutes=settings.SESSION_FINISH_SOON_MIN,
            finish_minutes=settings.SESSION_FINISH_MIN,
        )
    )
    params, _ = loaded.engine.next_params(checked.state, loaded.context)
    engine_store.save(
        session, loaded, checked.state, run.session_id, trials=1 if last_trial else 0
    )
    log = AdaptationLog(
        game_run_id=run.id,
        trial_no=trial_no,
        engine=loaded.engine.name,
        state_before=before.to_json(),
        state_after=checked.state.to_json(),
        params=params,
        decision=describe(decision),
        safety_override=checked.safety_override,
        cue=checked.cue,
        trial=last_trial.model_dump() if last_trial else None,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return _response(log)
