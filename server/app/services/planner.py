"""The session planner: which games today, in what order, and why.

Inputs, all from the patient's completed sessions before the one being planned:

- **Need** per movement: each movement's measures and their change against the baseline (see
  NEED_METRICS).
  - worse: 1.0;
  - no detectable change: 0.7 when other measures improved, else 0.4;
  - no baseline yet: 0.3;
  - improved: 0.
  - A movement takes the most needy of its measures.
- **Weak directions:** from the patient's L2 beliefs per workspace sector when there are
  some, else from the reach games' success per direction in the last 3 sessions.
  - A direction is weak when its success is 0.15 (beliefs) or 0.2 (trials) below the patient's
    average.
- **Variety:** a bonus for games not played in the last 2 sessions, a penalty for a game played
  in both (a third session in a row).
- **Enjoyment:** small bonuses for a game's recent success and for the enjoyment ratings of the
  sessions it was played in.
- **Load:** from the patient's programme (Day 17; defaults 3-4 games and 18 minutes). After a
  session with fatigue 7 or more, "too hard", or a pain flag, a lighter plan: the fewest games
  and about two thirds of the minutes. Otherwise the most games and the target's last two
  minutes (16-18 by default), the trials scaled to fit.

Rules that always hold:
- only games the Game Library has turned on and the patient's programme allows;
- at least one reach or shoulder game and one hand, finger or grip game (when enabled);
- no two shoulder-heavy games next to each other;
- the easiest game (highest recent success) first and the most enjoyable last, when the other
  rules allow.

Ties are broken by a hash seeded with the patient and the session, so the same inputs always give
the same plan.
"""

import hashlib
import itertools
import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from statistics import fmean
from typing import Any

from sqlmodel import Session, col, select

from app.engine.base import EngineData
from app.engine.l2_bayes import beta_mean
from app.models import EngineState, GameRun, GameSetting, PatientProfile, SessionFeedback, Trial
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.common import as_utc
from app.schemas.plan import PlanFocus, PlannedGame, PlanNote, SessionPlan
from app.services.game_settings import effective_trials
from app.services.game_specs import GameSpec, load_specs
from app.services import programme as programmes
from app.services.progress import patient_metrics

PLANNER_VERSION = 1

#: The movement each game trains.
MOVEMENT: dict[str, str] = {
    "reach_activate": "reach",
    "fruit_catch": "reach",
    "pick_place": "reach",
    "balloon_pop": "shoulder",
    "paint_wall": "elbow",
    "bloom": "hand_opening",
    "finger_piano": "fingers",
    "grip_hold": "grip",
    "path_trace": "smoothness",
}
#: The measures (shared/metrics-catalog.json) that show each movement's need.
NEED_METRICS: dict[str, tuple[str, ...]] = {
    "reach": ("K1", "K6", "K7"),
    "shoulder": ("R1", "R2"),
    "elbow": ("R3",),
    "hand_opening": ("H1", "H6"),
    "fingers": ("H2",),
    "grip": ("H3", "H4"),
    "smoothness": ("K8",),
}
#: At least one of each group in every plan.
REACH_SHOULDER = frozenset({"reach_activate", "fruit_catch", "pick_place", "balloon_pop", "path_trace"})
HAND = frozenset({"bloom", "finger_piano", "grip_hold"})
#: Games that keep the arm raised; never two in a row.
SHOULDER_HEAVY = frozenset({"balloon_pop", "path_trace", "fruit_catch"})
#: Games where a weak direction can be practised, and the directions each one can place.
DIRECTION_GAMES: dict[str, tuple[float, ...] | None] = {
    "reach_activate": None,  # every direction
    "pick_place": None,
    "balloon_pop": (45.0, 90.0, 135.0),
}

