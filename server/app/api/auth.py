from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.security import create_access_token
from app.models import PatientProfile
from app.schemas.patient import PatientCreate, PatientRegister
from app.schemas.user import LoginResponse, MeRead, UserRead
from app.services import patients
from app.services.login_limits import login_limiter
from app.services.users import authenticate

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], session: SessionDep
) -> LoginResponse:
    # 5 failed attempts per email in 15 minutes, then a pause (login_limits).
    wait = login_limiter.retry_after(form.username)
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please wait and try again.",
            headers={"Retry-After": str(wait)},
        )
    user = authenticate(session, form.username, form.password)
    if user is None or user.id is None:
        login_limiter.failed(form.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    login_limiter.succeeded(form.username)
    return LoginResponse(
        access_token=create_access_token(user.id, user.role),
        user=UserRead.model_validate(user),
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: PatientRegister, session: SessionDep) -> LoginResponse:
    try:
        patients.create_patient(session, PatientCreate(**payload.model_dump()))
    except patients.DuplicateEmailError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from None

    user = authenticate(session, payload.email, payload.password)
    assert user is not None and user.id is not None
    return LoginResponse(
        access_token=create_access_token(user.id, user.role),
        user=UserRead.model_validate(user),
    )


@router.get("/me")
def me(user: CurrentUser, session: SessionDep) -> MeRead:
    profile = session.exec(select(PatientProfile).where(PatientProfile.user_id == user.id)).first()
    return MeRead(
        **UserRead.model_validate(user).model_dump(),
        patient_profile=patients.profile_read(session, profile) if profile else None,
    )
