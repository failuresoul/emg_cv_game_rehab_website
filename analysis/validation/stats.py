"""Agreement and reliability statistics for the validation (Day 19). Plain Python (math and
statistics only), so every number can be checked by hand; tests in test_stats.py use worked
examples.

- rmse: root-mean-square error between a measure and its reference.
- bland_altman: bias (mean of measure - reference) and 95% limits of agreement (bias ± 1.96 SD).
- summary: n, mean, SD, p50, p95.
- within_subject_sd: the SD of repeated measures of one person (pooled over people if several).
- sem: standard error of measurement (= within-subject SD).
- mdc95: smallest detectable change, 1.96 x sqrt(2) x SEM.
- cv_percent: within-subject SD as a % of the mean.
- icc_2_1: ICC(2,1), two-way random effects, absolute agreement, single measures (Shrout and
  Fleiss 1979; McGraw and Wong 1996), only with 3 or more participants; otherwise "not
  applicable (n=1)" (or n=2).
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Mapping, Sequence

Z95 = 1.96
MIN_ICC_PARTICIPANTS = 3


def _pairs(measured: Sequence[float], reference: Sequence[float]) -> list[tuple[float, float]]:
    if len(measured) != len(reference):
        raise ValueError("measured and reference must have the same length")
    if not measured:
        raise ValueError("no values")
    return list(zip(measured, reference, strict=True))


def rmse(measured: Sequence[float], reference: Sequence[float]) -> float:
    pairs = _pairs(measured, reference)
    return math.sqrt(sum((m - r) ** 2 for m, r in pairs) / len(pairs))


def bland_altman(measured: Sequence[float], reference: Sequence[float]) -> dict[str, float]:
    """Bias and 95% limits of agreement of measured - reference (SD with n - 1)."""
    differences = [m - r for m, r in _pairs(measured, reference)]
    bias = statistics.fmean(differences)
    sd = statistics.stdev(differences) if len(differences) > 1 else 0.0
    return {
        "n": len(differences),
        "bias": bias,
        "sd": sd,
        "loa_low": bias - Z95 * sd,
        "loa_high": bias + Z95 * sd,
    }


def percentile(values: Sequence[float], share: float) -> float:
    """Linear interpolation between closest ranks (NumPy's default)."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    position = share * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summary(values: Sequence[float]) -> dict[str, float]:
    if not values:
        raise ValueError("no values")
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "sd": statistics.stdev(values) if len(values) > 1 else 0.0,
        "p50": percentile(values, 0.50),
        "p95": percentile(values, 0.95),
    }


def within_subject_sd(groups: Mapping[str, Sequence[float]]) -> float:
    """Pooled within-subject SD: sqrt of the mean of each person's variance (equal visits) or of
    the pooled sum of squares in general. Each person needs 2 or more measures."""
    sum_squares = 0.0
    degrees = 0
    for values in groups.values():
        if len(values) < 2:
            continue
        mean = statistics.fmean(values)
        sum_squares += sum((value - mean) ** 2 for value in values)
        degrees += len(values) - 1
    if degrees == 0:
        raise ValueError("no person has two or more measures")
    return math.sqrt(sum_squares / degrees)


def sem(groups: Mapping[str, Sequence[float]]) -> float:
    """Standard error of measurement, as the within-subject SD."""
    return within_subject_sd(groups)


def mdc95(sem_value: float) -> float:
    return Z95 * math.sqrt(2) * sem_value


def cv_percent(groups: Mapping[str, Sequence[float]]) -> float:
    everything = [value for values in groups.values() for value in values]
    mean = statistics.fmean(everything)
    if mean == 0:
        raise ValueError("the mean is 0")
    return 100 * within_subject_sd(groups) / abs(mean)


def icc_2_1(matrix: Sequence[Sequence[float]]) -> float | str:
    """ICC(2,1) for n participants (rows) x k visits or raters (columns, all present). With fewer
    than 3 participants it is not applicable: one person's repeats say nothing about how well
    a measure tells people apart."""
    n = len(matrix)
    if n < MIN_ICC_PARTICIPANTS:
        return f"not applicable (n={n})"
    k = len(matrix[0])
    if k < 2 or any(len(row) != k for row in matrix):
        raise ValueError("every participant needs the same 2 or more measures")
    grand = statistics.fmean(value for row in matrix for value in row)
    row_means = [statistics.fmean(row) for row in matrix]
    column_means = [statistics.fmean(row[j] for row in matrix) for j in range(k)]
    ss_rows = k * sum((mean - grand) ** 2 for mean in row_means)
    ss_columns = n * sum((mean - grand) ** 2 for mean in column_means)
    ss_total = sum((value - grand) ** 2 for row in matrix for value in row)
    ss_error = ss_total - ss_rows - ss_columns
    ms_rows = ss_rows / (n - 1)
    ms_columns = ss_columns / (k - 1)
    ms_error = ss_error / ((n - 1) * (k - 1))
    denominator = ms_rows + (k - 1) * ms_error + k * (ms_columns - ms_error) / n
    return (ms_rows - ms_error) / denominator
