"""The game settings the web app exports to shared/game-specs.json, read by the server.

The web registry is the one source of each game's settings and their ranges; `npm run
export:specs` writes them to the file, and a web test fails when the file is out of date.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.core.config import settings


class ParamSpec(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    name: str
    label_key: str
    min: float
    max: float
    step: float
    default: float
    unit: str
    harder: Literal["higher", "lower"] | None


class GameSpec(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str
    name_key: str
    description_key: str
    movement_key: str
    implemented: bool
    trials_default: int
    estimated_minutes: float
    params: tuple[ParamSpec, ...]

    def param(self, name: str) -> ParamSpec | None:
        return next((spec for spec in self.params if spec.name == name), None)

    @property
    def defaults(self) -> dict[str, float]:
        return {spec.name: spec.default for spec in self.params}


class _SpecFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    games: list[GameSpec]


class GameSpecsUnavailableError(RuntimeError):
    """shared/game-specs.json is missing or not valid."""


@lru_cache(maxsize=4)
def _load(path: Path) -> tuple[GameSpec, ...]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise GameSpecsUnavailableError(f"Cannot read the game specs at {path}: {error}") from error
    return tuple(_SpecFile.model_validate(data).games)


def load_specs() -> tuple[GameSpec, ...]:
    """Every game's spec, in the registry's order. Read once and kept."""
    return _load(settings.game_specs_path)


def get_spec(game_id: str) -> GameSpec | None:
    return next((spec for spec in load_specs() if spec.id == game_id), None)
