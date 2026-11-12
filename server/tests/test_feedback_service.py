"""app/feedback/service.py and fallback.py with the model mocked: retries, the fallback, and
safety notices that are always the fixed text."""

import json
from typing import Any

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.feedback import cli, prompt
from app.feedback.fallback import build_fallback
from app.feedback.llm import LLMResponseError, LLMTimeoutError, LLMUnavailableError, MockProvider
from app.feedback.rules import candidates, red_flags
from app.feedback.service import MAX_RETRIES, generate_report, generate_report_from_facts
from app.feedback.validate import LEAKAGE_WORDS, validate
from app.schemas.metrics import SessionFacts
from tests.feedback_factories import GOOD_ANSWER, random_facts
from tests.test_feedback_rules import make_facts
from tests.test_session_facts import facts_session

BAD_NUMBER = GOOD_ANSWER | {"patient_summary": "You reached 37 targets today."}
LEAKING = GOOD_ANSWER | {
    "patient_summary": "Thank you for session 6. Because of the pain, please call your doctor.",
    "therapist_summary": "Session 6. G1 similar. Pain flag.",
}


def stop_notice(language: str = "en") -> str:
    data = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    return str(data["notices"]["stop"][language])


def pain_facts() -> SessionFacts:
    return make_facts(
        flags=make_facts().flags.model_copy(update={"safety_flags": ["pain"]}),
        safety_notice_present=True,
    )


def all_text(result: Any) -> str:
    report = result.report
    return " ".join(
        [
            report.patient_summary,
            report.next_session_text,
            report.therapist_summary,
            *[item.text for item in report.highlights],
            *[item.text for item in report.suggestions],
        ]
    )


def test_a_good_answer_is_used_as_it_is() -> None:
    provider = MockProvider(answers=[GOOD_ANSWER], model="qwen3.5:4b")
    result = generate_report_from_facts(make_facts(), provider=provider)
    assert result.report.model_dump() == GOOD_ANSWER
    assert result.safety_notices == []
    meta = result.meta
    assert (meta.model, meta.prompt_version, meta.retries, meta.fallback_used) == (
        "qwen3.5:4b", "v1", 0, False,
    )  # fmt: skip
    assert meta.validation_errors == [] and meta.provider_error is None
    assert meta.prompt_tokens > 0 and meta.output_tokens > 0
    [call] = provider.calls
    assert call["system"] == prompt.system_prompt()
    assert call["json_schema"]["properties"]["suggestions"]["items"]["properties"]["id"]["enum"] == [
        "STEADY_EFFORT", "NEXT_FOCUS",
    ]  # fmt: skip


def test_a_failed_answer_is_retried_with_its_errors() -> None:
    provider = MockProvider(answers=[BAD_NUMBER, GOOD_ANSWER])
    result = generate_report_from_facts(make_facts(), provider=provider, model="phi4-mini")
    assert result.report.model_dump() == GOOD_ANSWER
    assert result.meta.retries == 1 and not result.meta.fallback_used
    assert result.meta.model == "phi4-mini"
    [errors] = result.meta.validation_errors
    assert any("37" in error for error in errors)
    first, second = provider.calls
    assert "problems" not in first["user"]
    assert second["user"].startswith(first["user"])
    assert "Your last answer had these problems:" in second["user"] and "37" in second["user"]
    assert second["model"] == "phi4-mini"


def test_two_failed_retries_use_the_template() -> None:
    provider = MockProvider(answers=[BAD_NUMBER, "not json", BAD_NUMBER])
    facts = make_facts()
    result = generate_report_from_facts(facts, provider=provider)
    assert len(provider.calls) == 1 + MAX_RETRIES
    assert result.meta.fallback_used and result.meta.retries == 2
    assert len(result.meta.validation_errors) == 3
    assert result.meta.validation_errors[1] == [
        "The answer is not valid JSON. Output only the JSON object."
    ]
    seen = prompt.facts_seen(facts)
    assert validate(result.report, seen, facts, candidates(facts), red_flags(facts), "en") == []


def test_an_unreadable_answer_counts_as_a_failure() -> None:
    class Flaky(MockProvider):
        def generate(self, *args: Any, **kwargs: Any) -> Any:
            if not self.calls:
                self.calls.append({})
                raise LLMResponseError("The model's answer is not valid JSON")
            return super().generate(*args, **kwargs)

    result = generate_report_from_facts(make_facts(), provider=Flaky(answers=[GOOD_ANSWER]))
    assert not result.meta.fallback_used and result.meta.retries == 1
    assert "could not be read" in result.meta.validation_errors[0][0]


