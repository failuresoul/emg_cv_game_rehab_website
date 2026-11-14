"""One step of the adaptive difficulty for a game run: learn from the last trial, apply the safety
rules, choose the next trial's settings, then save the state and log the decision.

The engine's reasons go to the admin and the research data only; the patient sees a level from 1
to 10 and, sometimes, a gentle cue.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.core.config import settings
from app.engine.base import Decision, Engine, EngineContext, EngineData, Target, TrialResult
from app.engine.difficulty import level_of
from app.engine.safety import Cue, SafetyInput, SafetyResult, TrialRecord, apply_safety
from app.models import AdaptationLog, GameRun, PatientProfile
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.engine import EngineNextResponse, LastTrial
from app.services import engine_store
from app.services import programme as programmes


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


#: Fields of LastTrial left out of the stored summary when the browser does not send them.
_OPTIONAL_LOCATION = ("direction_deg", "distance_frac", "side")


def trial_json(trial: LastTrial) -> dict[str, Any]:
    """The trial summary as stored in the decision log: where the target was only when known."""
    data = trial.model_dump()
    for key in _OPTIONAL_LOCATION:
        if data.get(key) is None:
            data.pop(key, None)
    return data


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


@dataclass(frozen=True)
class PastStep:
    """An earlier decision of the same run, as the next step needs it."""

    trial_no: int
    #: The trial summary the decision learned from (LastTrial as a dict); None at the start.
    trial: dict[str, Any] | None
    cue: str | None


@dataclass(frozen=True)
class Step:
    """One decision: the new state, the next trial's settings and what to tell whom."""

    state: EngineData
    params: dict[str, float]
    decision: str
    safety_override: str | None
    cue: Cue | None
    level: int
    #: Where the next target goes (L2, spatial games); else None.
    target: Target | None = None
    #: The engine's extra report (L2: samples and choices), with the target; None if empty.
    details: dict[str, Any] | None = None


def decide(
    engine: Engine,
    context: EngineContext,
    before: EngineData,
    last_trial: LastTrial | None,
    past: Sequence[PastStep],
    active_minutes: float = 0.0,
    finish_soon_minutes: float | None = None,
    finish_minutes: float | None = None,
    safety: bool = True,
    minutes_since_rest: float | None = None,
    rest_every_minutes: float | None = None,
) -> Step:
    """The engine learns from the last trial, the safety rules check its proposal, and the next
    trial's settings follow. Pure: the API (next_step) and the simulator (app.engine.sim) both
    use it, so they share one code path. safety=False is only for ablation studies in the
    simulator: the API always applies the safety rules."""
    trial_no = last_trial.trial_no if last_trial else 0
    if last_trial is None:
        after, decision = before, Decision(engine.name, "Start of the game.")
        history: list[TrialRecord] = []
    else:
        outcome = last_trial.failure_type or last_trial.outcome
        if last_trial.outcome in ("success", "aborted"):
            outcome = last_trial.outcome
        result = TrialResult(
            outcome,
            compensated=last_trial.compensated,
            direction_deg=last_trial.direction_deg,
            distance_frac=last_trial.distance_frac,
            side=last_trial.side,
        )
        after, decision = engine.update(before, result, context)
        history = [_record(step.trial) for step in past if step.trial is not None]
        history.append(_record(last_trial))
        history = [trial for trial in history if trial.outcome != "aborted"]

    rests = [step.trial_no for step in past if step.cue == "rest"]
    if not safety:
        checked = SafetyResult(state=after)
    else:
        checked = apply_safety(
            SafetyInput(
                before=before,
                after=after,
                history=history,
                max_difficulty=context.max_difficulty,
                active_minutes=active_minutes,
                trials_since_rest=trial_no - rests[-1] if rests else None,
                finish_soon_minutes=(
                    settings.SESSION_FINISH_SOON_MIN
                    if finish_soon_minutes is None
                    else finish_soon_minutes
                ),
                finish_minutes=(
                    settings.SESSION_FINISH_MIN if finish_minutes is None else finish_minutes
                ),
                minutes_since_rest=minutes_since_rest,
                rest_every_minutes=rest_every_minutes,
            )
        )
    if not engine.adapts:
        # Fixed settings: the cues still help the patient, but nothing is eased.
        checked.state = before
        checked.overrides = []
    params, _ = engine.next_params(checked.state, context)
    # After the safety rules: a target follows any easing of the spatial difficulty.
    target = engine.target(checked.state, context)
    details = dict(decision.details)
    if target is not None:
        details["target"] = {
            "direction_deg": target.direction_deg,
            "side": target.side,
            "distance_frac": target.distance_frac,
            "sector": target.sector,
        }
    return Step(
        state=checked.state,
        params=params,
        decision=describe(decision),
        safety_override=checked.safety_override,
        cue=checked.cue,
        level=level_of(checked.state.d),
        target=target,
        details=details or None,
    )


