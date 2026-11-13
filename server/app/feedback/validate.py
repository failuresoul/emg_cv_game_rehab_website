"""Checks every report before anyone sees it. `validate` returns a list of plain-English errors
(empty when the report is fine); the service gives them back to the model on a retry.

Checks: the schema and word limits; every number comes from the facts; suggestion ids come from
the candidates; improved and worse words match each measure's mdc_status; no banned words; no
safety text when a notice is shown (the notice is fixed text, never the model's); short patient
sentences; the right script for the language.
"""

import json
import re
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.feedback.names import MENTIONS, FeedbackLanguage
from app.feedback.rules import Candidate, RedFlag
from app.feedback.schemas import WORD_LIMITS, Report
from app.schemas.metrics import SessionFacts
from app.services.metrics_catalog import get_metric

FEEDBACK_DIR = Path(__file__).resolve().parent
#: The banned words in English, then in Bangla; both lists apply to every text.
BANNED_PATHS = (FEEDBACK_DIR / "banned.txt", FEEDBACK_DIR / "banned_bn.txt")

#: A number in a text and a fact match when this close.
NUMBER_TOLERANCE = 0.011
MAX_AVERAGE_SENTENCE_WORDS = 18
#: Bangla text must have at least this share of its letters in the Bengali block.
MIN_BENGALI_SHARE = 0.6
#: English text must have at least this share of Latin letters.
MIN_LATIN_SHARE = 0.9

IMPROVE_WORDS: dict[FeedbackLanguage, re.Pattern[str]] = {
    "en": re.compile(
        r"\b(improv\w*|better|faster|quicker|smoother|increas\w*|progress\w*|gain\w*)\b",
        re.IGNORECASE,
    ),
    "bn": re.compile(r"উন্নতি|উন্নত|আরও ভালো"),
}
WORSE_WORDS: dict[FeedbackLanguage, re.Pattern[str]] = {
    "en": re.compile(
        r"\b(worse|worsen\w*|declin\w*|deteriorat\w*|slower|decreas\w*|dropped|poorer|weaker)\b",
        re.IGNORECASE,
    ),
    "bn": re.compile(r"খারাপ|অবনতি"),
}
#: Words that would repeat or replace the fixed safety notice. Not allowed when one is shown.
LEAKAGE_WORDS = re.compile(
    # Whole words: "pain" must not catch the game Paint the wall (paint_wall).
    r"\b(pain|pains|painful|painfully|hurt|hurts|hurting|ache|aches|aching|sore|soreness|"
    r"symptom\w*|doctor\w*|physician\w*|GP|"
    r"emergenc\w*|hospital\w*|ambulance|medical|stop practi[sc]ing|tell your therapist|"
    r"contact your therapist|seek help|weakness|numbness|drooping)\b"
    r"|ব্যথা|উপসর্গ|ডাক্তার|চিকিৎসক|জরুরি|হাসপাতাল|থেরাপিস্টকে জানান",
    re.IGNORECASE,
)

_BANGLA_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
# "3/10" and "4/5" are scale answers: the denominator is not a fact.
_SCALE_DENOMINATOR = re.compile(r"(?<=\d)\s*/\s*(?:10|5)(?!\d|\.\d)")
# A number not part of an id such as K6 or sw2.
_NUMBER = re.compile(r"(?<![A-Za-z_\d.])(\d+(?:\.\d+)?)(?![\d]|\.\d)")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_CLAUSES = re.compile(r"[.!?।;:,]|\band\b|\bbut\b|\bwhile\b|\bwhereas\b|এবং|কিন্তু|আর ")
_SENTENCES = re.compile(r"[.!?।]+")


# Text helpers


def words(text: str) -> int:
    return len(text.split())


def numbers_in(text: str) -> list[float]:
    text = _THOUSANDS.sub("", text.translate(_BANGLA_DIGITS))
    text = _SCALE_DENOMINATOR.sub("", text)
    return [float(match) for match in _NUMBER.findall(text)]


