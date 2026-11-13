"""The feedback report API: jobs, reports, lists, ratings and health."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.feedback.schemas import Report
from app.schemas.common import Language, UtcDatetime

ReportStatus = Literal["queued", "running", "done", "fallback", "failed"]
#: The report is ready to show: the model's ("done") or the template's ("fallback").
FINISHED_STATUSES: tuple[ReportStatus, ...] = ("done", "fallback")
Rater = Literal["participant", "team", "clinician"]
#: What a rating may score, each 1-5.
#: "helpfulness" is the blind review's (app/feedback/review.py); "usefulness" the participant's.
RATING_CRITERIA = ("clarity", "usefulness", "accuracy", "tone", "safety", "helpfulness")


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Defaults to the patient's language.
    language: Language | None = None
    #: Make a new version even if a finished report exists.
    regenerate: bool = False


class FeedbackJob(BaseModel):
    #: The report's id, which is also the job's.
    job_id: int
    status: ReportStatus


class ReportMetaRead(BaseModel):
    """How the report was made. Validation errors and raw output are admin-only."""

    model: str | None
    prompt_version: str | None
    latency_ms: float | None
    retries: int
    fallback_used: bool


class ReportRead(BaseModel):
    """A report, or the state of its job. `report`, `safety_notices` and `meta` are present
    once it is finished. For patients, `report.therapist_summary` is left out."""

    job_id: int
    session_id: int
    language: Language
    status: ReportStatus
    report: dict[str, Any] | None = None
    safety_notices: list[str] | None = None
    meta: ReportMetaRead | None = None
    created_at: UtcDatetime
    finished_at: UtcDatetime | None = None


class PatientReportItem(BaseModel):
    """One of the patient's reports, for their list."""

    job_id: int
    session_id: int
    #: This session's place among the patient's sessions, from 1.
    session_no: int
    date: UtcDatetime
    language: Language
    status: ReportStatus
    #: The start of the patient summary.
    preview: str
    has_safety_notice: bool


class AdminReportItem(BaseModel):
    """A report for monitoring, with every version kept."""

    job_id: int
    session_id: int
    patient_id: int
    patient_code: str
    language: Language
    status: ReportStatus
    superseded: bool
    model: str | None
    prompt_version: str | None
    latency_ms: float | None
    retries: int
    fallback_used: bool
    error: str | None
    #: The first validation errors, for a quick look.
    validation_errors: list[list[str]]
    ratings: int
    created_at: UtcDatetime
    finished_at: UtcDatetime | None


class AdminReportDetail(ReportRead):
    """Everything about one report, for admins."""

    superseded: bool
    facts: dict[str, Any] | None
    candidates: list[dict[str, Any]] | None
    validation_errors: list[list[str]]
    raw_output: str | None
    error: str | None
    #: How a Bangla report was made: "direct", "translate" or "template".
    strategy: str | None
    prompt_tokens: int | None
    output_tokens: int | None


Comment = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class RatingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Patients rate as "participant"; admins as "team" or "clinician".
    rater: Rater
    scores: dict[str, int] = Field(min_length=1)
    comment: Comment | None = None

    @field_validator("scores")
    @classmethod
    def known_scores(cls, scores: dict[str, int]) -> dict[str, int]:
        for name, value in scores.items():
            if name not in RATING_CRITERIA:
                raise ValueError(f"unknown criterion {name!r}; use {', '.join(RATING_CRITERIA)}")
            if not 1 <= value <= 5:
                raise ValueError(f"{name} must be 1 to 5")
        return scores

    @field_validator("comment")
    @classmethod
    def empty_is_none(cls, comment: str | None) -> str | None:
        return comment or None


class RatingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_id: int
    rater: Rater
    rater_user_id: int
    scores: dict[str, int]
    comment: str | None
    #: Blind review ratings only.
    review_set_id: int | None = None
    unsafe: bool | None = None
    unsupported_text: str | None = None
    created_at: UtcDatetime


class FeedbackHealth(BaseModel):
    provider: str
    model: str
    reachable: bool
    model_loaded: bool
    #: Reports waiting or being written.
    queue_length: int


def patient_view(report: Report | dict[str, Any] | None) -> dict[str, Any] | None:
    """The report as a patient sees it: without the therapist summary."""
    if report is None:
        return None
    data = report.model_dump() if isinstance(report, Report) else dict(report)
    data.pop("therapist_summary", None)
    return data
