import numpy as np
import pytest

from app.metrics.signal import (
    angular_speed,
    lowpass,
    resample,
    smoothed_speed,
    speed_from_trajectory,
    usable_samples,
)
from metrics_helpers import reach


def test_resample_keeps_the_endpoints_and_spacing() -> None:
    samples = [[0.0, 0.0, 1.0], [40.0, 4.0, 1.0], [70.0, 7.0, 0.0], [100.0, 10.0, 0.0]]
    result = resample(samples, 60)
    rows = result.samples
    # round(0.1 s * 60) + 1 = 7 points, from 0 to 100 ms.
    assert rows.shape == (7, 3)
    assert result.rate_hz == pytest.approx(60)
    assert rows[0].tolist() == samples[0]
    assert rows[-1].tolist() == samples[-1]
    assert np.allclose(np.diff(rows[:, 0]), 100 / 6)
    # x grows linearly at 0.1 per ms.
    assert np.allclose(rows[:, 1], rows[:, 0] / 10)


def test_resample_interpolates_linearly_between_samples() -> None:
    rows = resample([[0.0, 0.0], [1000.0, 10.0]], 2).samples
    assert rows.tolist() == [[0.0, 0.0], [500.0, 5.0], [1000.0, 10.0]]


def test_resample_drops_unusable_samples() -> None:
    samples = [[0.0, 1.0], [10.0, float("nan")], [10.0, 2.0], [5.0, 9.0], [20.0, 3.0]]
    usable = usable_samples(samples)
    assert usable.tolist() == [[0.0, 1.0], [10.0, 2.0], [20.0, 3.0]]
    assert resample([[0.0, 1.0]]).samples.shape[0] == 0
    assert resample([]).rate_hz == 0
    assert resample([[0.0, 1.0], [10.0, 2.0]], 0).samples.shape[0] == 0


def test_lowpass_keeps_slow_movement_and_removes_jitter() -> None:
    rate = 60.0
    times = np.arange(0, 3, 1 / rate)
    slow = np.sin(2 * np.pi * 0.5 * times)
    jitter = 0.2 * np.sin(2 * np.pi * 20 * times)
    filtered = lowpass(slow + jitter, rate, 6)
    middle = slice(30, -30)
    assert np.max(np.abs(filtered[middle] - slow[middle])) < 0.02
    # Zero phase: the slow wave is not delayed.
    assert np.argmax(filtered[:90]) == np.argmax(slow[:90])


def test_lowpass_is_safe_for_short_or_unfilterable_signals() -> None:
    assert lowpass([], 60).tolist() == []
    assert lowpass([1.0, 2.0], 60).tolist() == [1.0, 2.0]
    # Shorter than filtfilt's usual padding of 9 points: still filtered, same length.
    short = lowpass([0.0, 1.0, 0.0, 1.0, 0.0], 60, 6)
    assert short.shape == (5,)
    assert np.all(np.isfinite(short))
    # A cut-off at or above half the rate removes nothing.
    assert lowpass([0.0, 1.0, 0.0, 1.0], 10, 6).tolist() == [0.0, 1.0, 0.0, 1.0]
    with pytest.raises(ValueError):
        lowpass([0.0, 1.0, 2.0], 60, 0)


def test_speed_from_trajectory_uses_central_differences() -> None:
    # 3-4-5 triangles: 0.05 SW every 100 ms is 0.5 SW/s.
    points = [[0.0, 0.0, 0.0], [100.0, 0.03, 0.04], [200.0, 0.06, 0.08]]
    speed = speed_from_trajectory(points)
    assert speed[:, 0].tolist() == [0.0, 100.0, 200.0]
    assert np.allclose(speed[:, 1], 0.5)
    assert speed_from_trajectory([[0.0, 0.0, 0.0]]).shape == (0, 2)


def test_angular_speed_is_never_negative() -> None:
    angles = [[0.0, 90.0], [500.0, 80.0], [1000.0, 70.0]]
    speed = angular_speed(angles)
    assert np.allclose(speed[:, 1], 20)
    assert angular_speed([[0.0, 1.0]]).shape == (0, 2)


def test_smoothed_speed_peaks_where_the_reach_is_fastest() -> None:
    speed = smoothed_speed(reach())
    # A 1 SW minimum-jerk reach over 1 s peaks at 1.875 SW/s, halfway (800 ms).
    peak = int(np.argmax(speed[:, 1]))
    assert speed[peak, 1] == pytest.approx(1.875, rel=0.05)
    assert speed[peak, 0] == pytest.approx(800, abs=20)
    assert smoothed_speed([[0.0, 0.0, 0.0]]).shape == (0, 2)
