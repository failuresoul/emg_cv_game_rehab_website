"""The admin's game settings: which games patients see, and the defaults they start from."""

from sqlmodel import Session, select

from app.models import GameSetting
from app.models.user import utc_now
from app.schemas.game_setting import AdminGameRead, GameSettingUpdate, PatientGameSetting
from app.services.game_specs import GameSpec, get_spec, load_specs


class UnknownGameError(LookupError):
    """No game has this id."""


class InvalidSettingError(ValueError):
    """A default the game does not have, or one outside its range."""


def _get_row(session: Session, game_id: str) -> GameSetting | None:
    return session.exec(select(GameSetting).where(GameSetting.game_id == game_id)).first()


def _spec_or_raise(game_id: str) -> GameSpec:
    spec = get_spec(game_id)
    if spec is None:
        raise UnknownGameError(game_id)
    return spec


def validate_defaults(spec: GameSpec, defaults: dict[str, float]) -> None:
    """Each default must be one of the game's settings and within its min and max."""
    for name, value in defaults.items():
        param = spec.param(name)
        if param is None:
            raise InvalidSettingError(f"{spec.id} has no setting {name!r}")
        if not param.min <= value <= param.max:
            raise InvalidSettingError(
                f"{name} must be between {param.min:g} and {param.max:g}, not {value:g}"
            )


def effective_params(spec: GameSpec, row: GameSetting | None) -> dict[str, float]:
    """Every setting's starting value. A saved default no longer valid (the game's settings
    changed since) is ignored, so patients always start inside the ranges."""
    saved = row.default_params if row else {}
    values: dict[str, float] = {}
    for param in spec.params:
        value = saved.get(param.name)
        valid = isinstance(value, int | float) and param.min <= value <= param.max
        values[param.name] = float(value) if valid else param.default
    return values


def effective_trials(spec: GameSpec, row: GameSetting | None) -> int:
    return row.trials_default if row and row.trials_default is not None else spec.trials_default


def _admin_view(spec: GameSpec, row: GameSetting | None) -> AdminGameRead:
    return AdminGameRead(
        spec=spec,
        enabled=row.enabled if row else True,
        default_params=dict(row.default_params) if row else {},
        trials_default=row.trials_default if row else None,
        notes=row.notes if row else None,
        updated_at=row.updated_at if row else None,
        effective_params=effective_params(spec, row),
        effective_trials=effective_trials(spec, row),
    )


def list_admin(session: Session) -> list[AdminGameRead]:
    rows = {row.game_id: row for row in session.exec(select(GameSetting)).all()}
    return [_admin_view(spec, rows.get(spec.id)) for spec in load_specs()]


def update(session: Session, game_id: str, payload: GameSettingUpdate) -> AdminGameRead:
    spec = _spec_or_raise(game_id)
    validate_defaults(spec, payload.default_params)
    row = _get_row(session, game_id) or GameSetting(game_id=game_id)
    row.enabled = payload.enabled
    row.default_params = dict(payload.default_params)
    row.trials_default = payload.trials_default
    row.notes = payload.notes or None
    row.updated_at = utc_now()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _admin_view(spec, row)


def reset(session: Session, game_id: str) -> AdminGameRead:
    """Back to the game's own defaults, enabled, with no notes."""
    spec = _spec_or_raise(game_id)
    row = _get_row(session, game_id)
    if row is not None:
        session.delete(row)
        session.commit()
    return _admin_view(spec, None)


def patient_settings(session: Session) -> list[PatientGameSetting]:
    """The games patients may play (built and enabled), with their starting values."""
    rows = {row.game_id: row for row in session.exec(select(GameSetting)).all()}
    settings: list[PatientGameSetting] = []
    for spec in load_specs():
        row = rows.get(spec.id)
        if not spec.implemented or (row is not None and not row.enabled):
            continue
        settings.append(
            PatientGameSetting(
                game_id=spec.id,
                params=effective_params(spec, row),
                trials=effective_trials(spec, row),
            )
        )
    return settings
