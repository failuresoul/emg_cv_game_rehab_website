"""The rule layer: the system, not the language model, decides what the feedback may say.

- `candidates(facts)`: the suggestions of catalogue.yaml that apply to a session, at most five,
  each with its approved guidance and the facts that triggered it (its evidence).
- `red_flags(facts)`: the fixed safety notices the session needs, worded in
  shared/safety-notices.json (the same file the web app's wording is checked against).
- `facts_for_llm(facts)`: the facts the model may see. When a red flag fires, the model is only
  told that a notice exists; it never sees or writes the notice.

Every threshold is in catalogue.yaml or below, so it can be changed in one place.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict

from app.core.config import settings
from app.schemas.metrics import FactsMetric, SessionFacts
from app.services.safety import PAIN_FLAG_MIN
from app.services.session_facts import KEY_METRICS

FEEDBACK_DIR = Path(__file__).resolve().parent
CATALOGUE_PATH = FEEDBACK_DIR / "catalogue.yaml"
KB_DIR = FEEDBACK_DIR / "kb"

#: At most this many suggestions are given to the model.
MAX_CANDIDATES = 5
#: Always kept, in the last place: the model's next_focus field is written from it.
ALWAYS_LAST = "NEXT_FOCUS"
GROUP_ORDER = {"safety": 0, "celebrate": 1, "general": 2}

#: A sharp decline: at least this many key measures worse by at least this many MDCs.
# To be confirmed with supervisor.
SHARP_DECLINE_COUNT = 3
SHARP_DECLINE_MDC = 2.0

Audience = Literal["patient", "therapist"]
FeedbackLanguage = Literal["en", "bn"]


class Suggestion(BaseModel):
    """One entry of catalogue.yaml."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    group: Literal["safety", "celebrate", "general"]
    priority: int
    audience: tuple[Audience, ...]
    trigger: str
    threshold: float | None = None
    effort: bool
    guidance: str


class _Catalogue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggestions: list[Suggestion]


class _Notice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    web_key: str | None
    en: str
    bn: str


class _NoticesFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    notices: dict[str, _Notice]
    red_flags: dict[str, str]


@dataclass(frozen=True)
class Evidence:
    """A fact that triggered a suggestion: a measure id or a facts field, and its value."""

    id: str
    value: Any
    game_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        found: dict[str, Any] = {"id": self.id, "value": self.value}
        if self.game_id is not None:
            found["game_id"] = self.game_id
        return found


@dataclass(frozen=True)
class Candidate:
    id: str
    guidance: str
    evidence: tuple[Evidence, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "guidance": self.guidance,
            "evidence": [item.as_dict() for item in self.evidence],
        }


@dataclass(frozen=True)
class RedFlag:
    code: Literal["pain", "new_symptoms", "sharp_decline"]
    #: The fixed, approved notice in the patient's language.
    text: str
    #: The measures behind a sharp decline; empty for the questionnaire's flags.
    evidence: tuple[Evidence, ...] = field(default=())

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "text": self.text}


# Loading


@lru_cache(maxsize=1)
def load_catalogue() -> tuple[Suggestion, ...]:
    """Every suggestion, in the file's order."""
    data = yaml.safe_load(CATALOGUE_PATH.read_text(encoding="utf-8"))
    suggestions = tuple(_Catalogue.model_validate(data).suggestions)
    ids = [suggestion.id for suggestion in suggestions]
    if len(set(ids)) != len(ids):
        raise ValueError(f"Repeated suggestion ids in {CATALOGUE_PATH}")
    return suggestions


def get_suggestion(suggestion_id: str) -> Suggestion:
    for suggestion in load_catalogue():
        if suggestion.id == suggestion_id:
            return suggestion
    raise KeyError(suggestion_id)


def tip(suggestion_id: str, language: FeedbackLanguage = "en") -> str:
    """The approved tip the model may reword (kb/<language>/<id>.md). Keyed by id: no search."""
    get_suggestion(suggestion_id)  # Unknown ids are an error, not a missing file.
    return (KB_DIR / language / f"{suggestion_id}.md").read_text(encoding="utf-8").strip()


