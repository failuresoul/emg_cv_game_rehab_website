"""Generates a session's feedback report safely.

facts (session_facts.build_facts) -> candidates and red flags (rules) -> prompt -> provider ->
parse -> validate. A failed answer is retried up to twice with its errors appended; after that,
or when the model cannot be reached, the template report (fallback) is used. Safety notices are
returned separately, always as the fixed approved text.
"""

from typing import Any

from pydantic import BaseModel
from sqlmodel import Session

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
from app.feedback.rules import candidates, notice_texts, red_flags
from app.feedback.schemas import Report, report_json_schema
from app.feedback.validate import validate
from app.models import Session as SessionRecord
from app.schemas.metrics import SessionFacts
from app.services.session_facts import build_facts

#: Retries after the first answer fails validation.
MAX_RETRIES = 2


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


class ReportResult(BaseModel):
    report: Report
    #: The fixed safety notices to show with the report; never written by the model.
    safety_notices: list[str]
    meta: ReportMeta


def generate_report_from_facts(
    facts: SessionFacts,
    language: FeedbackLanguage = "en",
    model: str | None = None,
    provider: LLMProvider | None = None,
    prompt_version: str = prompt.PROMPT_VERSION,
) -> ReportResult:
    provider = provider or get_provider()
    found = candidates(facts)
    flags = red_flags(facts, language)
    seen = prompt.facts_seen(facts)
    system = prompt.system_prompt(prompt_version)
    user = prompt.user_prompt(seen, found, language, prompt_version)
    schema = report_json_schema(
        language, [candidate.id for candidate in found], [metric.id for metric in facts.metrics]
    )

    used_model = model or getattr(provider, "model", None)
    latency = 0.0
    prompt_tokens = output_tokens = calls = 0
    failures: list[list[str]] = []
    provider_error: str | None = None
    report: Report | None = None

    for _ in range(1 + MAX_RETRIES):
        request = prompt.retry_prompt(user, failures[-1]) if failures else user
        calls += 1
        try:
            result = provider.generate(system, request, schema, model=model)
        except (LLMUnavailableError, LLMTimeoutError) as error:
            # Asking again would only wait again: use the template now.
            provider_error = str(error)
            break
        except LLMResponseError as error:
            failures.append([f"The answer could not be read: {error}"])
            continue
        used_model = result.model or used_model
        latency += result.latency_ms
        prompt_tokens += result.prompt_tokens or 0
        output_tokens += result.output_tokens or 0
        errors = validate(result.text, seen, facts, found, flags, language)
        if not errors:
            report = Report.model_validate_json(result.text)
            break
        failures.append(errors)

    fallback_used = report is None
    if report is None:
        report = build_fallback(facts, seen, found, flags, language)

    return ReportResult(
        report=report,
        safety_notices=notice_texts(flags),
        meta=ReportMeta(
            model=used_model,
            prompt_version=prompt_version,
            latency_ms=round(latency, 1),
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            retries=max(0, calls - 1),
            fallback_used=fallback_used,
            validation_errors=failures,
            provider_error=provider_error,
        ),
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
