from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator

from app.schemas.common import UtcDatetime

Difficulty = Literal["too_easy", "just_right", "too_hard"]
SafetyFlag = Literal["pain", "new_symptoms", "high_fatigue"]
Comment = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
ReviewNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


def _blank_to_none(value: str | None) -> str | None:
    return value or None


class SessionFeedbackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pain_0_10: int = Field(ge=0, le=10, strict=True)
    fatigue_0_10: int = Field(ge=0, le=10, strict=True)
    enjoyment_1_5: int = Field(ge=1, le=5, strict=True)
    difficulty: Difficulty
    new_symptoms: StrictBool
    comment: Comment | None = None

    _comment = field_validator("comment")(_blank_to_none)


class SessionFeedbackRead(BaseModel):
    """The saved questionnaire, with the safety flags it raised."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    pain_0_10: int
    fatigue_0_10: int
    enjoyment_1_5: int
    difficulty: Difficulty
    new_symptoms: bool
    comment: str | None
    created_at: UtcDatetime
    flags: list[SafetyFlag]
    needs_review: bool


class AlertReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: ReviewNote | None = None

    _note = field_validator("note")(_blank_to_none)


class AdminAlert(BaseModel):
    """A session whose questionnaire raised a safety flag."""

    session_id: int
    patient_id: int
    patient_code: str
    date: UtcDatetime
    flags: list[SafetyFlag]
    reviewed: bool
    reviewed_at: UtcDatetime | None
    review_note: str | None
