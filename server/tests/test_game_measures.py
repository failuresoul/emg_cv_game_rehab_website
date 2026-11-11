import pytest

from app.schemas.game import GameSummary
from app.services.game_measures import extra_measures, main_measure


def summary(**details: float | str | bool | None) -> GameSummary:
    return GameSummary(
        successes=3,
        success_rate=0.75,
        mean_movement_ms=1234.0,
        compensated_trials=0,
        details=details,
    )


@pytest.mark.parametrize(
    ("game_id", "details", "expected"),
    [
        ("reach_activate", {}, ("mean_reach_ms", 1234.0, "ms")),
        ("balloon_pop", {"highest_popped_frac": 0.85}, ("highest_balloon_frac", 0.85, "share")),
        ("fruit_catch", {"widest_catch_frac": 0.7}, ("widest_catch_frac", 0.7, "share")),
        ("bloom", {}, ("flowers_grown", 3, "count")),
        ("finger_piano", {"note_hit_rate": 0.6}, ("note_hit_rate", 0.6, "share")),
        ("path_trace", {"total_stars": 21}, ("stars", 21, "count")),
        ("paint_wall", {}, ("stripes_finished", 3, "count")),
    ],
)
def test_main_measure_of_every_game(
    game_id: str, details: dict[str, float], expected: tuple[str, float, str]
) -> None:
    measure = main_measure(game_id, summary(**details))
    assert measure is not None
    assert (measure.name, measure.value, measure.unit) == expected


def test_extra_measures_of_the_games_that_have_them() -> None:
    def named(game_id: str, **details: float | str) -> list[tuple[str, object, str]]:
        return [(m.name, m.value, m.unit) for m in extra_measures(game_id, summary(**details))]

    assert named("bloom", best_openness=0.9) == [("best_openness", 0.9, "share")]
    assert named("finger_piano", best_finger="middle") == [("best_finger", "middle", "finger")]
    assert named("path_trace", mean_in_corridor_pct=82.5, best_sparc=-1.42) == [
        ("mean_in_corridor_pct", 82.5, "percent"),
        ("best_sparc", -1.42, "sparc"),
    ]
    assert named("paint_wall", best_range_deg=78.5) == [("best_range_deg", 78.5, "deg")]
    assert extra_measures("reach_activate", summary()) == []


def test_measures_without_a_summary_or_usable_values() -> None:
    assert main_measure("bloom", None) is None
    assert extra_measures("bloom", None) == []
    missing = main_measure("balloon_pop", summary())
    assert missing is not None and missing.value is None
    # True/false is not a figure, and only real fingers count.
    flag = main_measure("finger_piano", summary(note_hit_rate=True))
    assert flag is not None and flag.value is None
    [thumb] = extra_measures("finger_piano", summary(best_finger="thumb"))
    assert thumb.value is None
    assert [m.value for m in extra_measures("path_trace", summary())] == [None, None]
