"""Each game's headline figure and, for some games, more figures beside it.

The web app shows the same figures (web/src/features/games/results.ts: mainMeasure and
extraMeasures); the report sends them too, so other readers, such as the feedback module, need not
know where each game keeps them.
"""

from app.schemas.game import GameSummary
from app.schemas.progress import GameMeasure

#: Summary `details` keys the games fill in.
DETAIL_HIGHEST_POPPED = "highest_popped_frac"
DETAIL_WIDEST_CATCH = "widest_catch_frac"
DETAIL_NOTE_HIT_RATE = "note_hit_rate"
DETAIL_BEST_OPENNESS = "best_openness"
DETAIL_BEST_FINGER = "best_finger"
DETAIL_TOTAL_STARS = "total_stars"
DETAIL_MEAN_IN_CORRIDOR = "mean_in_corridor_pct"
DETAIL_BEST_SPARC = "best_sparc"
DETAIL_BEST_RANGE_DEG = "best_range_deg"
FINGERS = ("index", "middle", "ring", "little")


def _number(summary: GameSummary, key: str) -> float | None:
    value = summary.details.get(key)
    # bool is an int in Python, but a true/false detail is not a figure.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def main_measure(game_id: str, summary: GameSummary | None) -> GameMeasure | None:
    """The headline figure, or None for a run without a summary."""
    if summary is None:
        return None
    if game_id == "balloon_pop":
        return GameMeasure(
            name="highest_balloon_frac",
            value=_number(summary, DETAIL_HIGHEST_POPPED),
            unit="share",
        )
    if game_id == "fruit_catch":
        return GameMeasure(
            name="widest_catch_frac", value=_number(summary, DETAIL_WIDEST_CATCH), unit="share"
        )
    if game_id == "bloom":
        return GameMeasure(name="flowers_grown", value=float(summary.successes), unit="count")
    if game_id == "finger_piano":
        return GameMeasure(
            name="note_hit_rate", value=_number(summary, DETAIL_NOTE_HIT_RATE), unit="share"
        )
    if game_id == "path_trace":
        return GameMeasure(
            name="stars", value=_number(summary, DETAIL_TOTAL_STARS), unit="count"
        )
    if game_id == "paint_wall":
        return GameMeasure(name="stripes_finished", value=float(summary.successes), unit="count")
    return GameMeasure(name="mean_reach_ms", value=summary.mean_movement_ms, unit="ms")


def extra_measures(game_id: str, summary: GameSummary | None) -> list[GameMeasure]:
    """The figures shown beside the headline; empty for games without any or without a summary."""
    if summary is None:
        return []
    if game_id == "bloom":
        return [
            GameMeasure(
                name="best_openness", value=_number(summary, DETAIL_BEST_OPENNESS), unit="share"
            )
        ]
    if game_id == "finger_piano":
        finger = summary.details.get(DETAIL_BEST_FINGER)
        return [
            GameMeasure(
                name="best_finger", value=finger if finger in FINGERS else None, unit="finger"
            )
        ]
    if game_id == "path_trace":
        return [
            GameMeasure(
                name="mean_in_corridor_pct",
                value=_number(summary, DETAIL_MEAN_IN_CORRIDOR),
                unit="percent",
            ),
            GameMeasure(name="best_sparc", value=_number(summary, DETAIL_BEST_SPARC), unit="sparc"),
        ]
    if game_id == "paint_wall":
        return [
            GameMeasure(
                name="best_range_deg", value=_number(summary, DETAIL_BEST_RANGE_DEG), unit="deg"
            )
        ]
    return []
