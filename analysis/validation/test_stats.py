"""Worked examples for stats.py (and run_validation.py's never-crash rule).

Run: server\\.venv\\Scripts\\python.exe -m pytest -q analysis\\validation
"""

import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import stats  # noqa: E402


def test_rmse_by_hand() -> None:
    # Errors 1, -1, 2, 0: mean square (1 + 1 + 4 + 0) / 4 = 1.5.
    assert stats.rmse([11, 9, 12, 10], [10, 10, 10, 10]) == pytest.approx(math.sqrt(1.5))


def test_bland_altman_by_hand() -> None:
    # Differences 2, 4, 6: bias 4, SD 2, limits 4 ± 3.92.
    result = stats.bland_altman([12, 14, 16], [10, 10, 10])
    assert result["bias"] == pytest.approx(4)
    assert result["sd"] == pytest.approx(2)
    assert result["loa_low"] == pytest.approx(4 - 1.96 * 2)
    assert result["loa_high"] == pytest.approx(4 + 1.96 * 2)


def test_summary_and_percentiles() -> None:
    result = stats.summary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert result["mean"] == pytest.approx(5.5)
    assert result["sd"] == pytest.approx(3.0276503540974917)
    assert result["p50"] == pytest.approx(5.5)
    assert result["p95"] == pytest.approx(9.55)  # NumPy: np.percentile(range(1, 11), 95)


def test_within_subject_sd_sem_mdc_cv() -> None:
    # One person, three visits 10, 12, 14: SD 2, so SEM 2, MDC95 = 1.96 x sqrt 2 x 2 = 5.54.
    visits = {"P001": [10.0, 12.0, 14.0]}
    assert stats.within_subject_sd(visits) == pytest.approx(2)
    assert stats.sem(visits) == pytest.approx(2)
    assert stats.mdc95(2) == pytest.approx(5.5437, abs=1e-4)
    assert stats.cv_percent(visits) == pytest.approx(100 * 2 / 12)


def test_within_subject_sd_pools_people() -> None:
    # Two people, two visits each: squares 2 and 8 over 2 degrees of freedom -> sqrt 5.
    assert stats.within_subject_sd({"A": [1, 3], "B": [10, 14]}) == pytest.approx(math.sqrt(5))


def test_icc_is_not_applicable_for_one_person() -> None:
    assert stats.icc_2_1([[10, 12, 14]]) == "not applicable (n=1)"
    assert stats.icc_2_1([[10, 12], [11, 13]]) == "not applicable (n=2)"


def test_icc_2_1_shrout_and_fleiss_example() -> None:
    # Shrout and Fleiss (1979), Table 2: 6 targets x 4 judges; ICC(2,1) = 0.29.
    ratings = [
        [9, 2, 5, 8],
        [6, 1, 3, 2],
        [8, 4, 6, 8],
        [7, 1, 2, 6],
        [10, 5, 6, 9],
        [6, 2, 4, 7],
    ]
    assert stats.icc_2_1(ratings) == pytest.approx(0.29, abs=0.005)


def test_icc_of_perfect_agreement_is_one() -> None:
    assert stats.icc_2_1([[1, 1], [5, 5], [9, 9]]) == pytest.approx(1)


def test_bad_input_is_an_error_not_a_wrong_number() -> None:
    with pytest.raises(ValueError):
        stats.rmse([1, 2], [1])
    with pytest.raises(ValueError):
        stats.summary([])
    with pytest.raises(ValueError):
        stats.within_subject_sd({"A": [1.0]})


def test_run_validation_never_crashes_and_marks_missing_data_pending(tmp_path: Path) -> None:
    import run_validation

    out = tmp_path / "out"
    run_validation.main(["--input", str(tmp_path / "nothing-here"), "--out", str(out)])
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    assert {section["status"] for section in summary["sections"].values()} == {"PENDING"}
    assert json.loads((out / "mdc.json").read_text(encoding="utf-8"))["metrics"] == {}


def test_the_demo_is_labelled_and_kept_apart(tmp_path: Path) -> None:
    import run_validation

    run_validation.main(["--demo", "--demo-out", str(tmp_path / "validation_demo")])
    summary = json.loads((tmp_path / "validation_demo" / "summary.json").read_text(encoding="utf-8"))
    assert summary["label"] == "DEMO — SYNTHETIC"
    assert all(section["status"] == "DONE" for section in summary["sections"].values())
    assert (tmp_path / "validation_demo" / "angles_bland_altman.png").exists()
    assert (tmp_path / "validation_demo" / "angles_bland_altman.svg").exists()
