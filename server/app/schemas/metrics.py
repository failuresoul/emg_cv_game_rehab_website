from typing import Literal

from pydantic import BaseModel

from app.schemas.common import Language, Side, UtcDatetime

BetterWhen = Literal["higher", "lower", "closer_to_zero"]
#: How the latest value compares with the baseline, judged against the measure's MDC.
MetricStatus = Literal["improved", "worse", "no_detectable_change", "no_baseline"]


class MetricPoint(BaseModel):
    session_id: int
    date: UtcDatetime
    value: float


class MetricSeries(BaseModel):
    """One catalogue measure over the patient's completed sessions, oldest first. Trial measures
    have one series per game."""

    metric_id: str
    game_id: str | None
    name: str
    unit: str
    better_when: BetterWhen
    points: list[MetricPoint]


class MetricChange(BaseModel):
    """A measure's latest value against the patient's baseline."""

    metric_id: str
    game_id: str | None
    name: str
    unit: str
    better_when: BetterWhen
    #: The mean of the first two sessions with the measure; None with fewer than two.
    baseline: float | None
    latest: float | None
    #: latest - baseline, in the measure's unit (not signed by which way is better).
    change: float | None
    #: The change in MDC units, positive when better whichever way the measure improves.
    change_mdc: float | None
    status: MetricStatus
    mdc: float | None
    #: True while the MDC is a placeholder (until measured, Day 19).
    provisional: bool
    #: Completed sessions with the measure.
    n_sessions: int


class PatientMetrics(BaseModel):
    """For the admin: each measure's change against the baseline, and every series."""

    metrics: list[MetricChange]
    series: list[MetricSeries]
    mdc_provisional: bool


# The facts the LLM feedback module reads (docs/session-facts.md). Never a name or an email.


class FactsGame(BaseModel):
    #: Trials played, leaving out those the patient stopped.
    trials: int
    success_rate: float | None


class FactsMetric(BaseModel):
    id: str
    #: The game a trial measure comes from; None for session measures.
    game_id: str | None
    name: str
    value: float
    baseline: float | None
    unit: str
    change_mdc: float | None
    mdc_status: MetricStatus


class FactsDirections(BaseModel):
    """Reach directions (degrees; 0 outward, 90 up) of this session's Reach and squeeze trials:
    weak below a 0.5 success rate, strong above 0.85."""

    weak: list[int]
    strong: list[int]


class FactsFlags(BaseModel):
    #: Share of trials with compensation flagged; None without trials.
    compensation_rate: float | None
    #: The questionnaire's fatigue was high (the high_fatigue safety flag).
    fatigue_flag: bool
    #: Share of the movement trials' time the hand was not tracked (gaps over 200 ms), 0-100.
    hand_loss_pct: float | None


class FactsSelfReport(BaseModel):
    pain_0_10: int
    fatigue_0_10: int
    enjoyment_1_5: int


class FactsAdherence(BaseModel):
    #: Completed sessions in the week (Monday to Sunday) of this session, up to its day.
    sessions_this_week: int
    #: The patient's weekly goal.
    planned_this_week: int


class SessionFacts(BaseModel):
    session_id: int
    patient_code: str
    #: This session's place among the patient's sessions, from 1.
    session_no: int
    language: Language
    affected_side: Side
    duration_min: float | None
    #: At least two completed sessions came before this one, so changes can be judged.
    baseline_available: bool
    games: dict[str, FactsGame]
    metrics: list[FactsMetric]
    directions: FactsDirections
    flags: FactsFlags
    self_report: FactsSelfReport | None
    adherence: FactsAdherence
    #: The next session's plan; None until the planner (Day 13).
    next_session: None = None
    #: The session raised a pain or new-symptoms flag, so feedback must show the safety notice.
    safety_notice_present: bool
