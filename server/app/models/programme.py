from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import utc_now


class PatientProgramme(SQLModel, table=True):
    """What the therapist allows for one patient. The engine, planner, warm-up and games obey it.

    Made with the patient; for profiles from before Day 17, made from their old profile fields
    (weekly_goal, engine_mode, max_difficulty) when the server starts.
    """

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patientprofile.id", unique=True, index=True)
    #: Game ids the patient may play; only those the Game Library also has turned on are used.
    enabled_games: list[str] = Field(default_factory=list, sa_type=JSON)
    #: The highest level (1-10) per game id; a game left out may reach 10. Level L caps the
    #: engine's difficulty at d = L / 10.
    max_level: dict[str, int] = Field(default_factory=dict, sa_type=JSON)
    #: Minutes of games the planner aims for.
    session_minutes_target: int = 18
    #: How many games a plan has: the minimum on lighter days, the maximum otherwise.
    games_per_session_min: int = 3
    games_per_session_max: int = 4
    #: Warm-up exercise ids the patient does, in the warm-up's own order.
    warmup_exercises: list[str] = Field(default_factory=list, sa_type=JSON)
    #: "personal" (targets from the patient's own history, the usual choice) or "gentle" (forced).
    warmup_preset: str = "personal"
    #: A rest prompt after this many minutes of play since the last rest.
    rest_every_minutes: int = 5
    #: Which engine sets the games' difficulty: "L0" fixed, "L1" staircase, "L2" Bayesian.
    engine_mode: str = "L1"
    #: The muscle-sensor site the EMG step suggests: "flexors", "extensors" or None.
    emg_default_site: str | None = None
    #: Sessions per week the patient aims for.
    weekly_goal: int = 5
    #: The therapist's notes on the programme; never shown to the patient.
    notes: str | None = None
    updated_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))


class ProgrammeChange(SQLModel, table=True):
    """One field of a programme changed by an admin: what it was, what it became, and why."""

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patientprofile.id", index=True)
    #: The admin who made the change; None for changes made by the system (none yet).
    admin_id: int | None = Field(default=None, foreign_key="user.id")
    field: str
    before: Any = Field(default=None, sa_type=JSON)
    after: Any = Field(default=None, sa_type=JSON)
    reason: str | None = None
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
