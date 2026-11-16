"""The EMG thresholds (sensor check, calibration, smoothing, onsets): their defaults and limits
are in app/core/emg_settings.json, identical to web/src/emg/emgSettings.json (a test checks), and
the admin's changes are stored in one row. Only values inside the limits are accepted."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.models.emg_settings import EmgSettingsRecord
from app.models.user import User, utc_now

SPEC_PATH = Path(__file__).resolve().parents[1] / "core" / "emg_settings.json"
ROW_ID = 1


@cache
def spec() -> dict[str, dict[str, Any]]:
    """Setting name -> {group, default, min, max, integer, unit}."""
    data = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    settings: dict[str, dict[str, Any]] = data["settings"]
    return settings


def defaults() -> dict[str, float]:
    return {key: float(rule["default"]) for key, rule in spec().items()}


class InvalidEmgSettings(ValueError):
    """Some values cannot be used; `problems` maps each setting to why."""

    def __init__(self, problems: dict[str, str]) -> None:
        super().__init__("; ".join(f"{key}: {why}" for key, why in problems.items()))
        self.problems = problems


def validate(overrides: dict[str, float]) -> dict[str, float]:
    """The changes, checked against the limits; raises InvalidEmgSettings."""
    rules = spec()
    problems: dict[str, str] = {}
    clean: dict[str, float] = {}
    for key, value in overrides.items():
        rule = rules.get(key)
        if rule is None:
            problems[key] = "unknown setting"
            continue
        if rule["integer"] and float(value) != int(value):
            problems[key] = "must be a whole number"
        elif not rule["min"] <= value <= rule["max"]:
            problems[key] = f"must be between {rule['min']} and {rule['max']}"
        else:
            clean[key] = int(value) if rule["integer"] else float(value)
    merged = {**defaults(), **clean}
    if merged["minRateHz"] >= merged["maxRateHz"]:
        problems["minRateHz"] = "must be below maxRateHz"
    if problems:
        raise InvalidEmgSettings(problems)
    # Values equal to their default are not changes.
    return {key: value for key, value in clean.items() if value != rules[key]["default"]}


def get(session: Session) -> EmgSettingsRecord | None:
    return session.get(EmgSettingsRecord, ROW_ID)


def save(session: Session, overrides: dict[str, float], user: User) -> EmgSettingsRecord:
    clean = validate(overrides)
    record = get(session) or EmgSettingsRecord(id=ROW_ID)
    record.overrides = clean
    record.updated_at = utc_now()
    record.updated_by_id = user.id
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def reset(session: Session, user: User) -> EmgSettingsRecord:
    return save(session, {}, user)
