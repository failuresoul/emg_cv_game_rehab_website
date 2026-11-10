"""Each game's headline figure and, for the hand games, a second one.

The web app shows the same figures (web/src/features/games/results.ts: mainMeasure and
extraMeasure); the report sends them too, so other readers, such as the feedback module, need not
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
    return GameMeasure(name="mean_reach_ms", value=summary.mean_movement_ms, unit="ms")


def extra_measure(game_id: str, summary: GameSummary | None) -> GameMeasure | None:
    """The second figure of a hand game; None for other games or without a summary."""
    if summary is None:
        return None
    if game_id == "bloom":
        return GameMeasure(
            name="best_openness", value=_number(summary, DETAIL_BEST_OPENNESS), unit="share"
        )
    if game_id == "finger_piano":
        finger = summary.details.get(DETAIL_BEST_FINGER)
        return GameMeasure(
            name="best_finger", value=finger if finger in FINGERS else None, unit="finger"
        )
    return None
