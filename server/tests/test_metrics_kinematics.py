import numpy as np
import pytest

from app.metrics.kinematics import (
    closest_points,
    mean_distance_to_path,
    movement_ms,
    onset_ms,
    path_efficiency,
    path_length,
    peak_speed,
    reaction_ms,
    speed_peak_count,
    straight_distance,
    time_in_corridor_pct,
    window,
)
from app.metrics.signal import smoothed_speed
from metrics_helpers import reach, two_sub_movements


def test_a_minimum_jerk_reach_is_straight_with_one_peak() -> None:
    points = window(reach())
    assert path_length(points) == pytest.approx(1.0, abs=1e-3)
    assert straight_distance(points) == pytest.approx(1.0)
    assert path_efficiency(points) == pytest.approx(1.0, abs=1e-3)
    speed = smoothed_speed(points)
    assert speed_peak_count(speed) == 1
    assert peak_speed(speed) == pytest.approx(1.875, rel=0.05)


def test_two_sub_movements_have_two_peaks() -> None:
    assert speed_peak_count(smoothed_speed(two_sub_movements())) == 2


def test_reaction_time_is_the_onset_of_the_reach() -> None:
    # The reach starts at 300 ms; its speed passes 0.15 SW/s about 70 ms later.
    reaction = reaction_ms(reach(onset_ms=300))
    assert reaction is not None
    assert 330 <= reaction <= 420
    later = reaction_ms(reach(onset_ms=700))
    assert later is not None
    assert later == pytest.approx(reaction + 400, abs=40)
    # Relative to a spawn after the start of the recording.
    shifted = reaction_ms(reach(onset_ms=700), spawn_ms=400)
    assert shifted == pytest.approx(later - 400, abs=1e-6)


def test_onset_needs_the_speed_held_for_50_ms() -> None:
    rows = np.array([[t, 0.0] for t in range(0, 300, 10)], dtype=float)
    # A 30 ms blip above the threshold, then a real rise at 200 ms.
    rows[5:8, 1] = 1.0
    rows[20:, 1] = 0.5
    assert onset_ms(rows) == pytest.approx(200)
    assert onset_ms(rows[:22]) is None  # Ends before the hold is done.
    assert onset_ms(np.empty((0, 2))) is None


def test_no_reaction_without_movement() -> None:
    still = np.array([[t, 0.2, -0.5] for t in np.arange(0, 1000, 33.3)])
    assert reaction_ms(still) is None
    assert reaction_ms([]) is None


def test_movement_time_runs_from_onset_to_the_end_event() -> None:
    assert movement_ms(350, 1400) == 1050
    assert movement_ms(None, 1400) is None
    assert movement_ms(350, None) is None
    assert movement_ms(500, 400) is None


def test_path_measures_of_a_detour() -> None:
    points = np.array([[0.0, 0.0, 0.0], [100.0, 0.0, 0.3], [200.0, 0.4, 0.3]])
    assert path_length(points) == pytest.approx(0.7)
    assert straight_distance(points) == pytest.approx(0.5)
    assert path_efficiency(points) == pytest.approx(0.5 / 0.7)
    single = points[:1]
    assert path_length(single) == 0 and straight_distance(single) == 0
    assert path_efficiency(single) is None


def test_window_keeps_the_points_between_two_times() -> None:
    points = window([[0, 0, 0], [100, 1, 1], [200, 2, 2], [300, 3, 3]], 100, 200)
    assert points[:, 0].tolist() == [100.0, 200.0]
    assert window([], 0, 100).shape[0] == 0


def test_speed_measures_of_an_empty_profile() -> None:
    empty = np.empty((0, 2))
    assert peak_speed(empty) is None
    assert speed_peak_count(empty) == 0
    assert speed_peak_count(np.array([[0.0, 0.0], [10.0, 0.0]])) == 0


PATH = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]


def test_closest_point_on_a_polyline() -> None:
    points = np.array([[0.0, 0.5, 0.2], [10.0, 1.3, 0.5], [20.0, -0.5, 0.0]])
    first, second, third = closest_points(points, PATH)
    assert (first.distance, first.along) == pytest.approx((0.2, 0.5))
    assert (second.distance, second.along) == pytest.approx((0.3, 1.5))
    # Before the start: the distance to the first vertex.
    assert (third.distance, third.along) == pytest.approx((0.5, 0.0))
    assert closest_points(points, []) == []
    [single] = closest_points(points[:1], [(0.0, 0.0)])
    assert single.distance == pytest.approx(np.hypot(0.5, 0.2))


def test_mean_distance_and_time_in_the_corridor() -> None:
    # Four points: 0.05, 0.1, 0.35 and 0.0 from the path.
    points = np.array(
        [[0.0, 0.2, 0.05], [33.0, 0.5, -0.1], [66.0, 0.5, 0.35], [99.0, 1.0, 0.6]]
    )
    assert mean_distance_to_path(points, PATH) == pytest.approx(0.125)
    # A 0.4 SW corridor reaches 0.2 SW either side: three of four points.
    assert time_in_corridor_pct(points, PATH, 0.4) == pytest.approx(75)
    empty = np.empty((0, 3))
    assert mean_distance_to_path(empty, PATH) is None
    assert time_in_corridor_pct(empty, PATH, 0.4) is None
