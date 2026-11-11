"""Keeps each patient's difficulty per game and engine (EngineState) between trials and sessions.

At the start of each new session the difficulty eases a little (a warm restart: every d minus
0.05, not below 0), so a patient never starts a day at the very edge of what they managed last
time.
"""

from dataclasses import dataclass

from sqlmodel import Session, select

from app.engine import get_engine
from app.engine.base import Engine, EngineContext, EngineData
from app.engine.difficulty import clamp01
from app.models import EngineState, PatientProfile
from app.models.user import utc_now
from app.services.game_settings import effective_params_for
from app.services.game_specs import get_spec

WARM_RESTART = 0.05
#: Key in EngineState.state of the session the state was last used in.
SESSION_KEY = "session_id"


class UnknownGameError(LookupError):
    """No game has this id."""


def warm_restart(state: EngineData) -> EngineData:
    """Every d eased by 0.05 (not below 0), and the success streak started again."""
    return EngineData(
        d={component: round(max(0.0, d - WARM_RESTART), 4) for component, d in state.d.items()},
        streak=0,
        turn=state.turn,
    )


def starting_state(
    engine: Engine, context: EngineContext, stored: EngineData | None, new_session: bool
) -> EngineData:
    """The state a game starts from: the engine's initial state the first time; else the stored
    one, eased by the warm restart the first time in a new session (adapting engines only).
    Always capped at the patient's maximum."""
    if stored is None:
        state = engine.initial(context)
    elif new_session and engine.adapts:
        state = warm_restart(stored)
    else:
        state = stored
    cap = context.max_difficulty
    return EngineData(
        d={component: min(d, cap) for component, d in state.d.items()},
        streak=state.streak,
        turn=state.turn,
    )


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


def context_for(session: Session, profile: PatientProfile, game_id: str) -> EngineContext:
    game = get_spec(game_id)
    if game is None:
        raise UnknownGameError(game_id)
    return EngineContext(
        game=game,
        settings=effective_params_for(session, game),
        max_difficulty=max_difficulty(profile, game_id),
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
        state = starting_state(engine, context, None, new_session=True)
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
