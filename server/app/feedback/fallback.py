"""The template report, used when the model fails twice (or is not reachable).

Built only from the facts, the candidates and the approved tips, with fixed sentences, so it
always passes the validator. It never repeats the safety notice: the app shows that itself.
"""

from typing import Any

from app.feedback.names import (
    GAME_NAMES,
    MOVEMENT_NAMES,
    FeedbackLanguage,
    direction_name,
    metric_name,
)
from app.feedback.rules import ALWAYS_LAST, Candidate, RedFlag, tip
from app.feedback.schemas import (
    MAX_HIGHLIGHTS,
    MAX_SUGGESTIONS,
    WORD_LIMITS,
    Highlight,
    Report,
    SuggestionText,
)
from app.schemas.metrics import FactsMetric, SessionFacts

_BANGLA_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")

TEXT: dict[FeedbackLanguage, dict[str, str]] = {
    "en": {
        "thanks": "Thank you for finishing session {n}.",
        "notice": "Thank you for your session today. Please read the note from the app below.",
        "no_history": (
            "There is not enough history yet to compare your results. "
            "Each session helps the app learn your usual level."
        ),
        "improved": "You improved {name} today.",
        "worse": "One thing was harder than usual today: {name}.",
        "steady": "This stayed steady: {name}.",
        "others_steady": "Your other results were steady.",
        "all_steady": "Your results were steady, close to your usual level.",
        "next": "Next time you will practise {movements}.",
        "next_directions": "You will reach {directions} a little more.",
        "next_games": "Games: {games}.",
        "next_unknown": "Your next session will be planned after this one.",
        "join": " and ",
    },
    "bn": {
        "thanks": "সেশন {n} শেষ করার জন্য ধন্যবাদ।",
        "notice": "আজকের সেশনের জন্য ধন্যবাদ। অনুগ্রহ করে নিচে অ্যাপের বার্তাটি পড়ুন।",
        "no_history": (
            "তুলনা করার মতো যথেষ্ট তথ্য এখনও নেই। "
            "প্রতিটি সেশন থেকে অ্যাপ আপনার স্বাভাবিক মাত্রা শেখে।"
        ),
        "improved": "আজ আপনার {name} উন্নত হয়েছে।",
        "worse": "আজ {name} স্বাভাবিকের চেয়ে কঠিন ছিল।",
        "steady": "{name} স্থির ছিল।",
        "others_steady": "আপনার অন্য ফলাফল স্থির ছিল।",
        "all_steady": "আপনার ফলাফল আগের মতোই স্থির ছিল।",
        "next": "পরের সেশনে আপনি {movements} অনুশীলন করবেন।",
        "next_directions": "দিক: {directions}।",
        "next_games": "খেলা: {games}।",
        "next_unknown": "এই সেশনের পরে আপনার পরের সেশনের পরিকল্পনা করা হবে।",
        "join": " ও ",
    },
}


def _number(value: float, language: FeedbackLanguage) -> str:
    text = fmt(value)
    return text.translate(_BANGLA_DIGITS) if language == "bn" else text


def fmt(value: float) -> str:
    """At most two decimals, no trailing zeros."""
    return f"{round(value, 2):.2f}".rstrip("0").rstrip(".")


def _by_status(facts: SessionFacts, status: str) -> list[FactsMetric]:
    """One entry per measure (a measure can come from several games)."""
    seen: dict[str, FactsMetric] = {}
    for metric in facts.metrics:
        if metric.mdc_status == status:
            seen.setdefault(metric.id, metric)
    return list(seen.values())


def _summary(facts: SessionFacts, flagged: bool, language: FeedbackLanguage) -> str:
    text = TEXT[language]
    if flagged:
        return text["notice"]
    parts = [text["thanks"].format(n=_number(facts.session_no, language))]
    if not facts.baseline_available:
        parts.append(text["no_history"])
        return " ".join(parts)
    improved = _by_status(facts, "improved")
    worse = _by_status(facts, "worse")
    steady = _by_status(facts, "no_detectable_change")
    parts += [text["improved"].format(name=metric_name(m.id, language)) for m in improved[:2]]
    parts += [text["worse"].format(name=metric_name(m.id, language)) for m in worse[:1]]
    if steady and (improved or worse):
        parts.append(text["others_steady"])
    elif steady:
        parts.append(text["all_steady"])
    return " ".join(parts)


def _highlights(facts: SessionFacts, language: FeedbackLanguage) -> list[Highlight]:
    if not facts.baseline_available:
        return []
    chosen = [
        *[(m, "improved") for m in _by_status(facts, "improved")],
        *[(m, "worse") for m in _by_status(facts, "worse")[:1]],
        *[(m, "steady") for m in _by_status(facts, "no_detectable_change")],
    ][:MAX_HIGHLIGHTS]
    return [
        Highlight(
            metric_id=metric.id,
            text=TEXT[language][kind].format(name=metric_name(metric.id, language)),
        )
        for metric, kind in chosen
    ]


def _suggestion_text(candidate: Candidate, language: FeedbackLanguage) -> str:
    if language == "en":
        return candidate.guidance
    # The tip without its heading.
    return tip(candidate.id, language).split("\n", 1)[-1].strip()


