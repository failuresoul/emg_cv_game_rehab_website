"""Keeps each patient's difficulty per game and engine (EngineState) between trials and sessions.

At the start of each new session the engine renews the state: L1 eases every d by 0.05 (the warm
restart), so a patient never starts a day at the very edge of what they managed last time; L2
lets its beliefs drift back towards their priors.
"""

from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.engine import get_engine
from app.engine.base import WARM_RESTART, Engine, EngineContext, EngineData, warm_restart

__all__ = ["WARM_RESTART", "warm_restart"]  # re-exported: they used to live here
from app.engine.difficulty import clamp01
from app.models import Calibration, EngineState, PatientProfile, WarmupResult
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.services.game_settings import effective_params_for
from app.services.game_specs import get_spec

#: Key in EngineState.state of the session the state was last used in.
SESSION_KEY = "session_id"


class UnknownGameError(LookupError):
    """No game has this id."""


def starting_state(
    engine: Engine, context: EngineContext, stored: EngineData | None, new_session: bool
) -> EngineData:
    """The state a game starts from: the engine's initial state the first time; else the stored
    one, renewed by the engine the first time in a new session (adapting engines only: L1's warm
    restart, L2's forgetting). Always capped at the patient's maximum."""
    if stored is None:
        state = engine.initial(context)
    elif new_session and engine.adapts:
        state = engine.new_session(stored, context)
    else:
        state = stored
    cap = context.max_difficulty
    return state.with_d({component: min(d, cap) for component, d in state.d.items()})


def max_difficulty(profile: PatientProfile, game_id: str) -> float:
    """The admin's maximum for this patient and game: 1.0 unless set."""
    value = (profile.max_difficulty or {}).get(game_id, 1.0)
    try:
        return clamp01(float(value))
    except (TypeError, ValueError):
        return 1.0


@dataclass
class LoadedEngine:
    engine: Engine
    context: EngineContext
    row: EngineState
    state: EngineData


def latest_calibration(session: Session, profile: PatientProfile) -> tuple[float, ...] | None:
    row = session.exec(
        select(Calibration)
        .join(SessionRecord, col(SessionRecord.id) == col(Calibration.session_id))
        .where(SessionRecord.patient_id == profile.id)
        .order_by(col(Calibration.created_at).desc())
    ).first()
    return tuple(float(r) for r in row.reach_radii_sw) if row and row.reach_radii_sw else None


def latest_warmup(session: Session, profile: PatientProfile) -> dict[str, dict[str, float]] | None:
    """The most recent session's warm-up, per exercise: completion and compensation rate."""
    latest = session.exec(
        select(WarmupResult.session_id)
        .join(SessionRecord, col(SessionRecord.id) == col(WarmupResult.session_id))
        .where(SessionRecord.patient_id == profile.id)
        .order_by(col(SessionRecord.started_at).desc())
    ).first()
    if latest is None:
        return None
    rows = session.exec(select(WarmupResult).where(WarmupResult.session_id == latest)).all()
    return {
        row.exercise_id: {
            "completion": min(1.0, row.full_reps / row.target_reps) if row.target_reps else 0.0,
            "compensation_rate": float(row.compensation_rate),
        }
        for row in rows
    }


def context_for(
    session: Session, profile: PatientProfile, game_id: str, with_history: bool = False
) -> EngineContext:
    """The engine's context; `with_history` adds the latest calibration and warm-up, which only
    a first state needs (L2 seeds its beliefs from them)."""
    game = get_spec(game_id)
    if game is None:
        raise UnknownGameError(game_id)
    return EngineContext(
        game=game,
        settings=effective_params_for(session, game),
        max_difficulty=max_difficulty(profile, game_id),
        calibration=latest_calibration(session, profile) if with_history else None,
        warmup=latest_warmup(session, profile) if with_history else None,
    )


def load(
    session: Session, profile: PatientProfile, game_id: str, session_id: int | None
) -> LoadedEngine:
    """The patient's engine, context and state for a game. A first use starts from the admin's
    defaults; the first use in a new session applies the warm restart. Not saved until save()."""
    assert profile.id is not None
    engine = get_engine(profile.engine_mode)
    context = context_for(session, profile, game_id)
    row = session.exec(
        select(EngineState).where(
            EngineState.patient_id == profile.id,
            EngineState.game_id == game_id,
            EngineState.engine == engine.name,
        )
    ).first()
    if row is None:
        row = EngineState(patient_id=profile.id, game_id=game_id, engine=engine.name)
        seeded = context_for(session, profile, game_id, with_history=True)
        state = starting_state(engine, seeded, None, new_session=True)
    else:
        new_session = session_id is not None and row.state.get(SESSION_KEY) != session_id
        state = starting_state(engine, context, EngineData.from_json(row.state), new_session)
    return LoadedEngine(engine=engine, context=context, row=row, state=state)


def save(
    session: Session,
    loaded: LoadedEngine,
    state: EngineData,
    session_id: int | None,
    trials: int = 0,
    commit: bool = True,
) -> EngineState:
    """Stores the state (with the session it was used in) and counts the trials learned from.
    With commit=False it is only flushed, for a caller saving many steps at once."""
    row = loaded.row
    data = state.to_json()
    data[SESSION_KEY] = session_id if session_id is not None else row.state.get(SESSION_KEY)
    row.state = data
    row.trials_seen += trials
    row.updated_at = utc_now()
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    loaded.state = state
    return row
