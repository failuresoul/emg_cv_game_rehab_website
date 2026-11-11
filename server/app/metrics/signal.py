"""Signals sampled at irregular times: resampling, filtering for analysis, and speeds.

Saved data stays RAW; these are for working out measures only. Resampling matches the web app
(web/src/metrics/resample.ts) step for step, so SPARC agrees between the two.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy.signal import butter, filtfilt

FloatArray = npt.NDArray[np.float64]
#: One sample: its time in ms, then one or more values, such as [t_ms, speed] or [t_ms, x, y].
Sample = Sequence[float]

DEFAULT_RATE_HZ = 60.0
DEFAULT_CUTOFF_HZ = 6.0
BUTTERWORTH_ORDER = 2


@dataclass(frozen=True)
class Resampled:
    #: Rows of [t_ms, *values], evenly spaced from the first sample's time to the last's.
    samples: FloatArray
    #: The rate actually used: (points - 1) / duration. Within a fraction of a percent of the one
    #: asked for; 0 when there was nothing to resample.
    rate_hz: float


def _round_half_up(value: float) -> int:
    """JavaScript's Math.round, so the point count matches the web app exactly."""
    return math.floor(value + 0.5)


def usable_samples(samples: Sequence[Sample], min_width: int = 2) -> FloatArray:
    """The samples with at least `min_width` finite numbers whose time increases, as an array
    trimmed to the narrowest row. Empty (0 rows) when none are usable."""
    kept: list[Sequence[float]] = []
    for sample in samples:
        if len(sample) < min_width or not all(math.isfinite(value) for value in sample):
            continue
        if not kept or sample[0] > kept[-1][0]:
            kept.append(sample)
    if not kept:
        return np.empty((0, min_width))
    width = min(len(sample) for sample in kept)
    return np.array([list(sample[:width]) for sample in kept], dtype=np.float64)


def resample(samples: Sequence[Sample], rate_hz: float = DEFAULT_RATE_HZ) -> Resampled:
    """Linear interpolation to a fixed rate. The number of points is round(duration · rate) + 1,
    so the first and last samples are kept exactly. Samples whose time does not increase are
    dropped; fewer than two usable samples give no rows and a rate of 0."""
    usable = usable_samples(samples)
    if usable.shape[0] < 2 or not rate_hz > 0:
        return Resampled(samples=np.empty((0, usable.shape[1])), rate_hz=0.0)
    t0, t_end = float(usable[0, 0]), float(usable[-1, 0])
    duration_s = (t_end - t0) / 1000
    count = max(2, _round_half_up(duration_s * rate_hz) + 1)
    times = t0 + (t_end - t0) * np.arange(count) / (count - 1)
    rows = np.empty((count, usable.shape[1]))
    rows[:, 0] = times
    for column in range(1, usable.shape[1]):
        rows[:, column] = np.interp(times, usable[:, 0], usable[:, column])
    # Exactly the original endpoints, without rounding error.
    rows[0] = usable[0]
    rows[-1] = usable[-1]
    return Resampled(samples=rows, rate_hz=(count - 1) / duration_s)


def lowpass(
    values: Sequence[float] | FloatArray,
    rate_hz: float = DEFAULT_RATE_HZ,
    cutoff_hz: float = DEFAULT_CUTOFF_HZ,
) -> FloatArray:
    """A 2nd-order Butterworth low-pass filter run forwards and backwards (zero phase), for
    analysis only.

    Safe for any length: fewer than three values come back unchanged, and a signal shorter than
    filtfilt's usual padding is padded as much as it allows. A cut-off at or above half the rate
    leaves nothing to remove, so the values come back unchanged.
    """
    data = np.asarray(values, dtype=np.float64)
    if not cutoff_hz > 0:
        raise ValueError(f"cut-off ({cutoff_hz} Hz) must be above 0")
    if data.size < 3 or not rate_hz > 0 or cutoff_hz >= rate_hz / 2:
        return data.copy()
    b, a = butter(BUTTERWORTH_ORDER, cutoff_hz, btype="low", fs=rate_hz)
    # filtfilt's default padding is 3 · (filter length) = 9 points; shorter signals use less.
    padlen = min(3 * max(len(a), len(b)), data.size - 1)
    return np.asarray(filtfilt(b, a, data, padlen=padlen), dtype=np.float64)


def _rates(usable: FloatArray, sizes: FloatArray) -> FloatArray:
    """[t_ms, rate] rows from each sample's change to its neighbours (central difference, one
    neighbour at either end), given the size of each change from row i-1 to i+1."""
    seconds = np.empty(usable.shape[0])
    seconds[1:-1] = (usable[2:, 0] - usable[:-2, 0]) / 1000
    seconds[0] = (usable[1, 0] - usable[0, 0]) / 1000
    seconds[-1] = (usable[-1, 0] - usable[-2, 0]) / 1000
    return np.column_stack([usable[:, 0], sizes / seconds])


def _neighbours(usable: FloatArray) -> tuple[FloatArray, FloatArray]:
    before = np.vstack([usable[:1], usable[:-2], usable[-2:-1]])
    after = np.vstack([usable[1:2], usable[2:], usable[-1:]])
    return before, after


def speed_from_trajectory(points: Sequence[Sample] | FloatArray) -> FloatArray:
    """Speed along [t_ms, x_sw, y_sw] points, in SW/s, as [t_ms, speed] rows (as the web app's
    speedFromTrajectory). Empty with fewer than two usable points."""
    usable = usable_samples([list(point) for point in points], min_width=3)
    if usable.shape[0] < 2:
        return np.empty((0, 2))
    before, after = _neighbours(usable)
    sizes = np.hypot(after[:, 1] - before[:, 1], after[:, 2] - before[:, 2])
    return _rates(usable, sizes)


def angular_speed(samples: Sequence[Sample] | FloatArray) -> FloatArray:
    """How fast an angle changes, from [t_ms, degrees] rows, in degrees per second (always 0 or
    more), as [t_ms, speed] rows. Empty with fewer than two usable samples."""
    usable = usable_samples([list(sample) for sample in samples], min_width=2)
    if usable.shape[0] < 2:
        return np.empty((0, 2))
    before, after = _neighbours(usable)
    return _rates(usable, np.abs(after[:, 1] - before[:, 1]))


def smoothed_speed(
    points: Sequence[Sample] | FloatArray,
    rate_hz: float = DEFAULT_RATE_HZ,
    cutoff_hz: float = DEFAULT_CUTOFF_HZ,
) -> FloatArray:
    """Speed of a trajectory for finding movement onset and peaks: resampled to a fixed rate,
    x and y low-pass filtered, then differentiated. [t_ms, SW/s] rows; empty if too short."""
    resampled = resample([list(point) for point in points if len(point) >= 3], rate_hz)
    rows = resampled.samples
    if rows.shape[0] < 2 or rows.shape[1] < 3:
        return np.empty((0, 2))
    filtered = np.column_stack(
        [
            rows[:, 0],
            lowpass(rows[:, 1], resampled.rate_hz, cutoff_hz),
            lowpass(rows[:, 2], resampled.rate_hz, cutoff_hz),
        ]
    )
    return speed_from_trajectory(filtered)
