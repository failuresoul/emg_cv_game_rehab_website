"""The patient's progress over time and the end-of-session report.

Days are the patient's local days: the browser sends its offset from UTC in minutes.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta

from sqlalchemy import ColumnElement, case, func
from sqlmodel import Session, and_, col, or_, select

from app.models import Calibration, GameRun, PatientProfile, Trial, WarmupResult
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.game import GameSummary
from app.schemas.progress import (
    CalendarDay,
    GameComparison,
    PatientProgress,
    ProgressPoint,
    ReachSnapshot,
    SessionReport,
    SessionReportGame,
    WarmupComparison,
)
from app.services import session_feedback
from app.services.game_measures import extra_measures, main_measure
from app.services.sessions import duration_seconds, get_last_session_record, list_calibrations
from app.services.warmup_summary import summaries_for_sessions, summarise

CALENDAR_DAYS = 28
#: Offsets in use run from UTC-12 to UTC+14.
MAX_OFFSET_MINUTES = 14 * 60


# Days and weeks (pure)


def local_day(moment: datetime, offset_minutes: int) -> date:
    return (as_utc(moment) + timedelta(minutes=offset_minutes)).date()


def today_for(offset_minutes: int, now: datetime | None = None) -> date:
    return local_day(now or utc_now(), offset_minutes)


def streak_days(days: Iterable[date], today: date) -> int:
    """Consecutive days with a session, counting back from today.

    Today counts if it has a session. If it has none yet, the streak still runs up to
    yesterday, because the day is not over.
    """
    practised = set(days)
    day = today if today in practised else today - timedelta(days=1)
    count = 0
    while day in practised:
        count += 1
        day -= timedelta(days=1)
    return count


def week_start(today: date) -> date:
    """Monday of today's week."""
    return today - timedelta(days=today.weekday())


def sessions_this_week(days: Iterable[date], today: date) -> int:
    start = week_start(today)
    return sum(1 for day in days if start <= day <= today)


def calendar(days: Iterable[date], today: date, length: int = CALENDAR_DAYS) -> list[CalendarDay]:
    """The last `length` days, oldest first, with the number of sessions on each."""
    counts = Counter(days)
    first = today - timedelta(days=length - 1)
    return [
        CalendarDay(date=day, completed=counts[day])
        for day in (first + timedelta(days=index) for index in range(length))
    ]


# Queries


def _completed_sessions(session: Session, patient_id: int) -> list[SessionRecord]:
    statement = (
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id, SessionRecord.status == "completed")
        .order_by(col(SessionRecord.started_at), col(SessionRecord.id))
    )
    return list(session.exec(statement).all())


def _hull_areas(session: Session, session_ids: Sequence[int]) -> dict[int, float]:
    if not session_ids:
        return {}
    statement = select(Calibration.session_id, Calibration.hull_area_sw2).where(
        col(Calibration.session_id).in_(session_ids)
    )
    return {session_id: area for session_id, area in session.exec(statement).all()}


def game_success_rates(session: Session, session_ids: Sequence[int]) -> dict[int, float]:
    """Successful trials over all trials of each session, leaving out stopped trials.

    Sessions without any such trial are left out.
    """
    if not session_ids:
        return {}
    successes = func.sum(case((col(Trial.outcome) == "success", 1), else_=0))
    statement = (
        select(GameRun.session_id, func.count(), successes)
        .join(GameRun, col(Trial.game_run_id) == col(GameRun.id))
        .where(col(GameRun.session_id).in_(session_ids), Trial.outcome != "aborted")
        .group_by(col(GameRun.session_id))
    )
    return {
        session_id: (done or 0) / total
        for session_id, total, done in session.exec(statement).all()
        if total
    }


#: Each per-session figure of the progress series: the game, and the trial metric averaged over
#: its trials (Finger piano adds up notes instead). A trial without the metric is left out.
MEAN_FIGURES: dict[str, tuple[str, str]] = {
    "bloom_peak_openness": ("bloom", "peak_openness"),
    "path_sparc": ("path_trace", "sparc"),
    "elbow_range_deg": ("paint_wall", "achieved_range_deg"),
    "pick_transport_ms": ("pick_place", "transport_ms"),
    "grip_steadiness": ("grip_hold", "steadiness"),
    "grip_relaxation_ms": ("grip_hold", "relaxation_ms"),
}
#: Games whose trials give per-session figures for the progress series.
FIGURE_GAMES = tuple(sorted({"finger_piano", *(game for game, _ in MEAN_FIGURES.values())}))


@dataclass(frozen=True)
class SessionFigures:
    """A session's figures from the hand and movement-quality games; None without the game."""

    bloom_peak_openness: float | None = None
    piano_hit_rate: float | None = None
    path_sparc: float | None = None
    elbow_range_deg: float | None = None
    pick_transport_ms: float | None = None
    grip_steadiness: float | None = None
    grip_relaxation_ms: float | None = None


