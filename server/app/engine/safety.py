"""The safety layer: rules applied after every engine decision, which always win over it.

In this order:

1. Hard bounds: every d within 0 and the patient's maximum for the game (the spec bounds are
   kept by the mapping itself).
2. Compensation: 2 of the last 3 trials compensated -> no spatial component may get harder.
   Cue "posture".
3. Repeated failure: 3 failures in a row -> every component 0.15 easier. Cue "encourage".
4. Tiring within the game: the last 5 trials against the first 5 of this run. Success rate down
   by 0.4 or more, the median movement or completion time up by more than 30%, or the median
   activation peak down by more than 20% -> every component 0.1 easier. Cue "rest". At most once
   every 5 trials, so one tired spell does not keep easing.
5. Session time: more than 25 minutes of active play -> cue "finish_soon"; more than 35 ->
   "finish". The limits come from settings (SESSION_FINISH_SOON_MIN, SESSION_FINISH_MIN).

Every rule that changes or blocks something writes a reason to safety_override. Patients only
ever see the cue, worded gently by the web app.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from statistics import median
from typing import Literal

from app.engine.base import EngineData
from app.engine.difficulty import clamp01

Cue = Literal["posture", "encourage", "rest", "finish_soon", "finish"]
#: When several rules give a cue, the most important one is shown.
CUE_PRIORITY: tuple[Cue, ...] = ("finish", "rest", "finish_soon", "encourage", "posture")

COMPENSATION_WINDOW = 3
COMPENSATION_LIMIT = 2
FAILURES_IN_A_ROW = 3
FAILURE_EASE = 0.15
FATIGUE_WINDOW = 5
FATIGUE_SUCCESS_DROP = 0.4
FATIGUE_TIME_RISE = 0.3
FATIGUE_PEAK_DROP = 0.2
FATIGUE_EASE = 0.1


@dataclass(frozen=True)
class TrialRecord:
    """One trial of the current run, as the safety rules see it."""

    trial_no: int
    outcome: str
    compensated: bool = False
    #: Movement time, or for games without one the trial's completion time, in ms.
    time_ms: float | None = None
    activation_peak: float | None = None

    @property
    def success(self) -> bool:
        return self.outcome == "success"


@dataclass(frozen=True)
class SafetyInput:
    before: EngineData
    #: The engine's proposal.
    after: EngineData
    #: This run's trials, oldest first, the latest last; aborted ones left out.
    history: Sequence[TrialRecord]
    max_difficulty: float = 1.0
    #: Minutes of active play in the session so far.
    active_minutes: float = 0.0
    #: Trials since the last "rest" cue in this run; None if there has been none.
    trials_since_rest: int | None = None
    finish_soon_minutes: float = 25.0
    finish_minutes: float = 35.0


@dataclass
class SafetyResult:
    state: EngineData
    overrides: list[str] = field(default_factory=list)
    cues: list[Cue] = field(default_factory=list)

    @property
    def cue(self) -> Cue | None:
        """The most important cue, or None."""
        return next((cue for cue in CUE_PRIORITY if cue in self.cues), None)

    @property
    def safety_override(self) -> str | None:
        return "; ".join(self.overrides) if self.overrides else None


def _ease(d: dict[str, float], by: float) -> dict[str, float]:
    return {component: round(max(0.0, value - by), 4) for component, value in d.items()}


def _median(values: Sequence[float | None]) -> float | None:
    found = [value for value in values if value is not None]
    return median(found) if found else None


def fatigue_signs(history: Sequence[TrialRecord]) -> list[str]:
    """Why the last 5 trials look tired compared with the first 5 of the run; empty if they do
    not, or there are fewer than 10 trials."""
    if len(history) < 2 * FATIGUE_WINDOW:
        return []
    first, last = history[:FATIGUE_WINDOW], history[-FATIGUE_WINDOW:]
    signs: list[str] = []
    rate_first = sum(trial.success for trial in first) / FATIGUE_WINDOW
    rate_last = sum(trial.success for trial in last) / FATIGUE_WINDOW
    if rate_first - rate_last >= FATIGUE_SUCCESS_DROP - 1e-9:
        signs.append(f"success fell from {rate_first:.0%} to {rate_last:.0%}")
    time_first = _median([trial.time_ms for trial in first])
    time_last = _median([trial.time_ms for trial in last])
    if time_first and time_last and time_last > time_first * (1 + FATIGUE_TIME_RISE):
        signs.append(f"time rose from {time_first:.0f} to {time_last:.0f} ms")
    peak_first = _median([trial.activation_peak for trial in first])
    peak_last = _median([trial.activation_peak for trial in last])
    if peak_first and peak_last is not None and peak_last < peak_first * (1 - FATIGUE_PEAK_DROP):
        signs.append(f"squeeze fell from {peak_first:.2f} to {peak_last:.2f}")
    return signs


def apply_safety(data: SafetyInput) -> SafetyResult:
    """The engine's proposal after every safety rule, with the reasons and cues."""
    cap = clamp01(data.max_difficulty)
    result = SafetyResult(state=data.after)
    d = dict(data.after.d)

    # 1. Hard bounds.
    bounded = {component: min(cap, clamp01(value)) for component, value in d.items()}
    clipped = [component for component in d if bounded[component] != d[component]]
    if clipped:
        result.overrides.append(
            f"Kept within the maximum difficulty {cap:.2f}: {', '.join(clipped)}"
        )
    d = bounded

    # 2. Compensation blocks spatial increases only.
    recent = data.history[-COMPENSATION_WINDOW:]
    if sum(trial.compensated for trial in recent) >= COMPENSATION_LIMIT:
        result.cues.append("posture")
        before = data.before.d.get("spatial")
        if before is not None and d.get("spatial", 0.0) > before:
            result.overrides.append(
                f"Compensation in {COMPENSATION_LIMIT} of the last {COMPENSATION_WINDOW} trials: "
                f"spatial kept at {before:.2f} instead of {d['spatial']:.2f}"
            )
            d["spatial"] = min(cap, before)

    # 3. Repeated failure.
    last = data.history[-FAILURES_IN_A_ROW:]
    if len(last) == FAILURES_IN_A_ROW and not any(trial.success for trial in last):
        d = _ease(d, FAILURE_EASE)
        result.cues.append("encourage")
        result.overrides.append(
            f"{FAILURES_IN_A_ROW} failures in a row: everything {FAILURE_EASE} easier"
        )

    # 4. Tiring within the game, at most once every 5 trials.
    rested_recently = (
        data.trials_since_rest is not None and data.trials_since_rest < FATIGUE_WINDOW
    )
    signs = [] if rested_recently else fatigue_signs(data.history)
    if signs:
        d = _ease(d, FATIGUE_EASE)
        result.cues.append("rest")
        result.overrides.append(
            f"Signs of tiring ({'; '.join(signs)}): everything {FATIGUE_EASE} easier"
        )

    # 5. Session time.
    if data.active_minutes > data.finish_minutes:
        result.cues.append("finish")
    elif data.active_minutes > data.finish_soon_minutes:
        result.cues.append("finish_soon")

    result.state = EngineData(d=d, streak=data.after.streak, turn=data.after.turn)
    return result
