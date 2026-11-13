from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Index, Text, text
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class LlmReport(SQLModel, table=True):
    """A session's feedback report in one language, and how it was made.

    It is also the background job: it is created "queued", becomes "running", then "done" (the
    model's report passed the validator), "fallback" (the template report) or "failed" (no
    report: an unexpected error). Regenerating marks the old row superseded and adds a new one,
    so each (session, language) has one current report and keeps its history.
    """

    __table_args__ = (
        # One current report per session and language; superseded versions are kept.
        Index(
            "ux_llmreport_current",
            "session_id",
            "language",
            unique=True,
            sqlite_where=text("superseded = 0"),
            postgresql_where=text("superseded = false"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", index=True)
    language: str  # "en" | "bn"
    status: str = Field(default="queued", index=True)
    superseded: bool = False
    #: The report shown (schemas.Report), once finished.
    report: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    #: The fixed safety notices shown with it.
    safety_notices: list[str] = Field(default_factory=list, sa_type=JSON)
    #: The facts and candidates the report was made from, as they were then.
    facts: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    candidates: list[dict[str, Any]] | None = Field(default=None, sa_type=JSON)
    model: str | None = None
    prompt_version: str | None = None
    latency_ms: float | None = None
    prompt_tokens: int | None = None
    output_tokens: int | None = None
    retries: int = 0
    fallback_used: bool = False
    #: Each failed answer's validation errors, in order.
    validation_errors: list[list[str]] = Field(default_factory=list, sa_type=JSON)
    #: Every answer the model wrote, attempt by attempt. For admins only.
    raw_output: str | None = Field(default=None, sa_type=Text)
    #: Why the model could not be used (not running, too slow), or why the job failed.
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    finished_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))


class ReportRating(SQLModel, table=True):
    """A rating of a report: by the participant, the research team or a clinician."""

    id: int | None = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="llmreport.id", index=True)
    rater: str  # "participant" | "team" | "clinician"
    rater_user_id: int = Field(foreign_key="user.id")
    #: 1-5 per criterion, such as {"clarity": 4, "usefulness": 5}.
    scores: dict[str, int] = Field(default_factory=dict, sa_type=JSON)
    comment: str | None = Field(default=None, max_length=300)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
