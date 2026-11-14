"""The difficulty level (1-10) the patient sees, from the engine's logged decisions and states."""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, col, select

from app.engine.base import EngineData
from app.engine.difficulty import level_of
from app.models import AdaptationLog, EngineState, PatientProfile
from app.services import programme as programmes
from app.schemas.game import AdaptationLogRead


def level_of_state(state: dict[str, Any] | None) -> int:
    return level_of(EngineData.from_json(state or {}).d)


@dataclass(frozen=True)
class RunLevels:
    #: The level the run started at (after the first decision) and the one it ended at.
    start: int
    end: int


def logs_for_runs(session: Session, run_ids: Sequence[int]) -> dict[int, list[AdaptationLog]]:
    if not run_ids:
        return {}
    statement = (
        select(AdaptationLog)
        .where(col(AdaptationLog.game_run_id).in_(list(run_ids)))
        .order_by(col(AdaptationLog.game_run_id), col(AdaptationLog.trial_no))
    )
    grouped: dict[int, list[AdaptationLog]] = defaultdict(list)
    for log in session.exec(statement).all():
        grouped[log.game_run_id].append(log)
    return grouped


def run_levels(session: Session, run_ids: Sequence[int]) -> dict[int, RunLevels]:
    """Each run's first and last level; runs without logged decisions are left out."""
    return {
        run_id: RunLevels(
            start=level_of_state(logs[0].state_after), end=level_of_state(logs[-1].state_after)
        )
        for run_id, logs in logs_for_runs(session, run_ids).items()
        if logs
    }


def to_read(log: AdaptationLog) -> AdaptationLogRead:
    return AdaptationLogRead(
        trial_no=log.trial_no,
        engine=log.engine,
        state_before=log.state_before,
        state_after=log.state_after,
        params=log.params,
        decision=log.decision,
        safety_override=log.safety_override,
        cue=log.cue,
        trial=log.trial,
        details=log.details,
        level=level_of_state(log.state_after),
        created_at=log.created_at,
    )


def patient_engine_states(session: Session, profile: PatientProfile) -> list[EngineState]:
    """The patient's stored difficulty per game for their current engine, by game id."""
    statement = (
        select(EngineState)
        .where(
            EngineState.patient_id == profile.id,
            EngineState.engine == programmes.programme_for(session, profile).engine_mode,
        )
        .order_by(col(EngineState.game_id))
    )
    return list(session.exec(statement).all())
