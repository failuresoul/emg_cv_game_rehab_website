"""Generates a session's feedback report safely.

facts (session_facts.build_facts) -> candidates and red flags (rules) -> prompt -> provider ->
parse -> validate. A failed answer is retried up to twice with its errors appended; after that,
or when the model cannot be reached, the template report (fallback) is used. Safety notices are
returned separately, always as the fixed approved text.

Bangla reports follow LLM_BN_STRATEGY:
- "direct": the model writes the patient text in Bangla (the therapist summary stays English);
- "translate": an English report is written and validated first, then a second call translates
  only the patient text, which is validated again (its numbers must not change);
- "template": the Bangla template report, without the model.
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.feedback import prompt
from app.feedback.fallback import build_fallback
from app.feedback.llm import (
    LLMProvider,
    LLMResponseError,
    LLMTimeoutError,
    LLMUnavailableError,
    get_provider,
)
from app.feedback.names import FeedbackLanguage
from app.feedback.rules import Candidate, RedFlag, candidates, notice_texts, red_flags
from app.feedback.schemas import Report, report_json_schema
from app.feedback.validate import numbers_in, validate
from app.models import Session as SessionRecord
from app.schemas.metrics import SessionFacts
from app.services.session_facts import build_facts

#: Retries after the first answer fails validation (per stage).
MAX_RETRIES = 2

BanglaStrategy = Literal["direct", "translate", "template"]
BANGLA_STRATEGIES: tuple[BanglaStrategy, ...] = ("direct", "translate", "template")
#: The patient's text: what the "translate" strategy translates.
PATIENT_FIELDS = ("patient_summary", "highlights", "suggestions", "next_session_text")


class ReportMeta(BaseModel):
    #: The model that answered (or was asked, when none answered).
    model: str | None
    prompt_version: str
    #: Summed over every call.
    latency_ms: float
    prompt_tokens: int
    output_tokens: int
    #: Calls after the first.
    retries: int
    fallback_used: bool
    #: Each failed answer's errors, in order.
    validation_errors: list[list[str]]
    #: Why the model could not be used at all (not running, too slow), if so.
    provider_error: str | None = None
    #: How a Bangla report was made ("direct", "translate" or "template"); "direct" for English.
    strategy: BanglaStrategy = "direct"


class ReportResult(BaseModel):
    report: Report
    #: The fixed safety notices to show with the report; never written by the model.
    safety_notices: list[str]
    meta: ReportMeta
    #: For storage only (never in the API's answers): the candidates the model was given, and
    #: every answer it wrote, attempt by attempt.
    candidates: list[dict[str, Any]] = Field(default_factory=list, exclude=True)
    raw_output: str | None = Field(default=None, exclude=True)


@dataclass
class _Run:
    """What every call of one report adds up to."""

    provider: LLMProvider
    model: str | None
    deadline_s: float | None
    started: float = field(default_factory=time.monotonic)
    used_model: str | None = None
    latency: float = 0.0
    prompt_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    failures: list[list[str]] = field(default_factory=list)
    answers: list[str] = field(default_factory=list)
    provider_error: str | None = None
    #: The model cannot be used again in this report (down, too slow, out of time).
    stopped: bool = False

    def attempts(
        self,
        stage: str,
        system: str,
        user: str,
        schema: dict[str, Any],
        check: Callable[[str], list[str]],
    ) -> str | None:
        """Up to 1 + MAX_RETRIES answers, each retried with the last one's errors; the first
        answer `check` accepts, or None."""
        stage_failures: list[list[str]] = []
        for _ in range(1 + MAX_RETRIES):
            if self.stopped:
                return None
            request = prompt.retry_prompt(user, stage_failures[-1]) if stage_failures else user
            limit: dict[str, float] = {}
            if self.deadline_s is not None:
                left = self.deadline_s - (time.monotonic() - self.started)
                if left < 1:
                    self.provider_error = f"No valid report within {self.deadline_s:g} s"
                    self.stopped = True
                    return None
                limit["timeout_s"] = left
            self.calls += 1
            try:
                result = self.provider.generate(system, request, schema, model=self.model, **limit)
            except (LLMUnavailableError, LLMTimeoutError) as error:
                # Asking again would only wait again: use the template now.
                self.provider_error = str(error)
                self.stopped = True
                return None
            except LLMResponseError as error:
                errors = [f"The answer could not be read: {error}"]
            else:
                self.answers.append(f"--- {stage} attempt {len(stage_failures) + 1} ---\n{result.text}")
                self.used_model = result.model or self.used_model
                self.latency += result.latency_ms
                self.prompt_tokens += result.prompt_tokens or 0
                self.output_tokens += result.output_tokens or 0
                errors = check(result.text)
                if not errors:
                    return result.text
            stage_failures.append(errors)
            self.failures.append(errors if stage == "report" else [f"{stage}: {e}" for e in errors])
        return None


def translation_errors(english: Report, answer: str) -> list[str]:
    """The translation keeps the English report's ids, in order, and every number of every
    patient text (Bengali digits count as the same numbers)."""
    try:
        data = json.loads(answer)
    except ValueError:
        return ["The answer is not valid JSON. Output only the JSON object."]
    if not isinstance(data, dict):
        return ["The answer must be a JSON object."]
    errors: list[str] = []

    def items(name: str) -> list[dict[str, Any]]:
        value = data.get(name)
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    pairs: list[tuple[str, str, Any]] = [
        ("patient_summary", english.patient_summary, data.get("patient_summary")),
        ("next_session_text", english.next_session_text, data.get("next_session_text")),
    ]
    for name, key, originals in (
        ("highlights", "metric_id", [(h.metric_id, h.text) for h in english.highlights]),
        ("suggestions", "id", [(s.id, s.text) for s in english.suggestions]),
    ):
        translated = items(name)
        if [item.get(key) for item in translated] != [ident for ident, _ in originals]:
            errors.append(
                f"{name}: keep the same items in the same order "
                f"({', '.join(ident for ident, _ in originals) or 'none'})."
            )
            continue
        pairs += [
            (f"{name}[{index}].text", text, item.get("text"))
            for index, ((_, text), item) in enumerate(zip(originals, translated, strict=True))
        ]
    for name, original, translated in pairs:
        if not isinstance(translated, str):
            continue  # The validator reports a missing text.
        wanted, found = sorted(numbers_in(original)), sorted(numbers_in(translated))
        if wanted != found:
            errors.append(
                f"{name}: the numbers must stay exactly as in the English text "
                f"({', '.join(f'{n:g}' for n in wanted) or 'none'})."
            )
    return errors


def _english_report(
    run: _Run,
    facts: SessionFacts,
    seen: dict[str, Any],
    found: list[Candidate],
    prompt_version: str,
) -> Report | None:
    flags = red_flags(facts, "en")
    text = run.attempts(
        "report",
        prompt.system_prompt(prompt_version),
        prompt.user_prompt(seen, found, "en", prompt_version),
        report_json_schema("en", [c.id for c in found], [m.id for m in facts.metrics]),
        lambda answer: validate(answer, seen, facts, found, flags, "en"),
    )
    return Report.model_validate_json(text) if text is not None else None


def _translate(
    run: _Run,
    english: Report,
    facts: SessionFacts,
    seen: dict[str, Any],
    found: list[Candidate],
    flags: list[RedFlag],
) -> Report | None:
    """The English report's patient text in Bangla; the therapist summary stays English."""
    source = english.model_dump(include=set(PATIENT_FIELDS))
    user = prompt.translate_user_prompt(source)

    def merged(answer: str) -> dict[str, Any]:
        data = json.loads(answer)
        data["language"] = "bn"
        data["therapist_summary"] = english.therapist_summary
        return cast(dict[str, Any], data)

    def check(answer: str) -> list[str]:
        errors = translation_errors(english, answer)
        if errors:
            return errors
        return validate(merged(answer), seen, facts, found, flags, "bn")

    text = run.attempts(
        "translation",
        prompt.translate_system_prompt(),
        user,
        report_json_schema("bn", [c.id for c in found], [m.id for m in facts.metrics]),
        check,
    )
    return Report.model_validate(merged(text)) if text is not None else None