def fact_numbers(value: Any) -> Iterator[float]:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, int | float):
        yield float(value)
    elif isinstance(value, dict):
        for item in value.values():
            yield from fact_numbers(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from fact_numbers(item)


def number_is_known(number: float, known: list[float]) -> bool:
    """Equal to a fact within 0.011, also as a percentage (x100) or rounded to 0-2 decimals."""
    for value in known:
        for form in (abs(value), abs(value) * 100):
            if abs(number - form) <= NUMBER_TOLERANCE:
                return True
            if any(abs(number - round(form, places)) <= NUMBER_TOLERANCE for places in (0, 1, 2)):
                return True
    return False


@lru_cache(maxsize=1)
def banned_patterns() -> tuple[tuple[str, re.Pattern[str]], ...]:
    found: list[tuple[str, re.Pattern[str]]] = []
    lines = [line for path in BANNED_PATHS for line in path.read_text(encoding="utf-8").splitlines()]
    for line in lines:
        phrase = line.strip()
        if not phrase or phrase.startswith("#"):
            continue
        if not phrase.isascii():
            # Bangla words take endings, so a Bangla entry matches anywhere in the text.
            found.append((phrase, re.compile(re.escape(phrase))))
            continue
        stem = phrase.rstrip("*")
        body = re.escape(stem).replace(r"\ ", r"\s+") + (r"\w*" if phrase.endswith("*") else "")
        found.append((phrase, re.compile(rf"(?<!\w){body}(?!\w)", re.IGNORECASE)))
    return tuple(found)


def mention_patterns(metric_id: str, language: FeedbackLanguage) -> list[re.Pattern[str]]:
    patterns = [re.compile(rf"(?<![A-Za-z\d]){re.escape(metric_id)}(?![A-Za-z\d])")]
    names = list(MENTIONS[language].get(metric_id, ()))
    metric = get_metric(metric_id)
    if metric is not None and language == "en":
        names.append(metric.name.split(":")[0].split("(")[0].strip())
    for name in names:
        if name.isascii():
            patterns.append(re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE))
        else:
            patterns.append(re.compile(re.escape(name)))
    return patterns


def _statuses(facts: SessionFacts) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for metric in facts.metrics:
        found.setdefault(metric.id, set()).add(metric.mdc_status)
    return found


# The checks


def _direction_errors(
    field: str, text: str, language: FeedbackLanguage, statuses: dict[str, set[str]]
) -> list[str]:
    errors: list[str] = []
    patterns = {metric_id: mention_patterns(metric_id, language) for metric_id in statuses}
    for clause in _CLAUSES.split(text):
        mentioned = [
            metric_id
            for metric_id, found in patterns.items()
            if any(pattern.search(clause) for pattern in found)
        ]
        if not mentioned:
            continue
        said = set().union(*(statuses[metric_id] for metric_id in mentioned))
        for words_, needed, label in (
            (IMPROVE_WORDS[language], "improved", "an improvement"),
            (WORSE_WORDS[language], "worse", "a worsening"),
        ):
            match = words_.search(clause)
            if match and needed not in said:
                errors.append(
                    f'{field}: "{match.group(0)}" describes {label} of '
                    f"{', '.join(mentioned)}, but its mdc_status is "
                    f"{', '.join(sorted(said))}. Say it was similar or steady."
                )
    return errors


def _script_error(field: str, text: str, language: FeedbackLanguage) -> str | None:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return None
    bengali = sum(1 for char in letters if "ঀ" <= char <= "৿") / len(letters)
    latin = sum(1 for char in letters if char.isascii()) / len(letters)
    if language == "bn" and bengali < MIN_BENGALI_SHARE:
        return f"{field}: must be written in Bangla (Bengali script)."
    if language == "en" and latin < MIN_LATIN_SHARE:
        return f"{field}: must be written in English."
    return None


def text_fields(report: Report) -> list[tuple[str, str, bool]]:
    """Each text as (field, text, is_patient_text)."""
    fields = [("patient_summary", report.patient_summary, True)]
    fields += [
        (f"highlights[{index}].text", item.text, True)
        for index, item in enumerate(report.highlights)
    ]
    fields += [
        (f"suggestions[{index}].text", item.text, True)
        for index, item in enumerate(report.suggestions)
    ]
    fields += [
        ("next_session_text", report.next_session_text, True),
        ("therapist_summary", report.therapist_summary, False),
    ]
    return fields


