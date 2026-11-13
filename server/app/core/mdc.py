"""Minimal detectable change (MDC) of each catalogue measure: the smallest change between
sessions that is larger than the measure's usual session-to-session noise.

PROVISIONAL: every value here is a placeholder chosen to be plausible for the measure's unit.
None has been measured. They will be replaced on Day 19 with values measured from repeated
sessions (test-retest), and a change judged against them only says whether it is larger than
that noise, not whether it matters clinically.
"""

from typing import Final

#: True until the values below are replaced with measured ones (Day 19).
PROVISIONAL: Final = True

#: Metric id (shared/metrics-catalog.json) to its MDC, in the metric's own unit.
MDC: Final[dict[str, float]] = {
    "K1": 0.15,  # sw2: reach area
    "K5": 100.0,  # ms: reaction time
    "K6": 150.0,  # ms: movement time
    "K7": 0.05,  # share: path efficiency
    "K8": 0.3,  # SPARC
    "K9": 0.15,  # SW/s: peak speed
    "K10": 0.5,  # speed peaks per movement
    "K12": 0.1,  # share of trials with compensation
    "R1": 8.0,  # deg: shoulder raise forward
    "R2": 8.0,  # deg: shoulder raise sideways
    "R3": 8.0,  # deg: elbow range
    "R4": 0.05,  # arm ratio: forward reach
    "H1": 0.1,  # palm lengths: hand opening range
    "H2": 0.1,  # share: finger piano hit rate
    "H3": 0.02,  # share: grip steadiness (standard deviation)
    "H4": 300.0,  # ms: relaxation time
    "H5": 400.0,  # ms: transport time
    "H6": 0.08,  # share: bloom peak openness
    "G1": 0.1,  # share: game success rate
    "G2": 3.0,  # minutes active
    "G3": 10.0,  # warm-up repetitions
    "G4": 1.0,  # warm-up goals reached
    "E2": 150.0,  # mV: maximum voluntary contraction
    "E3": 0.1,  # share: activation success with EMG
    "E5": 100.0,  # ms: EMG onset latency
    "E6": 300.0,  # ms: EMG relaxation time
    "E8": 0.02,  # share: grip steadiness from EMG (standard deviation)
    "E9": 1.0,  # %MVC per activation: within-session fatigue slope
    "P1": 2.0,  # pain, 0-10
    "P2": 2.0,  # fatigue, 0-10
    "P3": 1.0,  # enjoyment, 1-5
}


def mdc_for(metric_id: str) -> float | None:
    """The MDC of a measure, or None if it has none."""
    return MDC.get(metric_id)