@pytest.mark.parametrize(
    "error", [LLMUnavailableError("Is the Ollama app running?"), LLMTimeoutError("too slow")]
)
def test_no_model_means_the_template_at_once(error: Exception) -> None:
    provider = MockProvider(fail_with=error)  # type: ignore[arg-type]
    result = generate_report_from_facts(make_facts(), provider=provider)
    assert len(provider.calls) == 1
    assert result.meta.fallback_used and result.meta.retries == 0
    assert result.meta.provider_error == str(error)


def test_red_flag_sessions_never_contain_model_written_safety_text() -> None:
    facts = pain_facts()
    provider = MockProvider(answers=[LEAKING])
    result = generate_report_from_facts(facts, provider=provider)
    # Every answer leaked, so the template was used; the notice is the fixed text.
    assert result.meta.fallback_used
    assert result.safety_notices == [stop_notice()]
    assert not LEAKAGE_WORDS.search(all_text(result))
    assert stop_notice() not in all_text(result)
    # The model was told only that a notice exists.
    for call in provider.calls:
        assert "SAFETY_NOTICE_PRESENT: true" in call["user"]
        real = call["user"].split("Now the real session.")[1]
        assert "pain_0_10" not in real and "safety_flags" not in real
        assert stop_notice() not in call["user"]


def test_a_clean_answer_under_a_red_flag_is_kept_with_the_fixed_notice() -> None:
    clean = GOOD_ANSWER | {"therapist_summary": "Session 6. G1 similar: 1 -> 1 share (0.3 MDC)."}
    result = generate_report_from_facts(pain_facts(), provider=MockProvider(answers=[clean]))
    assert not result.meta.fallback_used
    assert result.safety_notices == [stop_notice()]


def test_the_notice_is_in_the_report_language() -> None:
    facts = pain_facts()
    result = generate_report_from_facts(facts, language="bn", provider=MockProvider())
    assert result.safety_notices == [stop_notice("bn")]
    assert result.report.language == "bn"


@pytest.mark.parametrize("seed", range(20))
def test_the_template_always_passes_the_validator(seed: int) -> None:
    facts = random_facts(seed)
    seen = prompt.facts_seen(facts)
    found = candidates(facts)
    flags = red_flags(facts)
    for language in ("en", "bn"):
        report = build_fallback(facts, seen, found, flags, language)  # type: ignore[arg-type]
        errors = validate(report, seen, facts, found, flags, language)  # type: ignore[arg-type]
        assert errors == [], (seed, language, report.model_dump(), errors)
        if flags:
            assert not LEAKAGE_WORDS.search(report.model_dump_json())


def test_the_random_facts_cover_every_kind_of_session() -> None:
    every = [random_facts(seed) for seed in range(20)]
    assert any(red_flags(facts) for facts in every)
    assert any(not facts.baseline_available for facts in every)
    assert any(facts.next_session is None for facts in every)
    statuses = {metric.mdc_status for facts in every for metric in facts.metrics}
    assert statuses == {"improved", "worse", "no_detectable_change", "no_baseline"}


def test_the_template_for_a_first_session_makes_no_comparison() -> None:
    facts = make_facts(baseline_available=False, session_no=1, metrics=[])
    report = build_fallback(facts, prompt.facts_seen(facts), candidates(facts), [], "en")
    assert report.highlights == []
    assert "not enough history yet" in report.patient_summary
    assert [item.id for item in report.suggestions] == ["FIRST_SESSIONS"]


# A stored session


def test_generate_report_for_a_stored_session(session: Session, patient_headers: Any) -> None:
    record = facts_session(session)
    assert record.id is not None
    provider = MockProvider()  # Its canned answer is not a report: the template is used.
    result = generate_report(record.id, db=session, provider=provider)
    assert result.meta.fallback_used and len(provider.calls) == 1 + MAX_RETRIES
    # The session raised a pain flag.
    assert result.safety_notices == [stop_notice()]
    assert "P001" not in provider.calls[0]["user"].split("Now the real session.")[1]
    with pytest.raises(LookupError):
        generate_report(999_999, db=session, provider=provider)


def test_the_cli_prints_the_report_as_json(
    session: Session,
    patient_headers: Any,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    record = facts_session(session)
    calls: list[tuple[Any, ...]] = []

    def fake_generate(session_id: int, language: str, model: str | None) -> Any:
        calls.append((session_id, language, model))
        return generate_report(session_id, language, model, db=session, provider=MockProvider())  # type: ignore[arg-type]

    monkeypatch.setattr(cli, "generate_report", fake_generate)
    assert cli.main([str(record.id), "--model", "phi4-mini", "--language", "bn"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert set(printed) == {"report", "safety_notices", "meta"}
    assert printed["report"]["language"] == "bn"
    assert calls == [(record.id, "bn", "phi4-mini")]
