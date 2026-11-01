from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import SessionDep, require_patient
from app.models import PatientProfile, User
from app.schemas.patient import PatientDashboard, PatientProfileRead, TodayPlanStep

router = APIRouter(prefix="/patient", tags=["patient"])

TODAY_PLAN = [
    TodayPlanStep(step="camera_check", minutes=1),
    TodayPlanStep(step="calibration", minutes=2),
    TodayPlanStep(step="warmup", minutes=6),
    TodayPlanStep(step="games", minutes=15),
    TodayPlanStep(step="feedback", minutes=2),
]


@router.get("/dashboard")
def dashboard(
    user: Annotated[User, Depends(require_patient)], session: SessionDep
) -> PatientDashboard:
    profile = session.exec(select(PatientProfile).where(PatientProfile.user_id == user.id)).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return PatientDashboard(
        profile=PatientProfileRead.model_validate(profile),
        today_plan=TODAY_PLAN,
    )