def generate_report_from_facts(
    facts: SessionFacts,
    language: FeedbackLanguage = "en",
    model: str | None = None,
    provider: LLMProvider | None = None,
    prompt_version: str = prompt.PROMPT_VERSION,
    deadline_s: float | None = None,
    bn_strategy: BanglaStrategy | None = None,
) -> ReportResult:
    """`deadline_s` limits all attempts together: each call gets the time left, and when none
    is left the template is used. `bn_strategy` overrides LLM_BN_STRATEGY."""
    provider = provider or get_provider()
    strategy: BanglaStrategy = (
        (bn_strategy or cast(BanglaStrategy, settings.LLM_BN_STRATEGY)) if language == "bn" else "direct"
    )
    if strategy not in BANGLA_STRATEGIES:
        raise ValueError(f"Unknown LLM_BN_STRATEGY {strategy!r}: use {', '.join(BANGLA_STRATEGIES)}")
    run = _Run(provider=provider, model=model, deadline_s=deadline_s)
    run.used_model = model or getattr(provider, "model", None)
    found = candidates(facts)
    flags = red_flags(facts, language)
    seen = prompt.facts_seen(facts)

    report: Report | None = None
    if strategy == "direct":
        text = run.attempts(
            "report",
            prompt.system_prompt(prompt_version),
            prompt.user_prompt(seen, found, language, prompt_version),
            report_json_schema(language, [c.id for c in found], [m.id for m in facts.metrics]),
            lambda answer: validate(answer, seen, facts, found, flags, language),
        )
        report = Report.model_validate_json(text) if text is not None else None
    elif strategy == "translate":
        english = _english_report(run, facts, seen, found, prompt_version)
        if english is not None:
            report = _translate(run, english, facts, seen, found, flags)

    fallback_used = report is None
    if report is None:
        report = build_fallback(facts, seen, found, flags, language)

    return ReportResult(
        report=report,
        safety_notices=notice_texts(flags),
        meta=ReportMeta(
            model=run.used_model,
            prompt_version=prompt_version,
            latency_ms=round(run.latency, 1),
            prompt_tokens=run.prompt_tokens,
            output_tokens=run.output_tokens,
            retries=max(0, run.calls - 1),
            fallback_used=fallback_used,
            validation_errors=run.failures,
            provider_error=run.provider_error,
            strategy=strategy,
        ),
        candidates=[candidate.as_dict() for candidate in found],
        raw_output="\n\n".join(run.answers) or None,
    )


def generate_report(
    session_id: int,
    language: FeedbackLanguage = "en",
    model: str | None = None,
    *,
    db: Session | None = None,
    provider: LLMProvider | None = None,
) -> ReportResult:
    """The report for a stored session. Who may see it is checked by the API, not here."""
    if db is None:
        with Session(engine) as owned:
            return generate_report(session_id, language, model, db=owned, provider=provider)
    record = db.get(SessionRecord, session_id)
    if record is None:
        raise LookupError(f"There is no session {session_id}.")
    return generate_report_from_facts(build_facts(db, record), language, model, provider)


def as_json(result: ReportResult) -> dict[str, Any]:
    return result.model_dump(mode="json")
