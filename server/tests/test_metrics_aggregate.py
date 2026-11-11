import pytest

from app.metrics.aggregate import (
    finite,
    flagged_rate,
    mean,
    median,
    success_rate,
    summarise,
)


def test_summary_of_a_few_values() -> None:
    summary = summarise([4, 1, 3, 2, None, float("nan")])
    assert summary is not None
    assert summary.count == 4
    assert summary.mean == pytest.approx(2.5)
    assert summary.median == pytest.approx(2.5)
    # Linear interpolation, as numpy's default.
    assert (summary.q1, summary.q3, summary.iqr) == pytest.approx((1.75, 3.25, 1.5))
    assert (summary.min, summary.max) == (1, 4)


def test_the_median_ignores_an_outlier_the_mean_does_not() -> None:
    values = [1000, 1100, 1050, 9000]
    assert median(values) == pytest.approx(1075)
    assert mean(values) == pytest.approx(3037.5)


def test_one_value() -> None:
    summary = summarise([7.5])
    assert summary is not None
    assert (summary.count, summary.median, summary.iqr) == (1, 7.5, 0)


def test_empty_input_gives_none() -> None:
    assert summarise([]) is None
    assert summarise([None, float("inf")]) is None
    assert median([]) is None
    assert mean(iter([])) is None
    assert success_rate([]) is None
    assert success_rate(["aborted", "aborted"]) is None
    assert flagged_rate([]) is None
    assert flagged_rate([None]) is None


def test_true_and_false_are_not_numbers() -> None:
    assert finite([True, 2, False, 3.5]) == [2.0, 3.5]


def test_success_rate_leaves_out_stopped_trials() -> None:
    outcomes = ["success", "miss", "success", "reach_fail", "aborted"]
    assert success_rate(outcomes) == pytest.approx(0.5)
    assert success_rate(outcomes, leave_out=()) == pytest.approx(0.4)


def test_flagged_rate() -> None:
    assert flagged_rate([True, False, False, None, True]) == pytest.approx(0.5)
