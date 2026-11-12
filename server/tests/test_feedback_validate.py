"""app/feedback/validate.py, schemas.py and prompt.py: every kind of bad report is caught."""

import copy
import json
from typing import Any

import pytest

from app.feedback import prompt
from app.feedback.rules import candidates, red_flags
from app.feedback.schemas import Report, report_json_schema
from app.feedback.validate import number_is_known, numbers_in, validate
from app.schemas.metrics import FactsFlags, SessionFacts
from tests.feedback_factories import GOOD_ANSWER
from tests.test_feedback_rules import everything, make_facts, metric


def check(answer: Any, facts: SessionFacts | None = None, language: str = "en") -> list[str]:
    facts = facts or make_facts()
    return validate(
        answer,
        prompt.facts_seen(facts),
        facts,
        candidates(facts),
        red_flags(facts),
        language,  # type: ignore[arg-type]
    )


def changed(**fields: Any) -> dict[str, Any]:
    answer = copy.deepcopy(GOOD_ANSWER)
    answer.update(fields)
    return answer


def flagged_facts() -> SessionFacts:
    return make_facts(
        flags=make_facts().flags.model_copy(update={"safety_flags": ["pain"]}),
        safety_notice_present=True,
    )


def flagged_answer() -> dict[str, Any]:
    # The model is not given the pain score under a red flag, so it cannot quote it.
    return changed(
        therapist_summary="Session 6. G1 similar: 1 -> 1 share (0.3 MDC). Fatigue 3/10.",
        patient_summary="Thank you for session 6. Your game success was steady today.",
    )


# Good answers


def test_a_good_answer_passes() -> None:
    assert check(GOOD_ANSWER) == []
    assert check(json.dumps(GOOD_ANSWER)) == []
    assert check(Report.model_validate(GOOD_ANSWER)) == []


def test_a_good_answer_under_a_red_flag_passes() -> None:
    assert check(flagged_answer(), flagged_facts()) == []


@pytest.mark.parametrize("path", sorted(prompt.FEWSHOT_DIR.glob("*.json")), ids=lambda p: p.stem)
def test_the_fewshot_examples_are_checked_against_their_facts(path: Any) -> None:
    [example] = [item for item in prompt.examples() if item.name == path.stem]
    assert check(example.report, example.facts) == []
    # One improving and one mixed example.
    statuses = {m.mdc_status for m in example.facts.metrics}
    assert "improved" in statuses


def test_there_are_an_improving_and_a_mixed_example() -> None:
    names = [example.name for example in prompt.examples()]
    assert names == ["1_improving", "2_mixed"]
    mixed = prompt.examples()[1].facts
    assert {m.mdc_status for m in mixed.metrics} >= {"improved", "worse", "no_detectable_change"}


def test_numbers_in_allowed_forms_pass() -> None:
    facts = make_facts()
    seen = prompt.facts_seen(facts)
    known = [0.8, 0.05, 3.0, 1.53, 1180.4]
    assert all(number_is_known(n, known) for n in (0.8, 80, 5, 3, 1.5, 1.53, 2, 1180, 1180.4))
    assert not number_is_known(1.7, known)
    # "3/10" is a scale answer; ids such as K6 or units such as sw2 are not numbers.
    assert numbers_in("fatigue 3/10, K6 and 1.71 sw2, enjoyment 5/5") == [3, 1.71, 5]
    assert numbers_in("সেশন ৬") == [6]
    assert numbers_in("1,180 ms") == [1180]
    text = changed(patient_summary="You did session ৬ and won 80% of turns. Fatigue 3/10.")
    assert check(text, facts) == []
    assert seen["session_no"] == 6


# Each kind of bad answer


def test_an_invented_number_is_caught() -> None:
    errors = check(changed(patient_summary="You reached 37 targets today. Well done."))
    assert any("37 is not in SESSION_FACTS" in error for error in errors)
    # A difference the model worked out itself is invented too.
    facts = make_facts(metrics=[metric("K6", "improved", 2.0).model_copy(update={"value": 1180, "baseline": 1420})])
    answer = changed(
        highlights=[],
        therapist_summary="Session 6. K6 improved by 240 ms.",
        suggestions=[{"id": "CELEBRATE_PROGRESS", "text": "Well done today."}],
    )
    assert any("240" in error for error in check(answer, facts))


