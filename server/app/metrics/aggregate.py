"""Robust per-session summaries of trial measures.

Missing values (None, NaN, infinite) are left out. An empty input gives None rather than an
error, so a session without a game or a measure simply has no figure.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Summary:
    count: int
    mean: float
    median: float
    #: The 25th and 75th percentiles (linear interpolation) and their difference.
    q1: float
    q3: float
    iqr: float
    min: float
    max: float


def finite(values: Iterable[float | int | None]) -> list[float]:
    """The values that are real numbers (bools are not)."""
    kept: list[float] = []
    for value in values:
        if value is None or isinstance(value, bool):
            continue
        number = float(value)
        if math.isfinite(number):
            kept.append(number)
    return kept


def summarise(values: Iterable[float | int | None]) -> Summary | None:
    """Count, mean, median, quartiles and interquartile range; None without a usable value."""
    numbers = finite(values)
    if not numbers:
        return None
    data = np.asarray(numbers, dtype=np.float64)
    q1, median, q3 = (float(value) for value in np.percentile(data, [25, 50, 75]))
    return Summary(
        count=len(numbers),
        mean=float(np.mean(data)),
        median=median,
        q1=q1,
        q3=q3,
        iqr=q3 - q1,
        min=float(np.min(data)),
        max=float(np.max(data)),
    )


def median(values: Iterable[float | int | None]) -> float | None:
    summary = summarise(values)
    return summary.median if summary else None


def mean(values: Iterable[float | int | None]) -> float | None:
    summary = summarise(values)
    return summary.mean if summary else None


def success_rate(outcomes: Iterable[str], leave_out: Iterable[str] = ("aborted",)) -> float | None:
    """Successes over all outcomes, leaving out trials the patient stopped; None without any."""
    skipped = set(leave_out)
    counted = [outcome for outcome in outcomes if outcome not in skipped]
    if not counted:
        return None
    return sum(1 for outcome in counted if outcome == "success") / len(counted)


def flagged_rate(flags: Iterable[bool | None]) -> float | None:
    """The share of items flagged (such as trials with compensation); unknowns left out, None
    without any."""
    known = [flag for flag in flags if flag is not None]
    if not known:
        return None
    return sum(1 for flag in known if flag) / len(known)
