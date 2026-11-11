"""Reach timings and path measures from a RAW trajectory of [t_ms, x_sw, y_sw] rows.

Times are relative to the trial's spawn unless stated. Path measures use the RAW points; onset
and peaks use a filtered speed (signal.smoothed_speed), so a single frame of tracking jitter is
neither an onset nor a peak.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.signal import find_peaks

from app.metrics.signal import FloatArray, Sample, smoothed_speed, usable_samples

#: Movement starts when the speed first stays above this for ONSET_HOLD_MS.
ONSET_SPEED_SW_S = 0.15
ONSET_HOLD_MS = 50.0
#: A speed peak counts only if it stands out by this share of the highest speed.
PEAK_PROMINENCE_SHARE = 0.1


def _points(trajectory: Sequence[Sample] | FloatArray) -> FloatArray:
    return usable_samples([list(point) for point in trajectory], min_width=3)


def window(
    trajectory: Sequence[Sample] | FloatArray,
    from_ms: float | None = None,
    to_ms: float | None = None,
) -> FloatArray:
    """The usable points with from_ms <= t <= to_ms (either end open when None)."""
    points = _points(trajectory)
    keep = np.ones(points.shape[0], dtype=bool)
    if from_ms is not None:
        keep &= points[:, 0] >= from_ms
    if to_ms is not None:
        keep &= points[:, 0] <= to_ms
    return points[keep]


def onset_ms(
    speed: FloatArray,
    threshold: float = ONSET_SPEED_SW_S,
    hold_ms: float = ONSET_HOLD_MS,
) -> float | None:
    """The first time the speed rises above `threshold` and stays above it for `hold_ms`, from
    [t_ms, speed] rows. None if it never does, or the profile ends before the hold is done."""
    if speed.shape[0] == 0:
        return None
    times, values = speed[:, 0], speed[:, 1]
    above = values > threshold
    start: int | None = None
    for index in range(len(times)):
        if not above[index]:
            start = None
            continue
        if start is None:
            start = index
        if times[index] - times[start] >= hold_ms:
            return float(times[start])
    return None


def reaction_ms(
    trajectory: Sequence[Sample] | FloatArray,
    spawn_ms: float = 0.0,
    threshold: float = ONSET_SPEED_SW_S,
    hold_ms: float = ONSET_HOLD_MS,
) -> float | None:
    """Spawn to movement onset: speed first above 0.15 SW/s for 50 ms. None without an onset."""
    onset = onset_ms(smoothed_speed(window(trajectory, from_ms=spawn_ms)), threshold, hold_ms)
    return None if onset is None else max(0.0, onset - spawn_ms)


def movement_ms(onset: float | None, end: float | None) -> float | None:
    """Movement onset to a given end event (such as entering the target); None unless both
    happened and the end is not before the onset."""
    if onset is None or end is None or end < onset:
        return None
    return end - onset


def path_length(points: FloatArray) -> float:
    """Along the points, in SW; 0 for fewer than two."""
    if points.shape[0] < 2:
        return 0.0
    return float(np.sum(np.hypot(np.diff(points[:, 1]), np.diff(points[:, 2]))))


def straight_distance(points: FloatArray) -> float:
    """From the first point to the last, in SW; 0 for fewer than two."""
    if points.shape[0] < 2:
        return 0.0
    return float(np.hypot(points[-1, 1] - points[0, 1], points[-1, 2] - points[0, 2]))


def path_efficiency(points: FloatArray) -> float | None:
    """Straight distance over path length, 0-1 (1 is a perfectly straight path); None when the
    path has no length."""
    length = path_length(points)
    return min(1.0, straight_distance(points) / length) if length > 0 else None


def peak_speed(speed: FloatArray) -> float | None:
    return float(np.max(speed[:, 1])) if speed.shape[0] > 0 else None


def speed_peak_count(speed: FloatArray, prominence_share: float = PEAK_PROMINENCE_SHARE) -> int:
    """How many distinct speed peaks: each must stand out by more than 10% of the highest speed
    (scipy's prominence), so a movement made in two parts has two peaks and a smooth one has one.
    The profile is padded with a zero at each end, so a peak at the very start or end counts."""
    if speed.shape[0] == 0:
        return 0
    values = np.concatenate([[0.0], speed[:, 1], [0.0]])
    highest = float(np.max(values))
    if not highest > 0:
        return 0
    peaks, _ = find_peaks(values, prominence=prominence_share * highest)
    return int(peaks.size)


@dataclass(frozen=True)
class ClosestPoint:
    distance: float
    #: Distance along the path to the closest point, in SW.
    along: float


def closest_points(points: FloatArray, path: Sequence[Sample] | FloatArray) -> list[ClosestPoint]:
    """For each [t, x, y] point, the closest point on the polyline `path` of [x, y] pairs."""
    vertices = np.asarray([list(vertex)[:2] for vertex in path], dtype=np.float64)
    if vertices.shape[0] == 0 or points.shape[0] == 0:
        return []
    if vertices.shape[0] == 1:
        vertices = np.vstack([vertices, vertices])
    starts, ends = vertices[:-1], vertices[1:]
    segments = ends - starts
    lengths = np.hypot(segments[:, 0], segments[:, 1])
    offsets = np.concatenate([[0.0], np.cumsum(lengths)[:-1]])
    squared = np.maximum(lengths**2, 1e-24)
    result: list[ClosestPoint] = []
    for x, y in points[:, 1:3]:
        share = np.clip(
            ((x - starts[:, 0]) * segments[:, 0] + (y - starts[:, 1]) * segments[:, 1]) / squared,
            0.0,
            1.0,
        )
        nearest_x = starts[:, 0] + share * segments[:, 0]
        nearest_y = starts[:, 1] + share * segments[:, 1]
        distances = np.hypot(x - nearest_x, y - nearest_y)
        best = int(np.argmin(distances))
        result.append(
            ClosestPoint(
                distance=float(distances[best]),
                along=float(offsets[best] + share[best] * lengths[best]),
            )
        )
    return result


def mean_distance_to_path(points: FloatArray, path: Sequence[Sample] | FloatArray) -> float | None:
    """The mean distance of the points from the polyline, in SW; None without points."""
    closest = closest_points(points, path)
    return float(np.mean([item.distance for item in closest])) if closest else None


def time_in_corridor_pct(
    points: FloatArray, path: Sequence[Sample] | FloatArray, corridor_width_sw: float
) -> float | None:
    """The share of the points within half the corridor's width of the path, 0-100. Each point
    counts once, as in the web app (about 30 Hz camera frames); None without points."""
    closest = closest_points(points, path)
    if not closest:
        return None
    inside = sum(1 for item in closest if item.distance <= corridor_width_sw / 2)
    return 100 * inside / len(closest)
