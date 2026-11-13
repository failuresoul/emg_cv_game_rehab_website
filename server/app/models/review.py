from datetime import datetime

from sqlalchemy import DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class ReviewSet(SQLModel, table=True):
    """A blind human evaluation: for each chosen session, the LLM report and the template report
    from the same facts, shuffled under anonymous codes (docs/llm-evaluation.md)."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    language: str  # "en" | "bn"
    #: Sessions chosen; each gives two items.
    sessions: int
    #: The random seed of the choice, the shuffle and the codes.
    seed: int
    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))


class ReviewItem(SQLModel, table=True):
    """One report of a review set, known to raters only by its code."""

    __table_args__ = (
        UniqueConstraint("review_set_id", "code"),
        UniqueConstraint("review_set_id", "position"),
    )

    id: int | None = Field(default=None, primary_key=True)
    review_set_id: int = Field(foreign_key="reviewset.id", index=True)
    #: Anonymous, random: says nothing about the version or the session.
    code: str
    #: The shuffled order raters see.
    position: int
    session_id: int = Field(foreign_key="session.id")
    #: "llm" or "template". Never shown to raters.
    version: str
    report_id: int = Field(foreign_key="llmreport.id")