def active_minutes(
    session: Session, run: GameRun, now: datetime | None = None, until: datetime | None = None
) -> float:
    """Minutes of game play in the run's session so far: every run's time, this one's up to now.
    With `until`, only the play before that moment."""
    runs = session.exec(select(GameRun).where(GameRun.session_id == run.session_id)).all()
    now = now or utc_now()
    total = timedelta()
    for item in runs:
        end = item.ended_at if item.ended_at is not None else (now if item.id == run.id else None)
        if end is None:
            continue
        end = as_utc(end)
        if until is not None:
            end = min(end, as_utc(until))
        total += max(end - as_utc(item.started_at), timedelta())
    return total.total_seconds() / 60


def minutes_since_rest(session: Session, run: GameRun, now: datetime | None = None) -> float:
    """Minutes of play in the run's session since its last "rest" cue, or since the start."""
    last = session.exec(
        select(AdaptationLog)
        .join(GameRun, col(GameRun.id) == col(AdaptationLog.game_run_id))
        .where(GameRun.session_id == run.session_id, AdaptationLog.cue == "rest")
        .order_by(col(AdaptationLog.created_at).desc())
    ).first()
    played = active_minutes(session, run, now)
    if last is None:
        return played
    return max(0.0, played - active_minutes(session, run, now, until=last.created_at))


def _existing(session: Session, run_id: int, trial_no: int) -> AdaptationLog | None:
    statement = select(AdaptationLog).where(
        AdaptationLog.game_run_id == run_id, AdaptationLog.trial_no == trial_no
    )
    return session.exec(statement).first()


def _response(log: AdaptationLog) -> EngineNextResponse:
    target = (log.details or {}).get("target") or {}
    return EngineNextResponse(
        direction_deg=target.get("direction_deg"),
        distance_frac=target.get("distance_frac"),
        sector=target.get("sector"),
        side=target.get("side"),
        params={key: float(value) for key, value in log.params.items()},
        level=level_of(EngineData.from_json(log.state_after).d),
        cue=log.cue,  # type: ignore[arg-type]
        decision=log.decision,
        safety_override=log.safety_override,
        engine=log.engine,
    )


def next_step(
    session: Session,
    profile: PatientProfile,
    run: GameRun,
    last_trial: LastTrial | None,
    now: datetime | None = None,
    replay: bool = False,
) -> EngineNextResponse:
    """The next trial's settings. Reporting the same trial again returns the same answer.

    `now` and `replay` are for replaying saved trials (the demo data): the time the trial ended,
    and allowing a run that is no longer active. A replay flushes rather than commits; the caller
    commits.
    """
    if run.status != "active" and not replay:
        raise RunEndedError
    assert run.id is not None
    trial_no = last_trial.trial_no if last_trial else 0
    existing = _existing(session, run.id, trial_no)
    if existing is not None:
        return _response(existing)

    loaded = engine_store.load(
        session, profile, run.game_id, run.session_id, engine_mode=run.engine
    )
    before = loaded.state
    logs = list(
        session.exec(
            select(AdaptationLog)
            .where(AdaptationLog.game_run_id == run.id)
            .order_by(col(AdaptationLog.trial_no))
        ).all()
    )

    step = decide(
        loaded.engine,
        loaded.context,
        before,
        last_trial,
        [PastStep(log.trial_no, log.trial, log.cue) for log in logs],
        active_minutes=active_minutes(session, run, now),
        minutes_since_rest=minutes_since_rest(session, run, now),
        rest_every_minutes=float(programmes.programme_for(session, profile).rest_every_minutes),
    )
    engine_store.save(
        session,
        loaded,
        step.state,
        run.session_id,
        trials=1 if last_trial else 0,
        commit=False,
    )
    log = AdaptationLog(
        game_run_id=run.id,
        trial_no=trial_no,
        engine=loaded.engine.name,
        state_before=before.to_json(),
        state_after=step.state.to_json(),
        params=step.params,
        decision=step.decision,
        safety_override=step.safety_override,
        cue=step.cue,
        trial=trial_json(last_trial) if last_trial else None,
        details=step.details,
        created_at=now if now is not None else utc_now(),
    )
    session.add(log)
    if replay:
        session.flush()
        return _response(log)
    try:
        session.commit()
    except IntegrityError:
        # The same trial reported twice at once: the first answer stands.
        session.rollback()
        stored = _existing(session, run.id, trial_no)
        if stored is None:
            raise
        return _response(stored)
    session.refresh(log)
    return _response(log)