def session_figures(session: Session, session_ids: Sequence[int]) -> dict[int, SessionFigures]:
    """For each session: Bloom's mean peak openness, Finger piano's hit rate (notes played over
    notes asked), Path trace's mean SPARC, Paint the wall's mean elbow range, Pick and place's mean
    carry time, and Grip and hold's mean steadiness and relaxation time.

    Trials the patient stopped are left out. A session without one of the games has None for it.
    """
    if not session_ids:
        return {}
    statement = (
        select(GameRun.session_id, GameRun.game_id, Trial.metrics)
        .join(GameRun, col(Trial.game_run_id) == col(GameRun.id))
        .where(
            col(GameRun.session_id).in_(session_ids),
            col(GameRun.game_id).in_(FIGURE_GAMES),
            Trial.outcome != "aborted",
        )
    )
    values: dict[tuple[int, str], list[float]] = defaultdict(list)
    notes: dict[int, list[int]] = {}
    sessions: set[int] = set()
    for session_id, game_id, metrics in session.exec(statement).all():
        found = metrics or {}
        if game_id == "finger_piano":
            hits, total = found.get("hits"), found.get("notes_total")
            if isinstance(hits, int) and isinstance(total, int) and total > 0:
                tally = notes.setdefault(session_id, [0, 0])
                tally[0] += hits
                tally[1] += total
                sessions.add(session_id)
            continue
        for figure, (figure_game, metric) in MEAN_FIGURES.items():
            value = found.get(metric)
            if figure_game != game_id or isinstance(value, bool):
                continue
            if isinstance(value, int | float):
                values[(session_id, figure)].append(float(value))
                sessions.add(session_id)

    def mean(session_id: int, figure: str) -> float | None:
        found = values.get((session_id, figure))
        return sum(found) / len(found) if found else None

    return {
        session_id: SessionFigures(
            piano_hit_rate=(
                notes[session_id][0] / notes[session_id][1] if session_id in notes else None
            ),
            **{figure: mean(session_id, figure) for figure in MEAN_FIGURES},
        )
        for session_id in sessions
    }


def _snapshot(calibration: Calibration, session_record: SessionRecord) -> ReachSnapshot:
    assert session_record.id is not None
    return ReachSnapshot(
        session_id=session_record.id,
        date=calibration.created_at,
        reach_radii_sw=calibration.reach_radii_sw,
        hull_sw=[(point[0], point[1]) for point in calibration.hull_sw],
        hull_area_sw2=calibration.hull_area_sw2,
        valid=list(calibration.quality.get("valid", [])),
    )


def _snapshot_of(session: Session, calibration: Calibration | None) -> ReachSnapshot | None:
    if calibration is None:
        return None
    record = session.get(SessionRecord, calibration.session_id)
    assert record is not None
    return _snapshot(calibration, record)


def get_progress(
    session: Session, profile: PatientProfile, offset_minutes: int = 0
) -> PatientProgress:
    assert profile.id is not None
    completed = _completed_sessions(session, profile.id)
    ids = [record.id for record in completed if record.id is not None]
    days = [local_day(record.started_at, offset_minutes) for record in completed]
    today = today_for(offset_minutes)

    areas = _hull_areas(session, ids)
    warmups = summaries_for_sessions(session, ids)
    rates = game_success_rates(session, ids)
    figures = session_figures(session, ids)
    series: list[ProgressPoint] = []
    for record in completed:
        assert record.id is not None
        warmup = warmups.get(record.id)
        found = figures.get(record.id, SessionFigures())
        series.append(
            ProgressPoint(
                session_id=record.id,
                date=record.started_at,
                hull_area_sw2=areas.get(record.id),
                warmup_goals_reached=warmup.goals_reached if warmup else 0,
                warmup_total=warmup.exercises_total if warmup else 0,
                game_success_rate=rates.get(record.id),
                total_reps=warmup.total_reps if warmup else 0,
                bloom_peak_openness=found.bloom_peak_openness,
                piano_hit_rate=found.piano_hit_rate,
                path_sparc=found.path_sparc,
                elbow_range_deg=found.elbow_range_deg,
                pick_transport_ms=found.pick_transport_ms,
                grip_steadiness=found.grip_steadiness,
                grip_relaxation_ms=found.grip_relaxation_ms,
            )
        )

    calibrations = list_calibrations(session, profile.id)  # Newest first.
    last = get_last_session_record(session, profile.id)
    return PatientProgress(
        streak_days=streak_days(days, today),
        sessions_this_week=sessions_this_week(days, today),
        weekly_goal=profile.weekly_goal,
        calendar=calendar(days, today),
        series=series,
        last_session_date=last.started_at if last else None,
        first_reach=_snapshot_of(session, calibrations[-1] if calibrations else None),
        latest_reach=_snapshot_of(session, calibrations[0] if calibrations else None),
    )


