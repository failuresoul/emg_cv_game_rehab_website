from datetime import datetime

from sqlalchemy import JSON, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class Study(SQLModel, table=True):
    """A controlled comparison of engine conditions (research mode).

    Within-subject: every participant plays every condition, in an order from a balanced Latin
    square. Between-subject: each participant plays one condition, from balanced randomisation.
    While a participant's study is active, each new session's condition replaces the programme's
    engine and the session plays the study's fixed games.
    """

    id: int | None = Field(default=None, primary_key=True)
    name: str
    description: str | None = None
    design: str  # "within_subject" | "between_subject"
    #: Engine modes compared, such as ["L0", "L1", "L2"].
    conditions: list[str] = Field(default_factory=list, sa_type=JSON)
    #: Completed sessions each participant plays per condition.
    sessions_per_condition: int
    #: Game ids every study session plays, in order.
    games: list[str] = Field(default_factory=list, sa_type=JSON)
    status: str = "draft"  # "draft" | "active" | "closed"
    #: Seeds the between-subject randomisation, so assignments can be reproduced.
    seed: int = 0
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))


class StudyParticipant(SQLModel, table=True):
    """A patient enrolled in a study, with their condition order (within-subject) or condition
    (between-subject)."""

    __table_args__ = (UniqueConstraint("study_id", "patient_id"),)

    id: int | None = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="study.id", index=True)
    patient_id: int = Field(foreign_key="patientprofile.id", index=True)
    #: The order of enrolment in this study (0, 1, ...): picks the Latin square row or the
    #: randomisation slot.
    position: int
    condition_order: list[str] | None = Field(default=None, sa_type=JSON)
    assigned_condition: str | None = None
    #: The condition being played: its index in condition_order (always 0 between-subject).
    current_index: int = 0
    enrolled_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    withdrawn_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
