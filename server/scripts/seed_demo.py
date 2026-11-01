"""Create two demo patients if missing and print their logins.

Run from server/: python scripts/seed_demo.py
"""

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session

from app.core.db import create_db_and_tables, engine
from app.schemas.common import AgeBand, Side
from app.schemas.patient import PatientCreate
from app.services.patients import create_patient
from app.services.users import get_user_by_email

DEMO_PATIENTS: list[tuple[str, str, Side, Side, AgeBand]] = [
    ("demo.left@example.com", "Demo Patient Left", "left", "right", "60-69"),
    ("demo.right@example.com", "Demo Patient Right", "right", "right", "50-59"),
]


def seed_demo(session: Session) -> list[tuple[str, str | None]]:
    """Return (email, password) per demo patient; password is None if it already existed."""
    logins: list[tuple[str, str | None]] = []
    for email, full_name, affected_side, dominant_side, age_band in DEMO_PATIENTS:
        if get_user_by_email(session, email) is not None:
            logins.append((email, None))
            continue

        # Random so no working login is committed, even if DATABASE_URL is a shared database.
        password = secrets.token_urlsafe(12)
        create_patient(
            session,
            PatientCreate(
                email=email,
                full_name=full_name,
                password=password,
                affected_side=affected_side,
                dominant_side=dominant_side,
                age_band=age_band,
                notes="Demo patient",
            ),
        )
        logins.append((email, password))
    return logins


def main() -> None:
    create_db_and_tables()
    with Session(engine) as session:
        for email, password in seed_demo(session):
            shown = password if password else "(already exists, password unchanged)"
            print(f"{email}  {shown}")


if __name__ == "__main__":
    main()