def get_streak(session: Session, patient_id: int, offset_minutes: int = 0) -> int:
    completed = _completed_sessions(session, patient_id)
    days = [local_day(record.started_at, offset_minutes) for record in completed]
    return streak_days(days, today_for(offset_minutes))


# The end-of-session report


def _earlier_than(record: SessionRecord) -> ColumnElement[bool]:
    """Sessions of the same patient that started before this one."""
    return and_(
        col(SessionRecord.patient_id) == record.patient_id,
        or_(
            col(SessionRecord.started_at) < record.started_at,
            and_(
                col(SessionRecord.started_at) == record.started_at,
                col(SessionRecord.id) < record.id,
            ),
        ),
    )


def _game_summary(run: GameRun) -> GameSummary | None:
    return GameSummary.model_validate(run.summary) if run.summary else None


def _previous_run(session: Session, record: SessionRecord, game_id: str) -> GameComparison | None:
    statement = (
        select(GameRun)
        .join(SessionRecord, col(GameRun.session_id) == col(SessionRecord.id))
        .where(_earlier_than(record), GameRun.game_id == game_id, GameRun.status != "active")
        .order_by(
            col(SessionRecord.started_at).desc(),
            col(GameRun.started_at).desc(),
            col(GameRun.id).desc(),
        )
    )
    run = session.exec(statement).first()
    if run is None:
        return None
    summary = _game_summary(run)
    return GameComparison(
        session_id=run.session_id,
        score=run.score,
        success_rate=summary.success_rate if summary else None,
        summary=summary,
    )


def _previous_warmup(session: Session, record: SessionRecord) -> WarmupComparison | None:
    statement = (
        select(SessionRecord.id)
        .join(WarmupResult, col(WarmupResult.session_id) == col(SessionRecord.id))
        .where(_earlier_than(record))
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    previous_id = session.exec(statement).first()
    if previous_id is None:
        return None
    summary = summaries_for_sessions(session, [previous_id]).get(previous_id)
    if summary is None:
        return None
    return WarmupComparison(**summary.model_dump(), session_id=previous_id)


def _previous_reach(session: Session, record: SessionRecord) -> ReachSnapshot | None:
    statement = (
        select(Calibration, SessionRecord)
        .join(SessionRecord, col(Calibration.session_id) == col(SessionRecord.id))
        .where(_earlier_than(record))
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    row = session.exec(statement).first()
    return _snapshot(row[0], row[1]) if row else None


def get_session_report(session: Session, record: SessionRecord) -> SessionReport:
    assert record.id is not None
    results = list(session.exec(select(WarmupResult).where(WarmupResult.session_id == record.id)))
    runs = list(
        session.exec(
            select(GameRun)
            .where(GameRun.session_id == record.id, GameRun.status != "active")
            .order_by(col(GameRun.started_at), col(GameRun.id))
        )
    )
    calibration = session.exec(
        select(Calibration).where(Calibration.session_id == record.id)
    ).first()
    feedback = session_feedback.get_feedback(session, record.id)

    active_ms = sum(result.active_time_ms for result in results if not result.skipped)
    for run in runs:
        if run.ended_at is not None:
            elapsed = as_utc(run.ended_at) - as_utc(run.started_at)
            active_ms += max(elapsed.total_seconds(), 0) * 1000

    games: list[SessionReportGame] = []
    for run in runs:
        assert run.id is not None
        summary = _game_summary(run)
        games.append(
            SessionReportGame(
                run_id=run.id,
                game_id=run.game_id,  # type: ignore[arg-type]
                status=run.status,  # type: ignore[arg-type]
                score=run.score,
                trials_done=run.trials_done,
                trials_planned=run.trials_planned,
                successes=summary.successes if summary else None,
                success_rate=summary.success_rate if summary else None,
                summary=summary,
                main_measure=main_measure(run.game_id, summary),
                extra_measures=extra_measures(run.game_id, summary),
                previous=_previous_run(session, record, run.game_id),
            )
        )

    return SessionReport(
        session_id=record.id,
        started_at=record.started_at,
        ended_at=record.ended_at,
        status=record.status,  # type: ignore[arg-type]
        duration_seconds=duration_seconds(record),
        active_seconds=round(active_ms / 1000, 1),
        warmup=summarise(results),
        previous_warmup=_previous_warmup(session, record),
        games=games,
        reach=_snapshot(calibration, record) if calibration else None,
        previous_reach=_previous_reach(session, record),
        feedback=session_feedback.to_read(feedback, record) if feedback else None,
        flags=list(record.flags or []),  # type: ignore[arg-type]
    )