STATUS_NEED = {"worse": 1.0, "no_baseline": 0.3, "improved": 0.0}
UNCHANGED_WHEN_OTHERS_IMPROVED = 0.7
UNCHANGED = 0.4
UNKNOWN_NEED = 0.3
FOCUS_NEED = 0.6
WEIGHT_NEED = 1.0
WEIGHT_WEAK_DIRECTION = 0.4
VARIETY_BONUS = 0.3
THIRD_IN_A_ROW = 0.6
WEIGHT_SUCCESS = 0.15
WEIGHT_ENJOYMENT = 0.1
#: An unknown success rate counts as this.
DEFAULT_SUCCESS = 0.6
HEAVY_FATIGUE = 7
#: A lighter plan has this share of the programme's minutes (12 of the default 18).
LIGHT_SHARE = 2 / 3
#: A normal plan aims for the programme's minutes, or up to this much less.
NORMAL_BAND = 2.0
MIN_TRIALS, MAX_TRIALS = 5, 40
BELIEF_GAP = 0.15
TRIAL_GAP = 0.2
MIN_DIRECTION_TRIALS = 4


@dataclass
class History:
    """What the planner knows: the patient's completed sessions before the plan, newest first."""

    sessions: list[SessionRecord]
    runs: dict[int, list[GameRun]] = field(default_factory=dict)
    feedback: dict[int, SessionFeedback] = field(default_factory=dict)


def load_history(session: Session, profile: PatientProfile, before: datetime | None, inclusive: bool) -> History:
    statement = select(SessionRecord).where(
        SessionRecord.patient_id == profile.id, SessionRecord.status == "completed"
    )
    records = [
        record
        for record in session.exec(statement).all()
        if before is None
        or (as_utc(record.started_at) <= as_utc(before) if inclusive else as_utc(record.started_at) < as_utc(before))
    ]
    records.sort(key=lambda record: (as_utc(record.started_at), record.id or 0), reverse=True)
    ids = [record.id for record in records if record.id is not None]
    runs: dict[int, list[GameRun]] = defaultdict(list)
    feedback: dict[int, SessionFeedback] = {}
    if ids:
        for run in session.exec(select(GameRun).where(col(GameRun.session_id).in_(ids))).all():
            runs[run.session_id].append(run)
        for row in session.exec(select(SessionFeedback).where(col(SessionFeedback.session_id).in_(ids))).all():
            feedback[row.session_id] = row
    return History(records, dict(runs), feedback)


def movement_needs(session: Session, profile: PatientProfile) -> dict[str, float]:
    assert profile.id is not None
    changes = patient_metrics(session, profile.id).metrics
    any_improved = any(change.status == "improved" for change in changes)
    needs: dict[str, float] = {}
    for movement, ids in NEED_METRICS.items():
        values = []
        for change in changes:
            if change.metric_id not in ids:
                continue
            if change.status == "no_detectable_change":
                values.append(UNCHANGED_WHEN_OTHERS_IMPROVED if any_improved else UNCHANGED)
            else:
                values.append(STATUS_NEED.get(change.status, UNKNOWN_NEED))
        needs[movement] = max(values) if values else UNKNOWN_NEED
    return needs


def _direction_from_lane(prefix: str) -> float | None:
    return 45.0 * int(prefix[1:]) if prefix.startswith("D") and prefix[1:].isdigit() else None


