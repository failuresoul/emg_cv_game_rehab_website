"""Research mode: studies, participants, progress and results (admin only)."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.common import UtcDatetime
from app.schemas.game import GameId

StudyDesign = Literal["within_subject", "between_subject"]
StudyStatus = Literal["draft", "active", "closed"]
Condition = Literal["L0", "L1", "L2"]
StudyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


def _check_lists(conditions: list[str] | None, games: list[str] | None) -> None:
    if conditions is not None:
        if len(set(conditions)) != len(conditions):
            raise ValueError("Each condition may be listed only once")
        if len(conditions) < 2:
            raise ValueError("A study compares at least 2 conditions")
    if games is not None and len(set(games)) != len(games):
        raise ValueError("Each game may be listed only once")


class StudyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: StudyName
    description: Description | None = None
    design: StudyDesign
    conditions: list[Condition] = Field(min_length=2, max_length=3)
    sessions_per_condition: int = Field(ge=1, le=20, strict=True)
    games: list[GameId] = Field(min_length=1, max_length=9)
    #: Seeds the between-subject randomisation; chosen at random when left out.
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)

    @model_validator(mode="after")
    def lists_are_sets(self) -> Self:
        _check_lists(list(self.conditions), list(self.games))
        return self


class StudyUpdate(BaseModel):
    """Name and description at any time; the design only while the study is a draft. Status
    moves forward only: draft -> active -> closed."""

    model_config = ConfigDict(extra="forbid")

    name: StudyName | None = None
    description: Description | None = None
    design: StudyDesign | None = None
    conditions: list[Condition] | None = Field(default=None, min_length=2, max_length=3)
    sessions_per_condition: int | None = Field(default=None, ge=1, le=20, strict=True)
    games: list[GameId] | None = Field(default=None, min_length=1, max_length=9)
    status: StudyStatus | None = None

    @model_validator(mode="after")
    def lists_are_sets(self) -> Self:
        _check_lists(
            list(self.conditions) if self.conditions is not None else None,
            list(self.games) if self.games is not None else None,
        )
        return self


class StudyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    design: StudyDesign
    conditions: list[Condition]
    sessions_per_condition: int
    games: list[GameId]
    status: StudyStatus
    seed: int
    participants: int = 0
    created_at: UtcDatetime
    updated_at: UtcDatetime


class EnrolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: int


class ParticipantRead(BaseModel):
    id: int
    patient_id: int
    patient_code: str
    position: int
    condition_order: list[Condition] | None
    assigned_condition: Condition | None
    current_index: int
    enrolled_at: UtcDatetime
    withdrawn_at: UtcDatetime | None


class ParticipantProgress(ParticipantRead):
    #: Completed study sessions per condition.
    sessions_done: dict[str, int]
    #: The condition the next session plays; None when complete or withdrawn.
    next_condition: Condition | None
    complete: bool


class StudyProgress(BaseModel):
    study_id: int
    sessions_per_condition: int
    conditions: list[Condition]
    participants: list[ParticipantProgress]


class Estimate(BaseModel):
    """A mean over participants with its 95% confidence interval (t distribution); the interval
    is null with fewer than two participants."""

    mean: float | None
    ci_low: float | None
    ci_high: float | None
    n: int


class ConditionResult(BaseModel):
    condition: Condition
    participants: int
    sessions: int
    trials: int
    success_rate: Estimate
    #: Mean |rolling success (10 trials) - 0.7| per run, then per participant.
    challenge_error: Estimate
    #: Share of rolling success values within 0.6-0.8.
    time_in_zone: Estimate
    compensation_rate: Estimate
    #: The engine's level (1-10) after each trial.
    mean_level: Estimate
    enjoyment: Estimate
    fatigue: Estimate
    #: The participants' own ratings of their feedback reports (mean score 1-5).
    report_rating: Estimate


class StudyResults(BaseModel):
    study_id: int
    design: StudyDesign
    conditions: list[ConditionResult]
