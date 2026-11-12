"""Facts and answers for the feedback tests: a good answer for the quiet session, and random
facts for the fallback."""

import random
from typing import Any

from app.feedback.names import METRIC_NAMES
from app.schemas.metrics import (
    FactsAdherence,
    FactsDirections,
    FactsFlags,
    FactsGame,
    FactsMetric,
    FactsNextSession,
    FactsSelfReport,
    SessionFacts,
)
from app.services.metrics_catalog import get_metric

#: A valid English report for tests.test_feedback_rules.make_facts() (a quiet session 6:
#: G1 steady; candidates STEADY_EFFORT and NEXT_FOCUS).
GOOD_ANSWER: dict[str, Any] = {
    "language": "en",
    "patient_summary": (
        "Thank you for session 6. Your game success was steady today. "
        "Keep up your regular routine."
    ),
    "highlights": [{"metric_id": "G1", "text": "Your game success stayed steady."}],
    "suggestions": [
        {"id": "STEADY_EFFORT", "text": "Steady days are normal. Coming back regularly is what counts."}
    ],
    "next_session_text": "Next time you will practise gripping and holding, and reaching up.",
    "therapist_summary": (
        "Session 6. G1 similar: 1 -> 1 share (0.3 MDC). reach_activate 20 trials, success 0.8, "
        "level 4 -> 4. Compensation 5% of trials. Self-report: pain 1/10, fatigue 3/10. "
        "Adherence 5 of 5 sessions this week. Next session: grip focus, direction 90."
    ),
}

GAMES = ["reach_activate", "balloon_pop", "bloom", "grip_hold", "pick_place", "finger_piano"]
MOVEMENTS = ["reach", "shoulder", "elbow", "hand_opening", "fingers", "grip", "smoothness"]
DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315]
STATUSES = ["improved", "worse", "no_detectable_change", "no_baseline"]


def _maybe(rng: random.Random, value: Any, chance: float = 0.8) -> Any:
    return value if rng.random() < chance else None


def random_facts(seed: int) -> SessionFacts:
    """Facts of every kind: any measures and statuses, flags, red flags and plans."""
    rng = random.Random(seed)
    baseline = rng.random() < 0.75
    metrics: list[FactsMetric] = []
    for metric_id in rng.sample(sorted(METRIC_NAMES["en"]), rng.randint(0, 8)):
        catalogue = get_metric(metric_id)
        assert catalogue is not None
        status = rng.choice(STATUSES[:3]) if baseline else "no_baseline"
        change = {
            "improved": rng.uniform(1, 3.5),
            "worse": rng.uniform(-3.5, -1),
            "no_detectable_change": rng.uniform(-0.9, 0.9),
        }.get(status)
        value = round(rng.uniform(0, 1500) if rng.random() < 0.5 else rng.random(), 4)
        metrics.append(
            FactsMetric(
                id=metric_id,
                game_id=rng.choice([None, "reach_activate", "grip_hold", "bloom"]),
                name=catalogue.name,
                value=value,
                baseline=None if change is None else round(value * rng.uniform(0.7, 1.3), 4),
                unit=catalogue.unit,
                change_mdc=None if change is None else round(change, 3),
                mdc_status=status,  # type: ignore[arg-type]
            )
        )
    games = {}
    for game_id in rng.sample(GAMES, rng.randint(0, 4)):
        start = rng.choice([None, 1, 3, 5, 8])
        games[game_id] = FactsGame(
            trials=rng.randint(1, 25),
            success_rate=_maybe(rng, round(rng.random(), 3)),
            level_start=start,
            level_end=None if start is None else max(1, min(10, start + rng.choice([-1, 0, 1, 2]))),
        )
    weak = sorted(rng.sample(DIRECTIONS, rng.randint(0, 3)))
    safety = [flag for flag in ("pain", "new_symptoms", "high_fatigue") if rng.random() < 0.15]
    report = (
        FactsSelfReport(
            pain_0_10=rng.randint(0, 10),
            fatigue_0_10=rng.randint(0, 10),
            enjoyment_1_5=rng.randint(1, 5),
        )
        if rng.random() < 0.8
        else None
    )
    plan = (
        FactsNextSession(
            focus_movements=rng.sample(MOVEMENTS, rng.randint(0, 3)),
            focus_directions=[float(d) for d in rng.sample(DIRECTIONS, rng.randint(0, 2))],
            planned_games=rng.sample(GAMES, rng.randint(0, 4)),
        )
        if rng.random() < 0.8
        else None
    )
    return SessionFacts(
        session_id=seed,
        patient_code="P123",
        session_no=rng.randint(1, 40),
        language=rng.choice(["en", "bn"]),
        affected_side=rng.choice(["left", "right"]),
        duration_min=_maybe(rng, round(rng.uniform(5, 40), 1)),
        baseline_available=baseline,
        games=games,
        metrics=metrics,
        directions=FactsDirections(weak=weak, strong=[d for d in DIRECTIONS if d not in weak][:2]),
        flags=FactsFlags(
            compensation_rate=_maybe(rng, round(rng.random() * 0.5, 3)),
            fatigue_flag="high_fatigue" in safety,
            hand_loss_pct=_maybe(rng, round(rng.random() * 12, 1)),
            shoulder_compensation_rate=_maybe(rng, round(rng.random() * 0.4, 3)),
            safety_flags=safety,  # type: ignore[arg-type]
        ),
        self_report=report,
        adherence=FactsAdherence(
            sessions_this_week=rng.randint(0, 6), planned_this_week=rng.choice([0, 3, 5])
        ),
        next_session=plan,
        safety_notice_present=bool({"pain", "new_symptoms"} & set(safety)),
    )
