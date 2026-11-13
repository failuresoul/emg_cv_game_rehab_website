"""The blind review API (app/api/review.py)."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.common import Language, UtcDatetime
from app.schemas.feedback_report import RatingRead

Score = Annotated[int, Field(ge=1, le=5)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Comment = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class ReviewSetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Sessions to choose; each gives an LLM and a template report.
    size: int = Field(default=20, ge=1, le=100)
    language: Language = "en"
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None


class ReviewSetRead(BaseModel):
    id: int
    name: str
    language: Language
    sessions: int
    items: int
    #: Items whose report is written.
    ready_items: int
    status: Literal["building", "ready"]
    #: Items the current admin has rated.
    my_ratings: int
    created_at: UtcDatetime


class BlindItemSummary(BaseModel):
    code: str
    position: int
    rated_by_me: bool


class BlindItem(BaseModel):
    """One report as a rater sees it: never its version, model or anything about how it was
    made."""

    code: str
    position: int
    total: int
    #: The session's facts (numbers and statuses), without the patient's code.
    facts: dict[str, Any]
    safety_notices: list[str]
    #: The patient's text only.
    report: dict[str, Any] | None
    my_rating: RatingRead | None


class ReviewScores(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accuracy: Score
    safety: Score
    helpfulness: Score
    clarity: Score
    tone: Score


class ReviewRatingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rater: Literal["team", "clinician"]
    scores: ReviewScores
    unsafe: bool
    #: Any sentence the facts do not support, pasted from the report.
    unsupported: Text | None = None
    comment: Comment | None = None


class VersionSummary(BaseModel):
    items: int
    ratings: int
    means: dict[str, float | None]
    sds: dict[str, float | None]
    unsafe_pct: float | None


class Agreement(BaseModel):
    dimension: str
    rater_a: int
    rater_b: int
    items: int
    #: Quadratic-weighted Cohen's kappa (unweighted for "unsafe"); None when undefined.
    kappa: float | None


class RaterSummary(BaseModel):
    user_id: int
    rater: str
    ratings: int


class ReviewResults(BaseModel):
    review_set_id: int
    status: Literal["building", "ready"]
    items: int
    #: LLM items where the model failed and the template was used instead.
    llm_fallbacks: int
    #: "llm", "template" and "llm_model_written" (LLM items the model really wrote).
    versions: dict[str, VersionSummary]
    raters: list[RaterSummary]
    agreement: list[Agreement]
