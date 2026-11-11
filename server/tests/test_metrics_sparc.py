import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.metrics.signal import speed_from_trajectory
from app.metrics.sparc import next_power_of_two, sparc, sparc_details
from metrics_helpers import reach, two_sub_movements

VECTORS = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "sparc.json"
#: The task asks for 1e-3; the file's own tolerance (1e-6), the web app's, is met too.
TOLERANCE = 1e-3


def load_cases() -> list[dict[str, Any]]:
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    cases: list[dict[str, Any]] = data["cases"]
    return cases


def test_the_vector_file_uses_the_same_method() -> None:
    method = json.loads(VECTORS.read_text(encoding="utf-8"))["method"]
    assert method["resample_hz"] == 60
    assert method["pad_level"] == 4
    assert method["cutoff_hz"] == 10
    assert method["amplitude_threshold"] == 0.05


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case["name"])
def test_reproduces_every_shared_vector(case: dict[str, Any]) -> None:
    result = sparc_details(case["speed"])
    expected = case["expected"]
    assert result is not None
    assert result.sparc == pytest.approx(expected["sparc"], abs=TOLERANCE)
    assert result.sparc == pytest.approx(expected["sparc"], abs=1e-6)
    assert result.resampled_count == expected["resampled_count"]
    assert result.fft_size == expected["fft_size"]
    assert result.cutoff_hz == pytest.approx(expected["cutoff_hz"])
    assert result.rate_hz == pytest.approx(expected["rate_hz"])


def test_a_smooth_reach_is_near_the_minimum_jerk_vector() -> None:
    [vector] = [case for case in load_cases() if case["name"] == "min_jerk_reach"]
    value = sparc(speed_from_trajectory(reach()))
    assert value is not None
    # SPARC does not depend on the reach's size, start or the still time around it.
    assert value == pytest.approx(vector["expected"]["sparc"], abs=0.05)


def test_two_sub_movements_are_less_smooth() -> None:
    smooth = sparc(speed_from_trajectory(reach()))
    two = sparc(speed_from_trajectory(two_sub_movements()))
    assert smooth is not None and two is not None
    assert two < smooth - 0.2


def test_noise_lowers_smoothness() -> None:
    clean = speed_from_trajectory(reach())
    noisy = clean.copy()
    noisy[:, 1] = np.abs(noisy[:, 1] + np.random.default_rng(1).normal(0, 0.1, noisy.shape[0]))
    clean_value, noisy_value = sparc(clean), sparc(noisy)
    assert clean_value is not None and noisy_value is not None
    assert noisy_value < clean_value


def test_is_none_when_it_cannot_be_measured() -> None:
    assert sparc([]) is None
    assert sparc([[0.0, 1.0], [10.0, 1.0]]) is None  # Too short at 60 Hz.
    assert sparc([[t * 33.3, 0.0] for t in range(30)]) is None  # No movement.
    # Nothing but 0 Hz reaches the amplitude threshold.
    [case] = [case for case in load_cases() if case["name"] == "min_jerk_reach"]
    assert sparc_details(case["speed"], amplitude_threshold=2) is None


def test_next_power_of_two() -> None:
    assert [next_power_of_two(n) for n in (0, 1, 2, 3, 61, 64, 65)] == [1, 1, 2, 4, 64, 64, 128]
