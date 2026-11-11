"""SPARC, the spectral arc length of a speed profile: a measure of movement smoothness that does
not depend on the movement's size or duration. Always 0 or less; closer to 0 is smoother.

Balasubramanian S, Melendez-Calderon A, Roby-Brami A, Burdet E (2015). "On the analysis of
movement smoothness." Journal of NeuroEngineering and Rehabilitation 12:112.
https://doi.org/10.1186/s12984-015-0090-9

Step for step as the web app (web/src/metrics/sparc.ts), so both reproduce the shared test
vectors (shared/test-vectors/sparc.json):

1. Resample the speed profile to 60 Hz (linear interpolation, endpoints kept).
2. Zero-pad to 2^(ceil(log2(points)) + 4) points and take the magnitude spectrum.
3. Normalise the magnitude by its value at 0 Hz.
4. Keep frequencies up to the last one (at most 10 Hz) whose normalised magnitude is >= 0.05.
5. SPARC is minus the arc length of that curve, with frequency normalised to 0-1.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from app.metrics.signal import DEFAULT_RATE_HZ, FloatArray, Sample, resample

PAD_LEVEL = 4
CUTOFF_HZ = 10.0
AMPLITUDE_THRESHOLD = 0.05


@dataclass(frozen=True)
class SparcResult:
    #: The smoothness: 0 or less, closer to 0 is smoother.
    sparc: float
    #: The frequency where the spectrum was cut.
    cutoff_hz: float
    fft_size: int
    #: The rate the speed profile was resampled to.
    rate_hz: float
    resampled_count: int


def next_power_of_two(n: int) -> int:
    size = 1
    while size < n:
        size *= 2
    return size


def sparc_details(
    speed: Sequence[Sample] | FloatArray,
    rate_hz: float = DEFAULT_RATE_HZ,
    pad_level: int = PAD_LEVEL,
    cutoff_hz: float = CUTOFF_HZ,
    amplitude_threshold: float = AMPLITUDE_THRESHOLD,
) -> SparcResult | None:
    """SPARC of a speed profile of [t_ms, speed] rows, with the steps' details. None for fewer
    than three samples after resampling, or a profile with no movement (zero at 0 Hz)."""
    resampled = resample([list(row) for row in speed], rate_hz)
    if resampled.samples.shape[0] < 3:
        return None
    values = resampled.samples[:, 1]

    fft_size = 2 ** (int(math.log2(next_power_of_two(values.size))) + pad_level)
    magnitude = np.abs(np.fft.fft(values, n=fft_size))
    dc = float(magnitude[0])
    if not dc > 0:
        return None
    normalised = magnitude / dc
    frequencies = np.arange(fft_size) * resampled.rate_hz / fft_size

    within = np.flatnonzero(frequencies <= cutoff_hz)
    above = within[normalised[within] >= amplitude_threshold]
    last = int(above[-1]) if above.size > 0 else 0
    if last == 0:
        return None

    span = float(frequencies[last] - frequencies[0])
    steps_f = np.diff(frequencies[: last + 1]) / span
    steps_m = np.diff(normalised[: last + 1])
    arc = float(np.sum(np.hypot(steps_f, steps_m)))
    return SparcResult(
        sparc=-arc,
        cutoff_hz=float(frequencies[last]),
        fft_size=fft_size,
        rate_hz=resampled.rate_hz,
        resampled_count=int(values.size),
    )


def sparc(speed: Sequence[Sample] | FloatArray, rate_hz: float = DEFAULT_RATE_HZ) -> float | None:
    """SPARC of a speed profile of [t_ms, speed] rows; None if it cannot be measured."""
    result = sparc_details(speed, rate_hz)
    return result.sparc if result else None
