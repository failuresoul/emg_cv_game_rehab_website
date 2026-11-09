from sqlalchemy import Integer, cast, func, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.core.security import hash_password
from app.models import PatientProfile, User
from app.schemas.patient import (
    AdminStats,
    PatientCreate,
    PatientProfileRead,
    PatientRead,
    PatientUpdate,
    PatientUserRead,
)
from app.services.session_feedback import count_open_alerts
from app.services.sessions import count_sessions_today
from app.services.users import get_user_by_email

_MAX_CODE_ATTEMPTS = 5
_USER_FIELDS = {"email", "full_name"}


class DuplicateEmailError(Exception):
    pass


def to_patient_read(profile: PatientProfile, user: User) -> PatientRead:
    return PatientRead(
        # Read through attributes: model_dump() on an instance expired by commit is empty.
        **PatientProfileRead.model_validate(profile).model_dump(),
        user=PatientUserRead.model_validate(user),
    )


def _next_patient_code(session: Session) -> str:
    # Compare numerically: as text, "P999" would sort after "P1000".
    number = cast(func.substr(PatientProfile.patient_code, 2), Integer)
    highest = session.exec(select(func.max(number))).one()
    return f"P{(highest or 0) + 1:03d}"


def create_patient(session: Session, payload: PatientCreate) -> PatientRead:
    """Create the user and profile in one transaction."""
    if get_user_by_email(session, payload.email) is not None:
        raise DuplicateEmailError

    hashed_password = hash_password(payload.password)
    profile_data = payload.model_dump(exclude={"email", "full_name", "password"})

    # Two simultaneous requests can pick the same code; the unique constraint catches it.
    for _ in range(_MAX_CODE_ATTEMPTS):
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            role="patient",
            hashed_password=hashed_password,
        )
        try:
            session.add(user)
            session.flush()
            assert user.id is not None
            profile = PatientProfile(
                **profile_data,
                user_id=user.id,
                patient_code=_next_patient_code(session),
            )
            session.add(profile)
            session.commit()
        except IntegrityError:
            session.rollback()
            if get_user_by_email(session, payload.email) is not None:
                raise DuplicateEmailError from None
            continue
        return to_patient_read(profile, user)

    raise RuntimeError("Could not allocate a patient code")


def list_patients(session: Session, search: str | None = None) -> list[PatientRead]:
    statement = select(PatientProfile, User).join(User, col(PatientProfile.user_id) == col(User.id))
    term = search.strip() if search else ""
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        statement = statement.where(
            or_(
                col(User.full_name).ilike(pattern, escape="\\"),
                col(User.email).ilike(pattern, escape="\\"),
                col(PatientProfile.patient_code).ilike(pattern, escape="\\"),
            )
        )
    rows = session.exec(statement.order_by(col(PatientProfile.id))).all()
    return [to_patient_read(profile, user) for profile, user in rows]


def get_patient(session: Session, patient_id: int) -> tuple[PatientProfile, User] | None:
    profile = session.get(PatientProfile, patient_id)
    if profile is None:
        return None
    user = session.get(User, profile.user_id)
    return (profile, user) if user is not None else None


def update_patient(
    session: Session, profile: PatientProfile, user: User, payload: PatientUpdate
) -> PatientRead:
    changes = payload.model_dump(exclude_unset=True)

    new_email = changes.get("email")
    if new_email is not None and new_email != user.email:
        if get_user_by_email(session, new_email) is not None:
            raise DuplicateEmailError

    password = changes.pop("password", None)
    if password is not None:
        user.hashed_password = hash_password(password)

    for field, value in changes.items():
        setattr(user if field in _USER_FIELDS else profile, field, value)

    session.add(user)
    session.add(profile)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DuplicateEmailError from None
    return to_patient_read(profile, user)


def set_patient_active(
    session: Session, profile: PatientProfile, user: User, is_active: bool
) -> PatientRead:
    user.is_active = is_active
    session.add(user)
    session.commit()
    return to_patient_read(profile, user)


def get_stats(session: Session) -> AdminStats:
    total = session.exec(select(func.count()).select_from(User).where(User.role == "patient")).one()
    active = session.exec(
        select(func.count())
        .select_from(User)
        .where(User.role == "patient", col(User.is_active).is_(True))
    ).one()
    return AdminStats(
        total_patients=total,
        active_patients=active,
        sessions_today=count_sessions_today(session),
        open_alerts=count_open_alerts(session),
    )