def _suggestions(candidates: list[Candidate], language: FeedbackLanguage) -> list[SuggestionText]:
    # The next session has its own text, so NEXT_FOCUS is only used when nothing else applies.
    chosen = [c for c in candidates if c.id != ALWAYS_LAST][:MAX_SUGGESTIONS] or candidates[:1]
    return [SuggestionText(id=c.id, text=_suggestion_text(c, language)) for c in chosen]


def _next_session(facts: SessionFacts, language: FeedbackLanguage) -> str:
    text = TEXT[language]
    plan = facts.next_session
    if plan is None:
        return text["next_unknown"]
    movements = [MOVEMENT_NAMES[language].get(m, m) for m in plan.focus_movements[:2]]
    directions = [
        name
        for name in (direction_name(d, language) for d in plan.focus_directions[:2])
        if name is not None
    ]
    games = [GAME_NAMES[language].get(g, g) for g in plan.planned_games[:3]]
    parts: list[str] = []
    if movements:
        parts.append(text["next"].format(movements=text["join"].join(movements)))
    if directions:
        parts.append(text["next_directions"].format(directions=text["join"].join(directions)))
    if games:
        parts.append(text["next_games"].format(games=", ".join(games)))
    return " ".join(parts) or text["next_unknown"]


def _therapist_summary(facts: SessionFacts, facts_seen: dict[str, Any], flagged: bool) -> str:
    """English and technical: measure ids, baseline -> latest, change in MDC, flags, the plan."""
    status_word = {
        "improved": "improved",
        "worse": "worse",
        "no_detectable_change": "similar",
        "no_baseline": "no baseline",
    }
    parts = [f"Session {facts.session_no}."]
    if flagged:
        parts.append("Safety notice shown to the patient; review the session flags.")
    if not facts.baseline_available:
        parts.append("No baseline yet.")
    for metric in facts.metrics:
        label = metric.id + (f" ({metric.game_id})" if metric.game_id else "")
        word = status_word[metric.mdc_status]
        if metric.baseline is not None and metric.change_mdc is not None:
            parts.append(
                f"{label} {word}: {fmt(metric.baseline)} -> {fmt(metric.value)} {metric.unit} "
                f"({fmt(metric.change_mdc)} MDC)."
            )
        else:
            parts.append(f"{label} {word}: {fmt(metric.value)} {metric.unit}.")
    games = [
        f"{game_id} {game.trials} trials"
        + (f", success {fmt(game.success_rate)}" if game.success_rate is not None else "")
        + (
            f", level {game.level_start} -> {game.level_end}"
            if game.level_start is not None and game.level_end is not None
            else ""
        )
        for game_id, game in list(facts.games.items())[:4]
    ]
    if games:
        parts.append("Games: " + "; ".join(games) + ".")
    if facts.directions.weak:
        parts.append("Weak directions: " + ", ".join(str(d) for d in facts.directions.weak) + ".")
    flags = facts.flags
    found = []
    if flags.compensation_rate is not None:
        found.append(f"compensation {fmt(flags.compensation_rate * 100)}% of trials")
    if flags.shoulder_compensation_rate:
        found.append(f"shoulder hike {fmt(flags.shoulder_compensation_rate * 100)}%")
    if flags.hand_loss_pct is not None:
        found.append(f"hand not tracked {fmt(flags.hand_loss_pct)}% of movement time")
    if flags.fatigue_flag:
        found.append("high-fatigue flag")
    if found:
        parts.append("Flags: " + "; ".join(found) + ".")
    report = facts_seen.get("self_report")
    if report:
        answers = [f"fatigue {report['fatigue_0_10']}/10", f"enjoyment {report['enjoyment_1_5']}/5"]
        if "pain_0_10" in report:
            answers.insert(0, f"pain {report['pain_0_10']}/10")
        parts.append("Self-report: " + ", ".join(answers) + ".")
    adherence = facts.adherence
    parts.append(
        f"Adherence: {adherence.sessions_this_week} of {adherence.planned_this_week} "
        "sessions this week."
    )
    plan = facts.next_session
    if plan is not None:
        plan_parts = []
        if plan.focus_movements:
            plan_parts.append("focus " + ", ".join(plan.focus_movements))
        if plan.focus_directions:
            plan_parts.append("directions " + ", ".join(fmt(d) for d in plan.focus_directions))
        if plan.planned_games:
            plan_parts.append("games " + ", ".join(plan.planned_games))
        if plan_parts:
            parts.append("Next session: " + "; ".join(plan_parts) + ".")

    # Keep within the word limit, dropping whole sentences from the end.
    limit = WORD_LIMITS["therapist_summary"]
    kept: list[str] = []
    for part in parts:
        if len(" ".join([*kept, part]).split()) > limit:
            continue
        kept.append(part)
    return " ".join(kept)


def build_fallback(
    facts: SessionFacts,
    facts_seen: dict[str, Any],
    candidates: list[Candidate],
    red_flags: list[RedFlag],
    language: FeedbackLanguage,
) -> Report:
    flagged = bool(red_flags)
    return Report(
        language=language,
        patient_summary=_summary(facts, flagged, language),
        highlights=_highlights(facts, language),
        suggestions=_suggestions(candidates, language),
        next_session_text=_next_session(facts, language),
        therapist_summary=_therapist_summary(facts, facts_seen, flagged),
    )
