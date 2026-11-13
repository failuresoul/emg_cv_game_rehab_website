"""The feedback reports: request (a background job), poll, read, list, rate, and health."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.api.deps import CurrentPatient, CurrentUser, SessionDep, require_admin
from app.core.config import settings
from app.feedback import store
from app.feedback.jobs import report_jobs
from app.models import LlmReport, PatientProfile, User
from app.models import Session as SessionRecord
from app.schemas.common import Language
from app.schemas.feedback_report import (
    AdminReportDetail,
    AdminReportItem,
    FeedbackHealth,
    FeedbackJob,
    FeedbackRequest,
    PatientReportItem,
    RatingCreate,
    RatingRead,
    ReportRead,
    ReportStatus,
)
from app.services import patients

router = APIRouter(tags=["feedback"])
AdminUser = Annotated[User, Depends(require_admin)]


def _not_found(what: str = "Session") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


def _session_for(db: SessionDep, user: User, session_id: int) -> tuple[SessionRecord, PatientProfile]:
    """The session and its patient, for that patient or an admin; 404 for anyone else."""
    record = db.get(SessionRecord, session_id)
    owner = db.get(PatientProfile, record.patient_id) if record is not None else None
    if record is None or owner is None or (user.role != "admin" and owner.user_id != user.id):
        raise _not_found()
    return record, owner


def _report_for(db: SessionDep, user: User, report_id: int) -> LlmReport:
    report = db.get(LlmReport, report_id)
    if report is None:
        raise _not_found("Report")
    try:
        _session_for(db, user, report.session_id)
    except HTTPException:
        raise _not_found("Report") from None
    return report


@router.post("/sessions/{session_id}/feedback", status_code=status.HTTP_202_ACCEPTED)
def request_feedback(
    session_id: int,
    db: SessionDep,
    user: CurrentUser,
    payload: Annotated[FeedbackRequest | None, Body()] = None,
) -> FeedbackJob:
    """Asks for the session's report. The patient's own sessions, or any for an admin.

    The language defaults to the patient's. A finished report is returned as it is unless
    `regenerate`; otherwise a job is queued and its id returned, to poll at
    `GET /api/feedback/jobs/{job_id}`.
    """
    payload = payload or FeedbackRequest()
    record, owner = _session_for(db, user, session_id)
    assert record.id is not None
    language = payload.language or owner.language
    report, created = store.request_report(db, record.id, language, payload.regenerate)
    assert report.id is not None
    if created:
        report_jobs.enqueue(report.id)
    return FeedbackJob(job_id=report.id, status=report.status)  # type: ignore[arg-type]


@router.get("/feedback/jobs/{job_id}")
def get_job(job_id: int, db: SessionDep, user: CurrentUser) -> ReportRead:
    """A report job: its status, and once finished the report, safety notices and meta."""
    report = _report_for(db, user, job_id)
    return store.to_read(report, for_admin=user.role == "admin")


@router.get("/sessions/{session_id}/feedback")
def get_session_feedback(
    session_id: int,
    db: SessionDep,
    user: CurrentUser,
    language: Annotated[Language | None, Query()] = None,
) -> ReportRead:
    """The session's current report in the language (default the patient's), or 404."""
    record, owner = _session_for(db, user, session_id)
    assert record.id is not None
    report = store.current(db, record.id, language or owner.language)
    if report is None:
        raise _not_found("Report")
    return store.to_read(report, for_admin=user.role == "admin")


@router.get("/patient/reports")
def list_my_reports(db: SessionDep, patient: CurrentPatient) -> list[PatientReportItem]:
    """The patient's reports, newest first, with the start of each summary."""
    assert patient.id is not None
    return store.patient_reports(db, patient.id)


@router.post("/feedback/{report_id}/ratings", status_code=status.HTTP_201_CREATED)
def rate_report(report_id: int, payload: RatingCreate, db: SessionDep, user: CurrentUser) -> RatingRead:
    """A rating of a finished report: patients rate their own as "participant"; admins rate
    as "team" or "clinician". Once per person per report."""
    report = _report_for(db, user, report_id)
    allowed = ("team", "clinician") if user.role == "admin" else ("participant",)
    if payload.rater not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"You rate as: {', '.join(allowed)}"
        )
    assert user.id is not None
    try:
        rating = store.add_rating(db, report, payload.rater, user.id, payload.scores, payload.comment)
    except store.ReportNotFinishedError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Report not ready yet") from None
    except store.DuplicateRatingError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already rated") from None
    return RatingRead.model_validate(rating)


@router.get("/feedback/health")
def feedback_health(_: CurrentUser) -> FeedbackHealth:
    """Whether reports can be written by the model now, or will use the template."""
    provider = report_jobs.provider_factory()
    health = provider.health()
    return FeedbackHealth(
        provider=settings.LLM_PROVIDER,
        model=getattr(provider, "model", settings.LLM_MODEL),
        reachable=health.reachable,
        model_loaded=bool(health.reachable and provider.model_loaded()),
        queue_length=report_jobs.queue_length,
    )


# Admin


@router.get("/admin/patients/{patient_id}/reports")
def admin_patient_reports(patient_id: int, db: SessionDep, _: AdminUser) -> list[AdminReportItem]:
    """Every version of a patient's reports, newest first."""
    if patients.get_patient(db, patient_id) is None:
        raise _not_found("Patient")
    return store.admin_patient_reports(db, patient_id)


@router.get("/admin/reports")
def admin_reports(
    db: SessionDep,
    _: AdminUser,
    report_status: Annotated[ReportStatus | None, Query(alias="status")] = None,
) -> list[AdminReportItem]:
    """Reports across patients for monitoring, such as `?status=fallback` or `?status=failed`."""
    return store.admin_reports(db, report_status)


@router.get("/admin/reports/{report_id}")
def admin_report(report_id: int, db: SessionDep, _: AdminUser) -> AdminReportDetail:
    """Everything about one report: facts, candidates, validation errors, raw output."""
    report = db.get(LlmReport, report_id)
    if report is None:
        raise _not_found("Report")
    return store.to_admin_detail(report)


@router.get("/admin/reports/{report_id}/ratings")
def admin_report_ratings(report_id: int, db: SessionDep, _: AdminUser) -> list[RatingRead]:
    if db.get(LlmReport, report_id) is None:
        raise _not_found("Report")
    return [RatingRead.model_validate(rating) for rating in store.ratings_for(db, report_id)]
