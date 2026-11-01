from sqlmodel import Session, select

from app.models import PatientProfile
from app.services.users import authenticate
from scripts.seed_demo import seed_demo


def test_seed_demo_creates_both_sides_with_working_logins(session: Session) -> None:
    logins = seed_demo(session)

    sides = {profile.affected_side for profile in session.exec(select(PatientProfile)).all()}
    assert sides == {"left", "right"}
    for email, password in logins:
        assert password is not None
        assert authenticate(session, email, password) is not None


def test_seed_demo_is_idempotent(session: Session) -> None:
    seed_demo(session)
    logins = seed_demo(session)

    assert all(password is None for _, password in logins)
    assert len(session.exec(select(PatientProfile)).all()) == 2
