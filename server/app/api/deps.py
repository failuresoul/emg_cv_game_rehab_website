from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from app.core.db import get_session
from app.core.security import decode_user_id
from app.models import PatientProfile, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], session: SessionDep) -> User:
    user_id = decode_user_id(token)
    user = session.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_patient(user: CurrentUser) -> User:
    if user.role != "patient":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Patient access required")
    return user


def get_current_patient(
    user: Annotated[User, Depends(require_patient)], session: SessionDep
) -> PatientProfile:
    profile = session.exec(select(PatientProfile).where(PatientProfile.user_id == user.id)).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return profile


CurrentPatient = Annotated[PatientProfile, Depends(get_current_patient)]

#: The browser's offset from UTC in minutes (UTC+6 is 360), so that days are the patient's own.
TzOffset = Annotated[
    int,
    Query(ge=-720, le=840, description="Minutes ahead of UTC; Dhaka (UTC+6) is 360"),
]