def weak_directions(session: Session, profile: PatientProfile, history: History) -> list[float]:
    """Up to two weak reach directions (degrees), weakest first."""
    rows = session.exec(
        select(EngineState).where(
            EngineState.patient_id == profile.id,
            EngineState.engine == "L2",
            EngineState.game_id == "reach_activate",
        )
    ).all()
    for row in rows:
        extra = EngineData.from_json(row.state).extra
        sectors: dict[str, list[float]] = extra.get("sectors") or {}
        seen: dict[str, int] = extra.get("seen") or {}
        by_direction: dict[float, list[float]] = defaultdict(list)
        for name, ab in sectors.items():
            prefix, _, ring = name.partition("R")
            direction = _direction_from_lane(prefix)
            # The stretch ring says little about weakness; directions need some trials.
            if direction is None or ring == "4" or seen.get(name, 0) < 1:
                continue
            by_direction[direction].append(beta_mean(ab))
        means = {d: fmean(v) for d, v in by_direction.items() if v}
        if len(means) >= 3:
            average = fmean(means.values())
            weak = sorted((m, d) for d, m in means.items() if m <= average - BELIEF_GAP)
            return [d for _, d in weak[:2]]

    # Without L2 beliefs: success per direction in the reach games of the last 3 sessions.
    run_ids = [
        run.id
        for record in history.sessions[:3]
        for run in history.runs.get(record.id or -1, [])
        if run.game_id in ("reach_activate", "balloon_pop", "pick_place") and run.id is not None
    ]
    if not run_ids:
        return []
    counts: dict[float, list[int]] = defaultdict(lambda: [0, 0])
    for trial in session.exec(select(Trial).where(col(Trial.game_run_id).in_(run_ids))).all():
        degrees = (trial.target or {}).get("direction_deg")
        if degrees is None or trial.outcome == "aborted":
            continue
        direction = float(round(float(degrees) / 45) % 8 * 45)
        counts[direction][0] += trial.outcome == "success"
        counts[direction][1] += 1
    rates = {d: s / n for d, (s, n) in counts.items() if n >= MIN_DIRECTION_TRIALS}
    if len(rates) < 3:
        return []
    average = fmean(rates.values())
    weak = sorted((rate, d) for d, rate in rates.items() if rate <= average - TRIAL_GAP)
    return [d for _, d in weak[:2]]


def recent_success(session: Session, history: History) -> dict[str, float]:
    """Each game's success rate over its runs in the last 3 sessions."""
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for record in history.sessions[:3]:
        for run in history.runs.get(record.id or -1, []):
            summary = run.summary or {}
            done = int(run.trials_done or 0)
            successes = summary.get("successes")
            if done and isinstance(successes, int | float):
                totals[run.game_id][0] += int(successes)
                totals[run.game_id][1] += done
    return {game: s / n for game, (s, n) in totals.items() if n}


def enjoyment(history: History) -> dict[str, float]:
    """Per game, the mean enjoyment (1-5) of the sessions it was played in, from -1 to 1."""
    ratings: dict[str, list[int]] = defaultdict(list)
    for record in history.sessions[:5]:
        feedback = history.feedback.get(record.id or -1)
        if feedback is None:
            continue
        for game in {run.game_id for run in history.runs.get(record.id or -1, [])}:
            ratings[game].append(feedback.enjoyment_1_5)
    return {game: (fmean(values) - 3) / 2 for game, values in ratings.items()}


def lighter_because(history: History) -> str | None:
    if not history.sessions:
        return None
    last = history.sessions[0]
    feedback = history.feedback.get(last.id or -1)
    if "pain" in (last.flags or []):
        return "pain"
    if feedback is not None and feedback.fatigue_0_10 >= HEAVY_FATIGUE:
        return "fatigue"
    if feedback is not None and feedback.difficulty == "too_hard":
        return "too_hard"
    return None