def test_a_wrong_direction_is_caught() -> None:
    errors = check(changed(highlights=[{"metric_id": "G1", "text": "Your game success improved."}]))
    assert any("G1 did not improve" in error for error in errors)
    errors = check(changed(patient_summary="Your game success got worse today."))
    assert any('"worse" describes a worsening of G1' in error for error in errors)
    errors = check(changed(therapist_summary="Session 6. G1 improved: 1 -> 1 share."))
    assert any("therapist_summary" in error and "G1" in error for error in errors)


def test_improvement_words_are_fine_for_improved_measures() -> None:
    facts = make_facts(metrics=[metric("K6", "improved", 2.0), metric("G1", "no_detectable_change", 0.1)])
    answer = changed(
        patient_summary="You reach each target faster now. Your game success was steady.",
        highlights=[{"metric_id": "K6", "text": "Your movement time improved."}],
        suggestions=[{"id": "CELEBRATE_PROGRESS", "text": "Well done today."}],
        therapist_summary="Session 6. K6 improved (2 MDC). G1 similar (0.1 MDC).",
    )
    assert check(answer, facts) == []


def test_an_unknown_suggestion_id_is_caught() -> None:
    errors = check(changed(suggestions=[{"id": "LEVEL_UP", "text": "You moved up a level."}]))
    assert any("LEVEL_UP is not in CANDIDATE_SUGGESTIONS" in error for error in errors)
    twice = [{"id": "STEADY_EFFORT", "text": "Keep going."}] * 2
    assert any("once" in error for error in check(changed(suggestions=twice)))
    assert any("choose 1 to 3" in error for error in check(changed(suggestions=[])))


@pytest.mark.parametrize(
    "sentence",
    [
        "This will cure your arm.",
        "Remember your medication.",
        "You are doing better than other patients.",
        "You will be back to normal soon.",
        "I guarantee more progress.",
        "The results look abnormal.",
        "Exercise through the pain.",
        "Stop your medication before playing.",
        "Your diagnosis is clear.",
    ],
)
def test_banned_words_are_caught(sentence: str) -> None:
    errors = check(changed(patient_summary=f"Thank you for session 6. {sentence}"))
    assert any("is not allowed" in error for error in errors), errors


def test_safety_text_leaks_only_matter_under_a_notice() -> None:
    leaking = flagged_answer() | {
        "patient_summary": "Thank you for session 6. If the pain stays, please see a doctor."
    }
    errors = check(leaking, flagged_facts())
    assert any('"pain" is not allowed' in error for error in errors)
    assert any('"doctor" is not allowed' in error for error in errors)
    emergency = flagged_answer() | {"next_session_text": "Call emergency services if needed."}
    assert any("emergency" in error for error in check(emergency, flagged_facts()))
    # Without a notice the same words are not a leak (pain is a fact the model was given).
    calm = changed(therapist_summary="Session 6. Self-report: pain 1/10.")
    assert check(calm) == []


def test_too_long_texts_are_caught() -> None:
    long_summary = " ".join(["Good work today."] * 45)
    assert any("patient_summary: 135 words; at most 120" in e for e in check(changed(patient_summary=long_summary)))
    long_highlight = [{"metric_id": "G1", "text": " ".join(["steady"] * 21)}]
    assert any("highlights[0].text: 21 words" in e for e in check(changed(highlights=long_highlight)))
    long_next = " ".join(["Practise gently."] * 21)
    assert any("next_session_text" in e for e in check(changed(next_session_text=long_next)))
    # Three 40-word sentences (120 words, within the limit) raise the average over 18.
    long_sentence = " ".join(["You " + " ".join(["kept"] * 37) + " going today."] * 3)
    assert any("sentences average" in e for e in check(changed(patient_summary=long_sentence)))


def test_the_wrong_script_is_caught() -> None:
    # Asked for Bangla, written in English.
    errors = check(changed(language="bn"), language="bn")
    assert any("must be written in Bangla" in error for error in errors)
    # Asked for English, written in Bangla.
    errors = check(changed(patient_summary="আজকের সেশনের জন্য ধন্যবাদ।"))
    assert any("patient_summary: must be written in English" in error for error in errors)
    # The therapist summary is always English, even in a Bangla report.
    bangla = {
        "language": "bn",
        "patient_summary": "সেশন ৬ শেষ করার জন্য ধন্যবাদ। আপনার ফলাফল স্থির ছিল।",
        "highlights": [],
        "suggestions": [{"id": "STEADY_EFFORT", "text": "নিয়মিত অনুশীলন করে যাওয়াই আসল কথা।"}],
        "next_session_text": "পরের সেশনে আপনি মুঠো করে ধরে রাখা অনুশীলন করবেন।",
        "therapist_summary": "সেশন ৬।",
    }
    errors = check(bangla, language="bn")
    assert errors == ["therapist_summary: must be written in English."]
    assert check(bangla | {"therapist_summary": "Session 6. G1 similar."}, language="bn") == []


