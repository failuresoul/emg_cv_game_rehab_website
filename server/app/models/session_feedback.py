from datetime import datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class SessionFeedback(SQLModel, table=True):
    """The patient's cool-down questionnaire, one per session.

    The LLM feedback module reads these fields, so keep their names unchanged.
    """

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", unique=True)
    pain_0_10: int
    fatigue_0_10: int
    enjoyment_1_5: int
    difficulty: str  # "too_easy" | "just_right" | "too_hard"
    new_symptoms: bool
    comment: str | None = Field(default=None, max_length=300)
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
