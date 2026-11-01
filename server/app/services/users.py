from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.models import User
from app.models.user import utc_now

# Verified when the email is unknown, so both login failures take similar time.
_DUMMY_HASH = hash_password("motionlab-dummy-password")


def get_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email.strip().lower())).first()


def authenticate(session: Session, email: str, password: str) -> User | None:
    """Return the active user matching the credentials, with last_login_at updated."""
    user = get_user_by_email(session, email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, user.hashed_password) or not user.is_active:
        return None

    user.last_login_at = utc_now()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def ensure_admin(session: Session) -> None:
    """Create the admin from settings if no admin exists."""
    if session.exec(select(User).where(User.role == "admin")).first() is not None:
        return

    session.add(
        User(
            email=settings.ADMIN_EMAIL.strip().lower(),
            full_name=settings.ADMIN_NAME,
            role="admin",
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
        )
    )
    session.commit()