def test_broken_answers_are_caught() -> None:
    assert check("Sure! Here it is.") == ["The answer is not valid JSON. Output only the JSON object."]
    missing = {key: value for key, value in GOOD_ANSWER.items() if key != "therapist_summary"}
    assert any(error.startswith("therapist_summary") for error in check(missing))
    assert any('language: must be "en"' in e for e in check(changed(language="bn"), language="en"))
    stranger = changed(highlights=[{"metric_id": "K9", "text": "Your top speed was steady."}])
    assert any("K9 is not in metrics" in error for error in check(stranger))
    too_many = changed(highlights=[{"metric_id": "G1", "text": "Steady."}] * 4)
    assert check(too_many)


# The schema and the prompt


def test_the_ollama_schema_limits_ids_to_this_session() -> None:
    schema = report_json_schema("bn", ["REST_BREAKS", "NEXT_FOCUS"], ["K6", "K6", "H3"])
    assert "$ref" not in json.dumps(schema) and "$defs" not in json.dumps(schema)
    assert schema["properties"]["language"]["enum"] == ["bn"]
    suggestions = schema["properties"]["suggestions"]
    assert suggestions["items"]["properties"]["id"]["enum"] == ["REST_BREAKS", "NEXT_FOCUS"]
    assert (suggestions["minItems"], suggestions["maxItems"]) == (1, 2)
    highlight_ids = schema["properties"]["highlights"]["items"]["properties"]["metric_id"]
    assert highlight_ids["enum"] == ["K6", "H3"]
    assert set(schema["required"]) == set(Report.model_fields)
    empty = report_json_schema("en", [], [])
    assert empty["properties"]["suggestions"]["maxItems"] == 0
    assert empty["properties"]["highlights"]["maxItems"] == 0


def test_the_prompt_has_the_rules_and_only_the_facts() -> None:
    facts = flagged_facts()
    seen = prompt.facts_seen(facts)
    user = prompt.user_prompt(seen, candidates(facts), "bn")
    system = prompt.system_prompt()
    for rule in ("SESSION_FACTS", "CANDIDATE_SUGGESTIONS", "SAFETY_NOTICE_PRESENT", "mdc_status", "JSON"):
        assert rule in system
    assert "LANGUAGE: Bangla, in Bengali script" in user
    assert "SAFETY_NOTICE_PRESENT: true" in user
    # No ids, no safety codes, no pain score, no notice text.
    real = user.split("Now the real session.")[1]
    assert "P001" not in real and '"session_id"' not in real
    assert "safety_flags" not in real and "pain_0_10" not in real
    assert "Please stop practising" not in user + system


def test_the_prompt_fits_a_4096_context_with_room_to_answer() -> None:
    names = {
        "K1": "Reach area", "K5": "Reaction time", "K6": "Movement time", "K7": "Path efficiency",
        "K8": "Smoothness (SPARC)", "R1": "Shoulder raise forward: best angle",
        "H1": "Hand opening range", "G1": "Overall game success rate",
    }  # fmt: skip
    big = everything().model_copy(
        update={
            "metrics": [
                metric(metric_id, "improved", 1.53, game_id="reach_activate").model_copy(
                    update={"name": name, "value": 1234.56, "baseline": 1300.12}
                )
                for metric_id, name in names.items()
            ]
        }
    )
    text = prompt.system_prompt() + prompt.user_prompt(prompt.facts_seen(big), candidates(big), "en")
    # About three characters per token for compact JSON (four for English); 700 for the answer.
    assert len(text) / 3 + 700 <= 4096


def test_a_retry_lists_the_errors() -> None:
    request = prompt.retry_prompt("USER", ["first problem", "second problem"])
    assert request.startswith("USER\n\nYour last answer had these problems:")
    assert "- first problem\n- second problem" in request


def test_unused_flags_field_is_harmless() -> None:
    # Facts from before the safety_flags field still validate.
    old = make_facts(flags=FactsFlags(compensation_rate=None, fatigue_flag=False, hand_loss_pct=None))
    assert check(changed(therapist_summary="Session 6. G1 similar."), old) == []