def _tie(seed: str, game_id: str) -> float:
    digest = hashlib.sha256(f"{seed}:{game_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64 * 1e-6


@dataclass
class Candidate:
    spec: GameSpec
    trials: int
    score: float
    need: float
    weak_direction: float | None
    variety: bool
    third_in_a_row: bool
    success: float
    enjoyment: float


def _order(chosen: list[Candidate]) -> list[Candidate]:
    """The best order: never two shoulder-heavy games next to each other; then the easiest first,
    the most enjoyable last, and the rest by score."""
    easiest = max(chosen, key=lambda c: (c.success, c.score)).spec.id
    favourite = max(chosen, key=lambda c: (c.enjoyment, c.success, c.score)).spec.id

    def quality(order: Sequence[Candidate]) -> tuple[float, ...]:
        ids = [c.spec.id for c in order]
        adjacent = sum(a in SHOULDER_HEAVY and b in SHOULDER_HEAVY for a, b in zip(ids, ids[1:]))
        # Then higher-scored games earlier.
        by_score = tuple(-ids.index(c.spec.id) for c in sorted(order, key=lambda c: -c.score))
        return (-adjacent, ids[0] == easiest, ids[-1] == favourite and len(ids) > 1, *by_score)

    return list(max(itertools.permutations(chosen), key=quality))


def _fits(chosen: list[Candidate]) -> bool:
    heavy = sum(c.spec.id in SHOULDER_HEAVY for c in chosen)
    return heavy <= math.ceil(len(chosen) / 2)


def _select(candidates: list[Candidate], count: int) -> list[Candidate]:
    ranked = sorted(candidates, key=lambda c: -c.score)
    chosen = ranked[:count]
    rest = ranked[count:]
    for group in (REACH_SHOULDER, HAND):
        if any(c.spec.id in group for c in chosen):
            continue
        replacement = next((c for c in rest if c.spec.id in group), None)
        if replacement is None:
            continue
        other = REACH_SHOULDER if group is HAND else HAND
        # Replace the lowest-scored game that is not the only one of the other group.
        for victim in sorted(chosen, key=lambda c: c.score):
            if victim.spec.id in other and sum(c.spec.id in other for c in chosen) == 1:
                continue
            chosen[chosen.index(victim)] = replacement
            rest.remove(replacement)
            rest.append(victim)
            break
    # Too many shoulder-heavy games to keep them apart: swap the weakest for another game.
    while not _fits(chosen):
        heavy = [c for c in chosen if c.spec.id in SHOULDER_HEAVY]
        swap = next((c for c in sorted(rest, key=lambda c: -c.score) if c.spec.id not in SHOULDER_HEAVY), None)
        if swap is None:
            break
        victim = min(heavy, key=lambda c: c.score)
        chosen[chosen.index(victim)] = swap
        rest.remove(swap)
    return chosen


def _reason(candidate: Candidate, lighter: bool, favourite: str, required: bool) -> tuple[str, dict[str, Any]]:
    movement = MOVEMENT[candidate.spec.id]
    if candidate.weak_direction is not None:
        return "practise_weak_direction", {"direction_deg": candidate.weak_direction}
    if candidate.need >= FOCUS_NEED:
        return f"focus_{movement}", {}
    if candidate.variety:
        return "variety", {}
    if candidate.spec.id == favourite and candidate.enjoyment > 0:
        return "favourite", {}
    if lighter:
        return "lighter_today", {}
    if required:
        return "balance", {"movement": movement}
    return "keep_practising", {"movement": movement}


def _minutes(spec: GameSpec, trials: int) -> float:
    return spec.estimated_minutes * trials / max(spec.trials_default, 1)


def build_plan(
    session: Session, profile: PatientProfile, history: History, seed: str
) -> SessionPlan:
    settings = {row.game_id: row for row in session.exec(select(GameSetting)).all()}
    programme = programmes.programme_for(session, profile)
    allowed = set(programme.enabled_games or [])
    specs = [
        spec
        for spec in load_specs()
        if spec.implemented
        and spec.id in MOVEMENT
        and spec.id in allowed
        and (settings.get(spec.id) is None or settings[spec.id].enabled)
    ]
    needs = movement_needs(session, profile)
    weak = weak_directions(session, profile, history)
    success = recent_success(session, history)
    liked = enjoyment(history)
    recent = [
        {run.game_id for run in history.runs.get(record.id or -1, [])} for record in history.sessions[:2]
    ]
    because = lighter_because(history)

    candidates = []
    for spec in specs:
        allowed = DIRECTION_GAMES.get(spec.id, ())
        weak_here = next(
            (d for d in weak if spec.id in DIRECTION_GAMES and (allowed is None or d in allowed)), None
        )
        need = needs.get(MOVEMENT[spec.id], UNKNOWN_NEED)
        played = [spec.id in games for games in recent]
        variety = not any(played)
        third = len(played) == 2 and all(played)
        game_success = success.get(spec.id, DEFAULT_SUCCESS)
        game_enjoyment = liked.get(spec.id, 0.0)
        score = (
            WEIGHT_NEED * need
            + (WEIGHT_WEAK_DIRECTION if weak_here is not None else 0.0)
            + (VARIETY_BONUS if variety else 0.0)
            - (THIRD_IN_A_ROW if third else 0.0)
            + WEIGHT_SUCCESS * (game_success * (2 if because else 1))
            + WEIGHT_ENJOYMENT * game_enjoyment
            + _tie(seed, spec.id)
        )
        candidates.append(
            Candidate(spec, effective_trials(spec, settings.get(spec.id)), score, need, weak_here,
                      variety, third, game_success, game_enjoyment)
        )

    count = programme.games_per_session_min if because else programme.games_per_session_max
    chosen = _order(_select(candidates, min(count, len(candidates)))) if candidates else []

    # Trials scaled so the plan fits its time.
    total = sum(_minutes(c.spec, c.trials) for c in chosen)
    minutes = float(programme.session_minutes_target)
    if because:
        target = round(minutes * LIGHT_SHARE, 1)
    else:
        low, high = minutes - NORMAL_BAND, minutes
        target = high - 1 if total > high else (low if total < low else total)
    factor = target / total if total else 1.0
    favourite = max(chosen, key=lambda c: (c.enjoyment, c.success)).spec.id if chosen else ""
    required_ids = set()
    for group in (REACH_SHOULDER, HAND):
        in_group = [c for c in chosen if c.spec.id in group]
        if len(in_group) == 1:
            required_ids.add(in_group[0].spec.id)
    games = []
    for candidate in chosen:
        trials = max(MIN_TRIALS, min(MAX_TRIALS, round(candidate.trials * factor)))
        key, params = _reason(candidate, because is not None, favourite, candidate.spec.id in required_ids)
        games.append(
            PlannedGame(
                game_id=candidate.spec.id,  # type: ignore[arg-type]
                trials=trials,
                minutes=round(_minutes(candidate.spec, trials), 1),
                reason_key=key,
                reason_params=params,
            )
        )
    focus_movements = [
        movement for movement, need in sorted(needs.items(), key=lambda item: (-item[1], item[0]))
        if need >= FOCUS_NEED
    ][:2]
    notes = [PlanNote(key="lighter_today", params={"because": because})] if because else []
    return SessionPlan(
        games=games,
        total_minutes=round(sum(game.minutes for game in games), 1),
        focus=PlanFocus(movements=focus_movements, directions=weak),
        notes=notes,
        version=PLANNER_VERSION,
        created_at=utc_now(),
    )


def plan_session(session: Session, profile: PatientProfile, record: SessionRecord) -> SessionPlan:
    """Today's plan for `record`, from the completed sessions before it."""
    history = load_history(session, profile, record.started_at, inclusive=False)
    return build_plan(session, profile, history, seed=f"{profile.id}:{record.id}")


def plan_next(session: Session, profile: PatientProfile, after: SessionRecord) -> SessionPlan:
    """The plan for the session after `after`, from every completed session up to it."""
    history = load_history(session, profile, after.started_at, inclusive=True)
    return build_plan(session, profile, history, seed=f"{profile.id}:after:{after.id}")


class NoPlanError(LookupError):
    """The session ended without a plan; one is never made afterwards."""


def stored_plan(session: Session, record: SessionRecord) -> SessionPlan:
    """The session's plan: computed the first time it is asked for while the session is active,
    then kept. A session that ended without one has none: a plan made later, from later
    measures, would misrepresent what was shown at the time."""
    if record.plan:
        return SessionPlan.model_validate(record.plan)
    if record.status != "active":
        raise NoPlanError
    profile = session.get(PatientProfile, record.patient_id)
    assert profile is not None
    plan = plan_session(session, profile, record)
    record.plan = plan.model_dump(mode="json")
    session.add(record)
    session.commit()
    session.refresh(record)
    return plan