def parse(answer: str | dict[str, Any]) -> tuple[Report | None, list[str]]:
    try:
        data = json.loads(answer) if isinstance(answer, str) else answer
    except ValueError:
        return None, ["The answer is not valid JSON. Output only the JSON object."]
    try:
        return Report.model_validate(data), []
    except ValidationError as error:
        return None, [
            f"{'.'.join(str(part) for part in item['loc']) or 'report'}: {item['msg']}"
            for item in error.errors()
        ]


def validate(
    answer: str | dict[str, Any] | Report,
    facts_seen: dict[str, Any],
    facts: SessionFacts,
    candidates: list[Candidate],
    red_flags: list[RedFlag],
    language: FeedbackLanguage,
) -> list[str]:
    """Every problem with a report; empty when it may be shown.

    `facts_seen` is what the model was given (rules.facts_for_llm): numbers must come from it.
    """
    if isinstance(answer, Report):
        report, errors = answer, []
    else:
        report, errors = parse(answer)
    if report is None:
        return errors

    if report.language != language:
        errors.append(f'language: must be "{language}".')

    # Ids
    candidate_ids = [candidate.id for candidate in candidates]
    chosen = [item.id for item in report.suggestions]
    for suggestion_id in chosen:
        if suggestion_id not in candidate_ids:
            errors.append(
                f"suggestions: {suggestion_id} is not in CANDIDATE_SUGGESTIONS "
                f"({', '.join(candidate_ids) or 'none'})."
            )
    if len(set(chosen)) != len(chosen):
        errors.append("suggestions: each id may be used once.")
    if candidate_ids and not chosen:
        errors.append("suggestions: choose 1 to 3 from CANDIDATE_SUGGESTIONS.")
    statuses = _statuses(facts)
    for index, highlight in enumerate(report.highlights):
        if highlight.metric_id not in statuses:
            errors.append(f"highlights[{index}].metric_id: {highlight.metric_id} is not in metrics.")

    known = list(fact_numbers(facts_seen))
    flagged = bool(red_flags)
    patient_sentences: list[int] = []
    for field, text, for_patient in text_fields(report):
        limit = WORD_LIMITS[re.sub(r"\[\d+\]", "", field)]
        if words(text) > limit:
            errors.append(f"{field}: {words(text)} words; at most {limit}.")

        for number in numbers_in(text):
            if not number_is_known(number, known):
                errors.append(
                    f"{field}: the number {number:g} is not in SESSION_FACTS. "
                    "Use only numbers given; never calculate new ones."
                )

        text_language: FeedbackLanguage = language if for_patient else "en"
        errors += _direction_errors(field, text, text_language, statuses)

        for phrase, pattern in banned_patterns():
            if pattern.search(text):
                errors.append(f'{field}: "{phrase.rstrip("*")}" is not allowed.')

        if flagged:
            for leak in dict.fromkeys(m.group(0) for m in LEAKAGE_WORDS.finditer(text)):
                errors.append(
                    f'{field}: "{leak}" is not allowed. The app shows its own safety '
                    "notice; do not mention pain, symptoms, doctors or emergencies."
                )

        script = _script_error(field, text, text_language)
        if script:
            errors.append(script)

        if for_patient:
            patient_sentences += [words(part) for part in _SENTENCES.split(text) if part.strip()]

    # A highlight's direction must match its own measure, named or not.
    for index, highlight in enumerate(report.highlights):
        said = statuses.get(highlight.metric_id, set())
        if IMPROVE_WORDS[language].search(highlight.text) and "improved" not in said:
            errors.append(
                f"highlights[{index}].text: {highlight.metric_id} did not improve "
                f"(mdc_status {', '.join(sorted(said)) or 'unknown'})."
            )
        if WORSE_WORDS[language].search(highlight.text) and "worse" not in said:
            errors.append(
                f"highlights[{index}].text: {highlight.metric_id} did not get worse "
                f"(mdc_status {', '.join(sorted(said)) or 'unknown'})."
            )

    if patient_sentences:
        average = sum(patient_sentences) / len(patient_sentences)
        if average > MAX_AVERAGE_SENTENCE_WORDS:
            errors.append(
                f"Patient text: sentences average {average:.0f} words; keep them under "
                f"{MAX_AVERAGE_SENTENCE_WORDS}."
            )
    return list(dict.fromkeys(errors))
