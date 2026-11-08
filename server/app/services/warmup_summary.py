"""Warm-up figures shared by the session lists, the dashboard and the admin history.

Kept apart from services.warmup, which depends on services.sessions, so that both can use it.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence

from sqlmodel import Session, col, select

from app.models import WarmupResult
from app.schemas.warmup import WarmupSummary

#: A goal counts as reached with this share of the target reps done in full. It matches the share
#: that raises the next target, and the web app's goalReached().
GOAL_SHARE = 0.9


def goal_reached(result: WarmupResult) -> bool:
    if result.skipped or result.target_reps <= 0:
        return False
    return result.full_reps >= GOAL_SHARE * result.target_reps


def summarise(results: Sequence[WarmupResult]) -> WarmupSummary | None:
    """None if there are no results at all. Skipped exercises count only towards the total."""
    if not results:
        return None
    done = [result for result in results if not result.skipped]
    return WarmupSummary(
        exercises_done=len(done),
        exercises_total=len(results),
        total_reps=sum(result.full_reps for result in done),
        goals_reached=sum(1 for result in done if goal_reached(result)),
        mean_compensation_rate=(
            sum(result.compensation_rate for result in done) / len(done) if done else None
        ),
    )


def summaries_for_sessions(
    session: Session, session_ids: Iterable[int]
) -> dict[int, WarmupSummary]:
    """One query for many sessions. Sessions without warm-up results are left out."""
    ids = list(session_ids)
    if not ids:
        return {}
    statement = select(WarmupResult).where(col(WarmupResult.session_id).in_(ids))
    grouped: dict[int, list[WarmupResult]] = defaultdict(list)
    for result in session.exec(statement).all():
        grouped[result.session_id].append(result)
    summaries: dict[int, WarmupSummary] = {}
    for session_id, results in grouped.items():
        summary = summarise(results)
        if summary is not None:
            summaries[session_id] = summary
    return summaries
