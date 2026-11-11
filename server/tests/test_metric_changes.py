import pytest

from app.core.mdc import MDC, PROVISIONAL, mdc_for
from app.services.metrics_catalog import load_catalog
from app.services.progress import judge_change, signed_change


def test_every_catalogue_measure_has_a_provisional_mdc() -> None:
    assert PROVISIONAL is True
    for metric in load_catalog():
        assert mdc_for(metric.id) is not None and mdc_for(metric.id) > 0  # type: ignore[operator]
    assert MDC["K6"] == 150 and MDC["K7"] == 0.05 and MDC["K8"] == 0.3
    assert MDC["R1"] == 8 and MDC["R3"] == 8 and MDC["H1"] == 0.1 and MDC["G1"] == 0.1


@pytest.mark.parametrize(
    ("better_when", "baseline", "latest", "expected"),
    [
        ("higher", 1.0, 1.4, 0.4),
        ("higher", 1.0, 0.7, -0.3),
        ("lower", 1000, 800, 200),  # Faster is better.
        ("lower", 1000, 1300, -300),
        ("closer_to_zero", -2.0, -1.5, 0.5),  # SPARC nearer 0 is smoother.
        ("closer_to_zero", -1.5, -2.1, -0.6),
    ],
)
def test_signed_change_is_positive_when_better(
    better_when: str, baseline: float, latest: float, expected: float
) -> None:
    assert signed_change(better_when, baseline, latest) == pytest.approx(expected)  # type: ignore[arg-type]


def test_improved_when_higher_is_better() -> None:
    result = judge_change("K1", "higher", [1.0, 1.2, 1.5])
    assert result.baseline == pytest.approx(1.1)
    assert result.latest == 1.5
    assert result.change == pytest.approx(0.4)
    assert result.change_mdc == pytest.approx(0.4 / 0.15, abs=1e-3)
    assert result.status == "improved"


def test_lower_is_better_measures_flip_the_sign() -> None:
    # Movement time falls from a 1050 ms baseline to 800 ms: better.
    faster = judge_change("K6", "lower", [1000, 1100, 800])
    assert faster.change == pytest.approx(-250)
    assert faster.change_mdc == pytest.approx(250 / 150, abs=1e-3)
    assert faster.status == "improved"
    slower = judge_change("K6", "lower", [1000, 1000, 1300])
    assert slower.change_mdc == pytest.approx(-2)
    assert slower.status == "worse"


def test_closer_to_zero_measures() -> None:
    assert judge_change("K8", "closer_to_zero", [-2.0, -1.8, -1.4]).status == "improved"
    worse = judge_change("K8", "closer_to_zero", [-1.5, -1.5, -2.0])
    assert worse.change_mdc == pytest.approx(-0.5 / 0.3, abs=1e-3)
    assert worse.status == "worse"


def test_one_mdc_exactly_counts_as_a_change() -> None:
    assert judge_change("K6", "lower", [1000, 1000, 850]).status == "improved"
    assert judge_change("K6", "lower", [1000, 1000, 1150]).status == "worse"


def test_a_small_change_is_no_detectable_change() -> None:
    result = judge_change("K1", "higher", [1.0, 1.0, 1.05])
    assert result.change_mdc == pytest.approx(1 / 3, abs=1e-3)
    assert result.status == "no_detectable_change"


def test_the_baseline_is_the_first_two_sessions_and_the_latest_the_last() -> None:
    result = judge_change("G1", "higher", [0.5, 0.7, 0.9, 0.95, 0.65])
    assert result.baseline == pytest.approx(0.6)
    assert result.latest == 0.65
    assert result.status == "no_detectable_change"


def test_no_baseline_with_fewer_than_three_sessions() -> None:
    two = judge_change("K1", "higher", [1.0, 2.0])
    assert two.baseline == pytest.approx(1.5)
    assert (two.change, two.change_mdc, two.status) == (None, None, "no_baseline")
    one = judge_change("K1", "higher", [1.0])
    assert (one.baseline, one.latest, one.status) == (None, 1.0, "no_baseline")
    none = judge_change("K1", "higher", [])
    assert (none.latest, none.status) == (None, "no_baseline")


def test_a_measure_without_an_mdc_cannot_be_judged() -> None:
    result = judge_change("Z9", "higher", [1.0, 1.0, 5.0])
    assert result.change == pytest.approx(4)
    assert result.change_mdc is None
    assert result.status == "no_detectable_change"
