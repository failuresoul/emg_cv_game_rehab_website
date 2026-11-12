"""Builds the prompt from the versioned files in prompts/: the system rules, the user template
and the hand-written examples in prompts/fewshot/. Compact JSON throughout: small models with a
4096-token context."""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.feedback.names import FeedbackLanguage
from app.feedback.rules import Candidate, candidates, facts_for_llm
from app.schemas.metrics import SessionFacts

PROMPT_VERSION = "v1"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
FEWSHOT_DIR = PROMPTS_DIR / "fewshot"

LANGUAGE_NAMES: dict[FeedbackLanguage, str] = {
    "en": "English",
    "bn": "Bangla, in Bengali script",
}
#: Never sent to the model: it has no use for them (the language is given on its own).
HIDDEN_FIELDS = ("session_id", "patient_code", "language", "affected_side")


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@lru_cache(maxsize=4)
def _read(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


def system_prompt(version: str = PROMPT_VERSION) -> str:
    return _read(f"system_{version}.txt")


def _prune(value: Any) -> Any:
    """Without nulls and empty lists or objects: fewer tokens, nothing lost."""
    if isinstance(value, dict):
        pruned = {key: _prune(item) for key, item in value.items()}
        return {key: item for key, item in pruned.items() if item not in (None, [], {})}
    if isinstance(value, list):
        return [_prune(item) for item in value]
    return value


def facts_seen(facts: SessionFacts) -> dict[str, Any]:
    """What the model is shown of the facts: rules.facts_for_llm, without the ids and the
    empty fields. Numbers in the report must come from here."""
    data = facts_for_llm(facts)
    for name in HIDDEN_FIELDS:
        data.pop(name, None)
    pruned: dict[str, Any] = _prune(data)
    # Always present, even when false.
    pruned["safety_notice_present"] = data["safety_notice_present"]
    pruned["baseline_available"] = data["baseline_available"]
    return pruned


def candidates_seen(found: list[Candidate]) -> list[dict[str, str]]:
    return [{"id": candidate.id, "guidance": candidate.guidance} for candidate in found]


@dataclass(frozen=True)
class Example:
    name: str
    facts: SessionFacts
    report: dict[str, Any]


@lru_cache(maxsize=1)
def examples() -> tuple[Example, ...]:
    found = []
    for path in sorted(FEWSHOT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        found.append(
            Example(path.stem, SessionFacts.model_validate(data["facts"]), data["report"])
        )
    return tuple(found)


def _examples_text() -> str:
    blocks = []
    for number, example in enumerate(examples(), start=1):
        blocks.append(
            f"EXAMPLE {number} (another session, only to show the style)\n"
            f"LANGUAGE: English\n"
            f"SAFETY_NOTICE_PRESENT: {str(facts_seen(example.facts)['safety_notice_present']).lower()}\n"
            f"SESSION_FACTS: {compact(facts_seen(example.facts))}\n"
            # Ids only, to save tokens; the real session gets each suggestion's guidance.
            f"CANDIDATE_SUGGESTIONS: {compact([c.id for c in candidates(example.facts)])}\n"
            f"ANSWER: {compact(example.report)}"
        )
    return "\n\n".join(blocks)


def user_prompt(
    seen: dict[str, Any],
    found: list[Candidate],
    language: FeedbackLanguage,
    version: str = PROMPT_VERSION,
) -> str:
    replacements = {
        "{{EXAMPLES}}": _examples_text(),
        "{{LANGUAGE}}": LANGUAGE_NAMES[language],
        "{{SAFETY_NOTICE_PRESENT}}": str(bool(seen["safety_notice_present"])).lower(),
        "{{SESSION_FACTS}}": compact(seen),
        "{{CANDIDATE_SUGGESTIONS}}": compact(candidates_seen(found)),
    }
    text = _read(f"user_{version}.txt")
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
    return text


def retry_prompt(user: str, errors: list[str]) -> str:
    """The same request, with the problems of the last answer to fix."""
    listed = "\n".join(f"- {error}" for error in errors[:12])
    return (
        f"{user}\n\nYour last answer had these problems:\n{listed}\n"
        "Write the whole JSON report again, fixing every problem."
    )
