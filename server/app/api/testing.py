"""Helpers for the automated end-to-end tests (Day 18). main.py includes this router only when
APP_ENV=test, so the routes do not exist in development or production; every route also checks
the setting again before changing anything.

- POST /api/test/reset: a fresh database with the admin and the seeded demo patients.
- POST /api/test/seed-session: a completed session with data (calibration, warm-up, games,
  questionnaire, measures) for a patient.
"""

import random
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, SQLModel, col, select

from app.api.deps import SessionDep
from app.core.config import settings
from app.core.db import create_db_and_tables
from app.core.security import hash_password
from app.models import PatientProfile, User
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.services import alerts, session_metrics, trial_metrics
from app.services.users import ensure_admin

#: The demo patients' password after a reset, unless the request sets another.
DEFAULT_PATIENT_PASSWORD = "e2e-patient-password"


def require_test_env() -> None:
    if settings.APP_ENV != "test":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


router = APIRouter(prefix="/test", tags=["test"], dependencies=[Depends(require_test_env)])


class ResetRequest(BaseModel):
    #: False: only the admin, no demo patients (faster).
    demo_patients: bool = True
    patient_password: str = Field(default=DEFAULT_PATIENT_PASSWORD, min_length=8, max_length=128)


class TestLogin(BaseModel):
    email: str
    password: str
    patient_id: int
    patient_code: str


class ResetResponse(BaseModel):
    admin_email: str
    patients: list[TestLogin]


class SeedSessionRequest(BaseModel):
    patient_id: int
    #: How far through a course of sessions this one is, 0 (first) to 1 (last): later sessions
    #: reach further and score higher.
    progress: float = Field(default=0.5, ge=0, le=1)
    #: How much the patient improves over the course, 0 to 1.
    improvement: float = Field(default=0.5, ge=0, le=1)
    #: Days before today the session took place.
    days_ago: int = Field(default=0, ge=0, le=365)
    #: True: a pain score of 5 in the questionnaire, which raises an alert.
    pain: bool = False
    seed: int = 1


class SeedSessionResponse(BaseModel):
    session_id: int
    patient_id: int


def _reset(session: Session, request: ResetRequest) -> ResetResponse:
    # Imported here: the seeder is a script, needed only by the tests.
    from scripts import seed_demo_data as demo

    bind = session.get_bind()
    session.rollback()
    session.expunge_all()
    SQLModel.metadata.drop_all(bind)
    create_db_and_tables(bind)  # type: ignore[arg-type]
    ensure_admin(session)
    logins: list[TestLogin] = []
    if request.demo_patients:
        demo.seed_demo_data(session)
        hashed = hash_password(request.patient_password)
        for patient in demo.DEMO_PATIENTS:
            user = session.exec(select(User).where(User.email == patient.email)).one()
            user.hashed_password = hashed
            session.add(user)
            profile = session.exec(
                select(PatientProfile).where(PatientProfile.user_id == user.id)
            ).one()
            assert profile.id is not None
            logins.append(
                TestLogin(
                    email=user.email,
                    password=request.patient_password,
                    patient_id=profile.id,
                    patient_code=profile.patient_code,
                )
            )
        session.commit()
    return ResetResponse(admin_email=settings.ADMIN_EMAIL.strip().lower(), patients=logins)


@router.post("/reset", response_model=ResetResponse)
def reset(session: SessionDep, request: ResetRequest | None = None) -> ResetResponse:
    return _reset(session, request or ResetRequest())


@router.post("/seed-session", response_model=SeedSessionResponse, status_code=201)
def seed_session(
    request: SeedSessionRequest, session: SessionDep
) -> SeedSessionResponse:
    from scripts import seed_demo_data as demo

    profile = session.get(PatientProfile, request.patient_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    user = session.get(User, profile.user_id)
    assert user is not None and profile.id is not None
    # The seeder's course of eleven sessions; this session is the one at `progress`.
    index = round(request.progress * 10)
    patient = demo.DemoPatient(
        email=user.email,
        full_name=user.full_name,
        affected_side="right" if profile.affected_side == "right" else "left",
        dominant_side="right" if profile.dominant_side == "right" else "left",
        age_band="60-69",
        months_since_stroke=profile.months_since_stroke or 0,
        days_ago=tuple(range(10, -1, -1)),
        improvement=request.improvement,
        pain_session=index if request.pain else None,
    )
    started_at = utc_now() - timedelta(days=request.days_ago, minutes=40)
    before = set(
        session.exec(
            select(SessionRecord.id).where(SessionRecord.patient_id == profile.id)
        ).all()
    )
    demo._add_session(
        session, random.Random(request.seed), profile, patient, index, started_at, {}
    )
    session.commit()
    record = session.exec(
        select(SessionRecord)
        .where(SessionRecord.patient_id == profile.id)
        .where(col(SessionRecord.id).not_in(before))
    ).one()
    assert record.id is not None
    demo.store_plan(session, profile, record)
    demo.replay_adaptation(session, profile, record)
    session.commit()
    trial_metrics.recompute(session, record.id)
    session_metrics.compute_session_metrics(session, record.id)
    alerts.migrate_session_flags(session)
    return SeedSessionResponse(session_id=record.id, patient_id=profile.id)
