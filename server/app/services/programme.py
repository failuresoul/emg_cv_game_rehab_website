"""Each patient's programme: get or make it, change it (with a history row per field), and the
values the engine, planner, warm-up and games read from it.

Made with the patient. For profiles from before Day 17 it is made from their old profile fields
(weekly_goal, engine_mode, max_difficulty), at start-up (migrate_programmes) or the first time it
is needed. Those profile fields are never read again.
"""

import math
from typing import Any

from sqlalchemy import Engine
from sqlmodel import Session, col, select

from app.models import GameSetting, PatientProfile, PatientProgramme, ProgrammeChange, User
from app.models.user import utc_now
from app.schemas.game import GAME_IDS
from app.schemas.programme import (
    DEFAULT_GAMES,
    DEFAULT_MINUTES,
    DEFAULT_REST,
    EXERCISE_IDS,
    GamesPerSession,
    PatientProgrammeRead,
    ProgrammeChangeRead,
    ProgrammeFields,
    ProgrammeRead,
    ProgrammeUpdate,
)
from app.services.game_specs import load_specs

MAX_LEVEL = 10
DEFAULT_WEEKLY_GOAL = 5
DEFAULT_ENGINE_MODE = "L1"
#: The fields of ProgrammeFields, in the order the history lists them.
FIELDS: tuple[str, ...] = tuple(ProgrammeFields.model_fields)


class LibraryDisabledError(ValueError):
    """The programme turns on a game that the Game Library has turned off."""

    def __init__(self, game_ids: list[str]) -> None:
        self.game_ids = game_ids
        super().__init__(
            "Turned off in the Game Library, so it cannot be in a programme: " + ", ".join(game_ids)
        )


def implemented_games() -> list[str]:
    return [spec.id for spec in load_specs() if spec.implemented and spec.id in GAME_IDS]


def level_from_difficulty(value: Any) -> int:
    """An old maximum difficulty (0-1) as a level 1-10, rounded down so it is never looser."""
    try:
        d = float(value)
    except (TypeError, ValueError):
        return MAX_LEVEL
    if not math.isfinite(d):
        return MAX_LEVEL
    return max(1, min(MAX_LEVEL, math.floor(d * 10 + 1e-9)))


def new_programme(profile: PatientProfile, weekly_goal: int | None = None) -> PatientProgramme:
    """A programme from the profile's old fields: every game and exercise on, levels from the
    old maximum difficulty, and the old engine mode and weekly goal."""
    assert profile.id is not None
    old_caps = profile.max_difficulty or {}
    goal = weekly_goal if weekly_goal is not None else getattr(profile, "weekly_goal", None)
    mode = getattr(profile, "engine_mode", None)
    return PatientProgramme(
        patient_id=profile.id,
        enabled_games=implemented_games(),
        max_level={
            game_id: level_from_difficulty(value)
            for game_id, value in old_caps.items()
            if game_id in GAME_IDS and level_from_difficulty(value) < MAX_LEVEL
        },
        session_minutes_target=DEFAULT_MINUTES,
        games_per_session_min=DEFAULT_GAMES[0],
        games_per_session_max=DEFAULT_GAMES[1],
        warmup_exercises=list(EXERCISE_IDS),
        warmup_preset="personal",
        rest_every_minutes=DEFAULT_REST,
        engine_mode=mode if mode in ("L0", "L1", "L2") else DEFAULT_ENGINE_MODE,
        emg_default_site=None,
        weekly_goal=goal if isinstance(goal, int) and 1 <= goal <= 14 else DEFAULT_WEEKLY_GOAL,
    )


def find(session: Session, patient_id: int) -> PatientProgramme | None:
    return session.exec(
        select(PatientProgramme).where(PatientProgramme.patient_id == patient_id)
    ).first()


def programme_for(session: Session, profile: PatientProfile) -> PatientProgramme:
    """The patient's programme, made (and saved) from the old profile fields if missing."""
    assert profile.id is not None
    found = find(session, profile.id)
    if found is not None:
        return found
    programme = new_programme(profile)
    session.add(programme)
    session.commit()
    session.refresh(programme)
    return programme


def migrate_programmes(target: Engine) -> int:
    """Makes a programme for every profile without one. Returns how many were made."""
    made = 0
    with Session(target) as session:
        have = set(session.exec(select(PatientProgramme.patient_id)).all())
        for profile in session.exec(select(PatientProfile)).all():
            if profile.id is not None and profile.id not in have:
                session.add(new_programme(profile))
                made += 1
        if made:
            session.commit()
    return made


# ---- Values the rest of the server reads ------------------------------------------------------


def library_disabled(session: Session) -> list[str]:
    return sorted(
        row.game_id
        for row in session.exec(select(GameSetting)).all()
        if not row.enabled and row.game_id in GAME_IDS
    )


def allowed_games(session: Session, programme: PatientProgramme) -> list[str]:
    """The games the patient may play: the programme's, among those the library allows."""
    off = set(library_disabled(session))
    return [game for game in programme.enabled_games if game not in off]


def max_level(programme: PatientProgramme, game_id: str) -> int:
    value = (programme.max_level or {}).get(game_id, MAX_LEVEL)
    return value if isinstance(value, int) and 1 <= value <= MAX_LEVEL else MAX_LEVEL


def max_difficulty(programme: PatientProgramme, game_id: str) -> float:
    """The engine's cap for a game: level / 10."""
    return max_level(programme, game_id) / MAX_LEVEL


# ---- Reading and changing -----------------------------------------------------------------------


