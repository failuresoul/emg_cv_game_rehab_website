from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.security import create_access_token
from app.models import PatientProfile
from app.schemas.patient import PatientProfileRead
from app.schemas.user import LoginResponse, MeRead, UserRead
from app.services.users import authenticate

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], session: SessionDep
) -> LoginResponse:
    user = authenticate(session, form.username, form.password)
    if user is None or user.id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return LoginResponse(
        access_token=create_access_token(user.id, user.role),
        user=UserRead.model_validate(user),
    )


@router.get("/me")
def me(user: CurrentUser, session: SessionDep) -> MeRead:
    profile = session.exec(select(PatientProfile).where(PatientProfile.user_id == user.id)).first()
    return MeRead(
        **UserRead.model_validate(user).model_dump(),
        patient_profile=PatientProfileRead.model_validate(profile) if profile else None,
    )
