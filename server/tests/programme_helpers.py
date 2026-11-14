"""Tests set a patient's programme directly (the API is tested in test_programme.py)."""

from typing import Any

from sqlmodel import Session

from app.models import PatientProfile, PatientProgramme
from app.services import programme as programmes


def set_programme(session: Session, profile: PatientProfile, **fields: Any) -> PatientProgramme:
    """Changes programme fields and commits. `max_difficulty` (0-1 per game, the old profile
    field) is accepted and stored as levels."""
    programme = programmes.programme_for(session, profile)
    caps = fields.pop("max_difficulty", None)
    if caps is not None:
        programme.max_level = {
            game: programmes.level_from_difficulty(value) for game, value in caps.items()
        }
    for name, value in fields.items():
        assert hasattr(programme, name), name
        setattr(programme, name, value)
    session.add(programme)
    session.commit()
    session.refresh(programme)
    return programme