def _fields(programme: PatientProgramme) -> dict[str, Any]:
    return {
        "enabled_games": list(programme.enabled_games or []),
        "max_level": dict(programme.max_level or {}),
        "session_minutes_target": programme.session_minutes_target,
        "games_per_session": {
            "min": programme.games_per_session_min,
            "max": programme.games_per_session_max,
        },
        "warmup_exercises": list(programme.warmup_exercises or []),
        "warmup_preset": programme.warmup_preset,
        "rest_every_minutes": programme.rest_every_minutes,
        "engine_mode": programme.engine_mode,
        "emg_default_site": programme.emg_default_site,
        "weekly_goal": programme.weekly_goal,
        "notes": programme.notes,
    }


def to_read(session: Session, programme: PatientProgramme) -> ProgrammeRead:
    return ProgrammeRead.model_validate(
        {
            **_fields(programme),
            "patient_id": programme.patient_id,
            "library_disabled_games": library_disabled(session),
            "updated_at": programme.updated_at,
        }
    )


def to_patient_read(session: Session, programme: PatientProgramme) -> PatientProgrammeRead:
    return PatientProgrammeRead(
        enabled_games=allowed_games(session, programme),  # type: ignore[arg-type]
        warmup_exercises=[e for e in EXERCISE_IDS if e in (programme.warmup_exercises or [])],  # type: ignore[misc]
        warmup_preset=programme.warmup_preset,  # type: ignore[arg-type]
        rest_every_minutes=programme.rest_every_minutes,
        emg_default_site=programme.emg_default_site,  # type: ignore[arg-type]
        weekly_goal=programme.weekly_goal,
    )


def _normalised(values: dict[str, Any]) -> dict[str, Any]:
    """Comparable values: lists in a fixed order, levels of 10 left out (10 is the default)."""
    out = dict(values)
    order = {game: index for index, game in enumerate(GAME_IDS)}
    out["enabled_games"] = sorted(out["enabled_games"], key=lambda game: order.get(game, 99))
    exercise_order = {exercise: index for index, exercise in enumerate(EXERCISE_IDS)}
    out["warmup_exercises"] = sorted(
        out["warmup_exercises"], key=lambda exercise: exercise_order.get(exercise, 99)
    )
    out["max_level"] = {
        game: level
        for game, level in sorted(out["max_level"].items(), key=lambda item: order.get(item[0], 99))
        if level != MAX_LEVEL
    }
    return out


def update(
    session: Session,
    programme: PatientProgramme,
    payload: ProgrammeFields,
    admin_id: int | None,
    reason: str | None = None,
) -> list[ProgrammeChange]:
    """Saves the whole programme and one history row per changed field. Raises
    LibraryDisabledError for a game the library has turned off."""
    new = _normalised(payload.model_dump(exclude={"reason"}, mode="json"))
    off = set(library_disabled(session))
    blocked = [game for game in new["enabled_games"] if game in off]
    if blocked:
        raise LibraryDisabledError(blocked)
    old = _normalised(_fields(programme))
    changes = [
        ProgrammeChange(
            patient_id=programme.patient_id,
            admin_id=admin_id,
            field=name,
            before=old[name],
            after=new[name],
            reason=reason,
        )
        for name in FIELDS
        if old[name] != new[name]
    ]
    if not changes:
        return []
    programme.enabled_games = new["enabled_games"]
    programme.max_level = new["max_level"]
    programme.session_minutes_target = new["session_minutes_target"]
    programme.games_per_session_min = new["games_per_session"]["min"]
    programme.games_per_session_max = new["games_per_session"]["max"]
    programme.warmup_exercises = new["warmup_exercises"]
    programme.warmup_preset = new["warmup_preset"]
    programme.rest_every_minutes = new["rest_every_minutes"]
    programme.engine_mode = new["engine_mode"]
    programme.emg_default_site = new["emg_default_site"]
    programme.weekly_goal = new["weekly_goal"]
    programme.notes = new["notes"]
    programme.updated_at = utc_now()
    session.add(programme)
    for change in changes:
        session.add(change)
    session.commit()
    session.refresh(programme)
    return changes


def update_some(
    session: Session,
    programme: PatientProgramme,
    values: dict[str, Any],
    admin_id: int | None,
    reason: str | None = None,
) -> list[ProgrammeChange]:
    """Changes only the given fields (the patient form's weekly goal and engine mode), through
    the same validation and history as a full update."""
    current = _fields(programme)
    current.update(values)
    payload = ProgrammeUpdate.model_validate({**current, "reason": reason})
    return update(session, programme, payload, admin_id, reason)


def history(session: Session, patient_id: int) -> list[ProgrammeChangeRead]:
    rows = session.exec(
        select(ProgrammeChange)
        .where(ProgrammeChange.patient_id == patient_id)
        .order_by(col(ProgrammeChange.created_at).desc(), col(ProgrammeChange.id).desc())
    ).all()
    names = {
        user.id: user.full_name
        for user in session.exec(
            select(User).where(col(User.id).in_({row.admin_id for row in rows if row.admin_id}))
        ).all()
    } if rows else {}
    return [
        ProgrammeChangeRead.model_validate(row).model_copy(
            update={"admin_name": names.get(row.admin_id) if row.admin_id else None}
        )
        for row in rows
    ]


__all__ = [
    "GamesPerSession",
    "LibraryDisabledError",
    "allowed_games",
    "history",
    "max_difficulty",
    "migrate_programmes",
    "programme_for",
    "to_patient_read",
    "to_read",
    "update",
    "update_some",
]
