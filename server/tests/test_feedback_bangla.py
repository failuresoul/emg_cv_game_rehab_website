"""Bangla reports: content, the validator's Bangla checks and the three strategies (mocked)."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.core.config import settings
from app.feedback import prompt, rules
from app.feedback.fallback import build_fallback, templates
from app.feedback.llm import LLMUnavailableError, MockProvider
from app.feedback.rules import candidates, red_flags, tip
from app.feedback.service import generate_report_from_facts, translation_errors
from app.feedback.schemas import Report
from app.feedback.validate import numbers_in, validate
from app.schemas.metrics import SessionFacts
from tests.feedback_factories import GOOD_ANSWER, random_facts
from tests.test_feedback_rules import make_facts, metric

FEEDBACK = Path(rules.__file__).resolve().parent
REVIEW = "Needs review by a native speaker"


def check(answer: Any, facts: SessionFacts | None = None, language: str = "bn") -> list[str]:
    facts = facts or make_facts()
    return validate(
        answer,
        prompt.facts_seen(facts),
        facts,
        candidates(facts),
        red_flags(facts, language),  # type: ignore[arg-type]
        language,  # type: ignore[arg-type]
    )


#: A valid Bangla report for make_facts() (session 6, G1 steady, STEADY_EFFORT and NEXT_FOCUS).
BANGLA = {
    "language": "bn",
    "patient_summary": "সেশন ৬ শেষ করার জন্য ধন্যবাদ। আজ আপনার খেলার সাফল্য স্থির ছিল।",
    "highlights": [{"metric_id": "G1", "text": "খেলায় মোট সফলতার হার আগের মতোই ছিল।"}],
    "suggestions": [{"id": "STEADY_EFFORT", "text": "নিয়মিত অনুশীলন করে যাওয়াই আসল কথা।"}],
    "next_session_text": "পরের বার আপনি মুঠো করে ধরে রাখা অনুশীলন করবেন।",
    "therapist_summary": "Session 6. G1 similar: 1 -> 1 share (0.3 MDC).",
}


# Content


def test_every_bangla_file_is_marked_for_review() -> None:
    files = [
        *sorted((FEEDBACK / "kb" / "bn").glob("*.md")),
        FEEDBACK / "banned_bn.txt",
        FEEDBACK / "templates" / "bn.yaml",
    ]
    assert len(files) == 15
    for path in files:
        assert REVIEW in path.read_text(encoding="utf-8").splitlines()[0], path.name
    shared = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    assert REVIEW in shared["_review"]


def test_every_tip_has_a_bangla_version_without_the_review_note() -> None:
    for suggestion in rules.load_catalogue():
        text = tip(suggestion.id, "bn")
        assert text.startswith("# ") and REVIEW not in text and "<!--" not in text
        body = text.split("\n", 1)[1]
        assert sum("ঀ" <= c <= "৿" for c in body) > 0.6 * sum(c.isalpha() for c in body)


def test_the_bangla_safety_notices_are_fixed_text() -> None:
    shared = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    for notice in shared["notices"].values():
        assert notice["bn"] and notice["bn"] != notice["en"]
    facts = make_facts(flags=make_facts().flags.model_copy(update={"safety_flags": ["pain"]}))
    assert red_flags(facts, "bn")[0].text == shared["notices"]["stop"]["bn"]


def test_both_template_languages_have_every_sentence() -> None:
    assert set(templates("en")) == set(templates("bn"))
    assert "{n}" in templates("bn")["thanks"]


# The validator in Bangla


def test_bengali_digits_are_numbers() -> None:
    assert numbers_in("সেশন ১২, ৭৫% এবং ৩/১০") == [12, 75, 3]
    assert numbers_in("১.৫ সেকেন্ড") == [1.5]
    assert numbers_in("সেশন ১২ ও 12") == [12, 12]
    # A Bengali-digit number that is not in the facts is caught like any other.
    errors = check(BANGLA | {"patient_summary": "আপনি আজ ৩৭টি লক্ষ্যে পৌঁছেছেন।"})
    assert any("37 is not in SESSION_FACTS" in error for error in errors)
    assert check(BANGLA) == []


def test_the_bangla_script_check() -> None:
    english_text = BANGLA | {"patient_summary": "Thank you for session 6."}
    assert "patient_summary: must be written in Bangla (Bengali script)." in check(english_text)
    # A few English words (a game name) in Bangla text are fine; mostly English is not.
    mixed = BANGLA | {"next_session_text": "পরের বার আপনি Bloom খেলবেন এবং হাত খোলা অনুশীলন করবেন।"}
    assert check(mixed) == []
    # Bangla patient text in an English report is wrong too.
    assert any("must be written in English" in e for e in check(GOOD_ANSWER | {"patient_summary": BANGLA["patient_summary"]}, language="en"))


@pytest.mark.parametrize(
    "sentence",
    [
        "নিয়মিত ওষুধ খাবেন।",
        "এতে আপনি সম্পূর্ণ সুস্থ হয়ে যাবেন।",
        "আপনি অন্য রোগীদের চেয়ে ভালো করছেন।",
        "আমরা গ্যারান্টি দিচ্ছি।",
        "এটি রোগনির্ণয় নয়।",
        "অন্যদের তুলনায় আপনি এগিয়ে।",
    ],
)
def test_bangla_banned_words_are_caught(sentence: str) -> None:
    errors = check(BANGLA | {"patient_summary": f"সেশন ৬ শেষ। {sentence}"})
    assert any("is not allowed" in error for error in errors), errors


def test_bangla_safety_leaks_are_caught_under_a_notice() -> None:
    facts = make_facts(
        flags=make_facts().flags.model_copy(update={"safety_flags": ["pain"]}),
        safety_notice_present=True,
    )
    leaking = BANGLA | {"patient_summary": "ব্যথা থাকলে ডাক্তার দেখান।", "therapist_summary": "Session 6."}
    errors = check(leaking, facts)
    assert any('"ব্যথা" is not allowed' in e for e in errors)
    assert any('"ডাক্তার" is not allowed' in e for e in errors)


# Strategies


def english_answer() -> dict[str, Any]:
    return GOOD_ANSWER | {"patient_summary": "Thank you for session 6. Your game success was steady."}


def bangla_translation(**changes: Any) -> dict[str, Any]:
    return {key: value for key, value in BANGLA.items() if key != "therapist_summary"} | {
        "suggestions": [{"id": "STEADY_EFFORT", "text": "স্থির দিন স্বাভাবিক। নিয়মিত ফিরে আসাই আসল।"}],
        "therapist_summary": "(keep as given)",
        **changes,
    }


def test_direct_asks_the_model_for_bangla() -> None:
    provider = MockProvider(answers=[BANGLA])
    result = generate_report_from_facts(make_facts(), "bn", provider=provider, bn_strategy="direct")
    assert not result.meta.fallback_used and result.meta.strategy == "direct"
    assert result.report.patient_summary == BANGLA["patient_summary"]
    [call] = provider.calls
    assert "LANGUAGE: Bangla, in Bengali script" in call["user"]
    assert call["json_schema"]["properties"]["language"]["enum"] == ["bn"]


def test_translate_writes_english_then_translates_the_patient_text() -> None:
    provider = MockProvider(answers=[english_answer(), bangla_translation()])
    result = generate_report_from_facts(make_facts(), "bn", provider=provider, bn_strategy="translate")
    assert not result.meta.fallback_used and result.meta.strategy == "translate"
    assert result.meta.retries == 1  # two calls: English, then the translation
    english_call, translation_call = provider.calls
    assert "LANGUAGE: English" in english_call["user"]
    assert "Translate this report into Bangla" in translation_call["user"]
    assert "Thank you for session 6." in translation_call["user"]
    assert "translate" in translation_call["system"].lower()
    # The patient text is Bangla; the therapist summary is the validated English one.
    assert result.report.language == "bn"
    assert result.report.patient_summary == BANGLA["patient_summary"]
    assert result.report.therapist_summary == GOOD_ANSWER["therapist_summary"]
    assert "--- report attempt 1 ---" in (result.raw_output or "")
    assert "--- translation attempt 1 ---" in (result.raw_output or "")


def test_translate_must_preserve_every_number() -> None:
    # The first translation changes session 6 into session 7: retried, then right.
    wrong = bangla_translation(patient_summary="সেশন ৭ শেষ করার জন্য ধন্যবাদ। আজ আপনার খেলার সাফল্য স্থির ছিল।")
    provider = MockProvider(answers=[english_answer(), wrong, bangla_translation()])
    result = generate_report_from_facts(make_facts(), "bn", provider=provider, bn_strategy="translate")
    assert not result.meta.fallback_used
    assert result.meta.validation_errors == [
        ["translation: patient_summary: the numbers must stay exactly as in the English text (6)."]
    ]
    assert "the numbers must stay exactly" in provider.calls[2]["user"]
    # Bengali digits are the same numbers: "৬" keeps 6.
    assert translation_errors(Report.model_validate(english_answer()), json.dumps(bangla_translation())) == []


def test_translate_must_keep_the_ids_in_order() -> None:
    english = Report.model_validate(english_answer())
    moved = bangla_translation(suggestions=[{"id": "NEXT_FOCUS", "text": "পরের বার।"}])
    assert translation_errors(english, json.dumps(moved)) == [
        "suggestions: keep the same items in the same order (STEADY_EFFORT)."
    ]
    assert translation_errors(english, "not json") == ["The answer is not valid JSON. Output only the JSON object."]


def test_translate_falls_back_to_the_bangla_template() -> None:
    # The translation never keeps the number: after 3 tries, the Bangla template.
    wrong = bangla_translation(patient_summary="সেশন ৭ শেষ।")
    provider = MockProvider(answers=[english_answer(), wrong])
    result = generate_report_from_facts(make_facts(), "bn", provider=provider, bn_strategy="translate")
    assert result.meta.fallback_used and len(provider.calls) == 4
    assert result.report.language == "bn" and result.report.patient_summary.startswith("সেশন")
    # No English report at all: no translation is attempted.
    down = MockProvider(fail_with=LLMUnavailableError("down"))
    result = generate_report_from_facts(make_facts(), "bn", provider=down, bn_strategy="translate")
    assert result.meta.fallback_used and len(down.calls) == 1


def test_the_template_strategy_never_calls_the_model() -> None:
    provider = MockProvider()
    result = generate_report_from_facts(make_facts(), "bn", provider=provider, bn_strategy="template")
    assert provider.calls == [] and result.meta.fallback_used and result.meta.strategy == "template"
    assert result.report.language == "bn"


def test_the_strategy_comes_from_the_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LLM_BN_STRATEGY", "template")
    result = generate_report_from_facts(make_facts(), "bn", provider=MockProvider())
    assert result.meta.strategy == "template"
    # English reports are always written directly.
    english = generate_report_from_facts(make_facts(), "en", provider=MockProvider(answers=[GOOD_ANSWER]))
    assert english.meta.strategy == "direct" and not english.meta.fallback_used
    monkeypatch.setattr(settings, "LLM_BN_STRATEGY", "poetry")
    with pytest.raises(ValueError, match="Unknown LLM_BN_STRATEGY"):
        generate_report_from_facts(make_facts(), "bn", provider=MockProvider())


@pytest.mark.parametrize("seed", range(30))
def test_the_bangla_template_always_validates(seed: int) -> None:
    facts = random_facts(seed)
    seen = prompt.facts_seen(facts)
    found = candidates(facts)
    flags = red_flags(facts, "bn")
    report = build_fallback(facts, seen, found, flags, "bn")
    assert validate(report, seen, facts, found, flags, "bn") == [], (seed, report.model_dump())


def test_the_bangla_template_names_improvements_in_bangla() -> None:
    facts = make_facts(metrics=[metric("K6", "improved", 2.0), metric("H3", "worse", -1.2)])
    report = build_fallback(facts, prompt.facts_seen(facts), candidates(facts), [], "bn")
    assert "নড়াচড়ার সময় উন্নত হয়েছে" in report.patient_summary
    assert "৬" in report.patient_summary
