from datetime import date

from pydantic import BaseModel

from app.schemas.common import UtcDatetime
from app.schemas.game import GameId, GameRunStatus, GameSummary
from app.schemas.session import Point, SessionStatus
from app.schemas.session_feedback import SafetyFlag, SessionFeedbackRead
from app.schemas.warmup import WarmupSummary


class CalendarDay(BaseModel):
    #: The patient's local date.
    date: date
    completed: int


class ProgressPoint(BaseModel):
    """One completed session, for the trend charts."""

    session_id: int
    date: UtcDatetime
    hull_area_sw2: float | None
    warmup_goals_reached: int
    warmup_total: int
    #: Successful trials over all trials of every game, leaving out trials the patient stopped.
    game_success_rate: float | None
    #: Warm-up repetitions done in full.
    total_reps: int


class ReachSnapshot(BaseModel):
    session_id: int
    date: UtcDatetime
    reach_radii_sw: list[float]
    hull_sw: list[Point]
    hull_area_sw2: float
    valid: list[bool]


class PatientProgress(BaseModel):
    #: Consecutive local days with a completed session, up to today. A day without one yet
    #: today does not break the streak until the day is over.
    streak_days: int
    #: Completed sessions since Monday, in the patient's local time.
    sessions_this_week: int
    weekly_goal: int
    #: The last 28 local days, oldest first, ending today.
    calendar: list[CalendarDay]
    #: Completed sessions, oldest first.
    series: list[ProgressPoint]
    last_session_date: UtcDatetime | None
    first_reach: ReachSnapshot | None
    latest_reach: ReachSnapshot | None


class GameComparison(BaseModel):
    """The patient's last finished run of the same game in an earlier session."""

    session_id: int
    score: float | None
    success_rate: float | None
    summary: GameSummary | None


class SessionReportGame(BaseModel):
    run_id: int
    game_id: GameId
    status: GameRunStatus
    score: float | None
    trials_done: int
    trials_planned: int
    successes: int | None
    success_rate: float | None
    summary: GameSummary | None
    previous: GameComparison | None


class WarmupComparison(WarmupSummary):
    session_id: int


class SessionReport(BaseModel):
    """Everything the end-of-session summary shows, with figures from earlier sessions."""

    session_id: int
    started_at: UtcDatetime
    ended_at: UtcDatetime | None
    status: SessionStatus
    #: From start to end, or None while the session is still open.
    duration_seconds: float | None
    #: Time spent moving: warm-up exercise time plus the time of each finished game.
    active_seconds: float
    warmup: WarmupSummary | None
    #: The most recent earlier session with a warm-up.
    previous_warmup: WarmupComparison | None
    games: list[SessionReportGame]
    reach: ReachSnapshot | None
    #: The most recent calibration from an earlier session.
    previous_reach: ReachSnapshot | None
    feedback: SessionFeedbackRead | None
    flags: list[SafetyFlag]