@lru_cache(maxsize=4)
def _load_notices(path: Path) -> _NoticesFile:
    return _NoticesFile.model_validate(json.loads(path.read_text(encoding="utf-8")))


def notice_text(code: str, language: FeedbackLanguage) -> str:
    """A red flag's fixed notice, from shared/safety-notices.json."""
    notices = _load_notices(settings.safety_notices_path)
    notice = notices.notices[notices.red_flags[code]]
    return notice.bn if language == "bn" else notice.en


# The triggers. Each returns the evidence that fired it; an empty list means it did not apply.

Trigger = Callable[[SessionFacts, Suggestion], list[Evidence]]


def _measure(metric: FactsMetric) -> Evidence:
    return Evidence(id=metric.id, value=metric.value, game_id=metric.game_id)


def _with_status(facts: SessionFacts, status: str, *ids: str) -> list[Evidence]:
    return [
        _measure(metric)
        for metric in facts.metrics
        if metric.mdc_status == status and (not ids or metric.id in ids)
    ]


def _threshold(suggestion: Suggestion) -> float:
    assert suggestion.threshold is not None, f"{suggestion.id} needs a threshold"
    return suggestion.threshold


def _celebrate_progress(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    return _with_status(facts, "improved")


def _steady_effort(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    if _with_status(facts, "improved") or _with_status(facts, "worse"):
        return []
    return _with_status(facts, "no_detectable_change")


def _first_sessions(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    if facts.baseline_available:
        return []
    return [Evidence("baseline_available", False), Evidence("session_no", facts.session_no)]


def _practice_direction(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    weak = facts.directions.weak
    return [Evidence("directions.weak", list(weak))] if weak else []


def _posture_trunk(facts: SessionFacts, suggestion: Suggestion) -> list[Evidence]:
    rate = facts.flags.compensation_rate
    if rate is None or rate < _threshold(suggestion):
        return []
    return [Evidence("flags.compensation_rate", rate)]


def _shoulder_relax(facts: SessionFacts, suggestion: Suggestion) -> list[Evidence]:
    rate = facts.flags.shoulder_compensation_rate
    if rate is None or rate < _threshold(suggestion):
        return []
    return [Evidence("flags.shoulder_compensation_rate", rate)]


def _rest_breaks(facts: SessionFacts, suggestion: Suggestion) -> list[Evidence]:
    found: list[Evidence] = []
    if facts.flags.fatigue_flag:
        found.append(Evidence("flags.fatigue_flag", True))
    report = facts.self_report
    if report is not None and report.fatigue_0_10 >= _threshold(suggestion):
        found.append(Evidence("self_report.fatigue_0_10", report.fatigue_0_10))
    return found


def _relax_after_squeeze(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    return _with_status(facts, "worse", "H4")


def _steady_hold(facts: SessionFacts, suggestion: Suggestion) -> list[Evidence]:
    found = _with_status(facts, "worse", "H3")
    grip = facts.games.get("grip_hold")
    if grip is not None and grip.success_rate is not None:
        if grip.success_rate < _threshold(suggestion):
            found.append(Evidence("games.success_rate", grip.success_rate, game_id="grip_hold"))
    return found


def _setup_lighting(facts: SessionFacts, suggestion: Suggestion) -> list[Evidence]:
    lost = facts.flags.hand_loss_pct
    if lost is None or lost < _threshold(suggestion):
        return []
    return [Evidence("flags.hand_loss_pct", lost)]


def _routine(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    done, planned = facts.adherence.sessions_this_week, facts.adherence.planned_this_week
    if planned <= 0 or done >= planned:
        return []
    return [
        Evidence("adherence.sessions_this_week", done),
        Evidence("adherence.planned_this_week", planned),
    ]


def _level_up(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    levelled = {
        game_id: (game.level_start, game.level_end)
        for game_id, game in facts.games.items()
        if game.level_start is not None and game.level_end is not None
    }
    rose = [
        Evidence("games.level", {"start": start, "end": end}, game_id=game_id)
        for game_id, (start, end) in levelled.items()
        if end > start
    ]
    return rose if 2 * len(rose) > len(levelled) else []


def _next_focus(facts: SessionFacts, _: Suggestion) -> list[Evidence]:
    plan = facts.next_session
    if plan is None:
        return []
    fields = {
        "next_session.focus_movements": plan.focus_movements,
        "next_session.focus_directions": plan.focus_directions,
        "next_session.planned_games": plan.planned_games,
    }
    return [Evidence(name, list(value)) for name, value in fields.items() if value]


TRIGGERS: dict[str, Trigger] = {
    "CELEBRATE_PROGRESS": _celebrate_progress,
    "STEADY_EFFORT": _steady_effort,
    "FIRST_SESSIONS": _first_sessions,
    "PRACTICE_DIRECTION": _practice_direction,
    "POSTURE_TRUNK": _posture_trunk,
    "SHOULDER_RELAX": _shoulder_relax,
    "REST_BREAKS": _rest_breaks,
    "RELAX_AFTER_SQUEEZE": _relax_after_squeeze,
    "STEADY_HOLD": _steady_hold,
    "SETUP_LIGHTING": _setup_lighting,
    "ROUTINE": _routine,
    "LEVEL_UP": _level_up,
    "NEXT_FOCUS": _next_focus,
}


# The decisions


def red_flags(facts: SessionFacts, language: FeedbackLanguage | None = None) -> list[RedFlag]:
    """The fixed notices: pain and new symptoms (the Day 7 stop notice), then a sharp decline.
    Worded in `language`, or the patient's language when not given."""
    language = language or facts.language
    codes = set(facts.flags.safety_flags)
    if facts.self_report is not None and facts.self_report.pain_0_10 >= PAIN_FLAG_MIN:
        codes.add("pain")
    found = [
        RedFlag(code=code, text=notice_text(code, language))
        for code in ("pain", "new_symptoms")
        if code in codes
    ]

    # Each measure counts once, whichever games it was measured in.
    declined: dict[str, Evidence] = {}
    for metric in facts.metrics:
        if (
            metric.id in KEY_METRICS
            and metric.change_mdc is not None
            and metric.change_mdc <= -SHARP_DECLINE_MDC
        ):
            declined.setdefault(metric.id, _measure(metric))
    if len(declined) >= SHARP_DECLINE_COUNT:
        found.append(
            RedFlag(
                code="sharp_decline",
                text=notice_text("sharp_decline", language),
                evidence=tuple(declined.values()),
            )
        )
    return found


def notice_texts(flags: list[RedFlag]) -> list[str]:
    """The notices to show, once each (pain and new symptoms share the stop notice)."""
    return list(dict.fromkeys(flag.text for flag in flags))


def candidates(facts: SessionFacts, audience: Audience = "patient") -> list[Candidate]:
    """The suggestions that apply, at most MAX_CANDIDATES: safety first (REST_BREAKS,
    POSTURE_TRUNK, SHOULDER_RELAX), then CELEBRATE_PROGRESS, then the rest by priority, with
    NEXT_FOCUS always kept last. Under a red flag, suggestions asking for more effort are left
    out. Every candidate has evidence."""
    flagged = bool(red_flags(facts))
    found: list[tuple[Suggestion, Candidate]] = []
    for suggestion in load_catalogue():
        if audience not in suggestion.audience or (flagged and suggestion.effort):
            continue
        evidence = TRIGGERS[suggestion.id](facts, suggestion)
        if evidence:
            found.append(
                (suggestion, Candidate(suggestion.id, suggestion.guidance, tuple(evidence)))
            )
    found.sort(key=lambda pair: (GROUP_ORDER[pair[0].group], pair[0].priority))
    last = [candidate for _, candidate in found if candidate.id == ALWAYS_LAST]
    others = [candidate for _, candidate in found if candidate.id != ALWAYS_LAST]
    return others[: MAX_CANDIDATES - len(last)] + last


def facts_for_llm(facts: SessionFacts) -> dict[str, Any]:
    """The facts the model may see. The safety-flag codes never reach it; when a red flag
    fires it is only told that a notice exists (and is not given the pain score)."""
    data = facts.model_dump(mode="json")
    data["flags"].pop("safety_flags", None)
    flagged = bool(red_flags(facts))
    data["safety_notice_present"] = flagged
    if flagged and data.get("self_report"):
        data["self_report"].pop("pain_0_10", None)
    return data
