"""Game figures shared by the session lists, the dashboard and the admin pages.

Kept apart from services.games, which depends on services.sessions, so that both can use it.
"""

from collections import defaultdict
from collections.abc import Sequence

from sqlmodel import Session, col, select

from app.models import GameRun
from app.schemas.game import GameSummary, LastSessionGame


def _to_last_game(run: GameRun) -> LastSessionGame:
    summary = GameSummary.model_validate(run.summary) if run.summary else None
    return LastSessionGame.model_validate(
        {
            "game_id": run.game_id,
            "score": run.score,
            "success_rate": summary.success_rate if summary else None,
        }
    )


def finished_games_for_sessions(
    session: Session, session_ids: Sequence[int]
) -> dict[int, list[LastSessionGame]]:
    """Finished runs of many sessions in one query, each in the order they were played.

    Sessions without finished runs are left out.
    """
    if not session_ids:
        return {}
    statement = (
        select(GameRun)
        .where(col(GameRun.session_id).in_(session_ids), GameRun.status != "active")
        .order_by(col(GameRun.started_at), col(GameRun.id))
    )
    grouped: dict[int, list[LastSessionGame]] = defaultdict(list)
    for run in session.exec(statement).all():
        grouped[run.session_id].append(_to_last_game(run))
    return grouped
