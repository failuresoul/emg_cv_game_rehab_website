"""Synthetic movements for the metrics tests."""

import numpy as np

from app.metrics.signal import FloatArray

#: About 30 Hz, like the webcam.
CAMERA_STEP_MS = 1000 / 30


def camera_times(duration_ms: float) -> FloatArray:
    return np.arange(0, duration_ms + 1e-9, CAMERA_STEP_MS)


def min_jerk(
    times: FloatArray,
    start_ms: float,
    duration_ms: float,
    start: tuple[float, float],
    end: tuple[float, float],
) -> tuple[FloatArray, FloatArray]:
    """A minimum-jerk movement from `start` to `end` (SW), still before and after."""
    share = np.clip((times - start_ms) / duration_ms, 0, 1)
    progress = 10 * share**3 - 15 * share**4 + 6 * share**5
    return (
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
    )


def reach(duration_ms: float = 1800, onset_ms: float = 300) -> FloatArray:
    """One smooth reach of 1 SW over 1 s, starting at `onset_ms`: [t_ms, x, y] rows."""
    times = camera_times(duration_ms)
    x, y = min_jerk(times, onset_ms, 1000, (0.1, -0.5), (0.7, 0.3))
    return np.column_stack([times, x, y])


def two_sub_movements() -> FloatArray:
    """A reach made in two overlapping parts: most of the way, then a correction."""
    times = camera_times(1800)
    x1, y1 = min_jerk(times, 300, 600, (0.1, -0.5), (0.45, 0.0))
    x2, y2 = min_jerk(times, 800, 700, (0.0, 0.0), (0.25, 0.3))
    return np.column_stack([times, x1 + x2, y1 + y2])
