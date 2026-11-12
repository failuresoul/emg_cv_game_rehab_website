"""app/feedback/rules.py: which suggestions and safety notices a session's facts allow."""

import json
import re
from typing import Any

import pytest

from app.core.config import settings
from app.feedback import rules
from app.feedback.rules import (
    MAX_CANDIDATES,
    Candidate,
    candidates,
    facts_for_llm,
    load_catalogue,
    notice_texts,
    red_flags,
    tip,
)
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

ALL_IDS = {
    "CELEBRATE_PROGRESS", "STEADY_EFFORT", "FIRST_SESSIONS", "PRACTICE_DIRECTION",
    "POSTURE_TRUNK", "SHOULDER_RELAX", "REST_BREAKS", "RELAX_AFTER_SQUEEZE", "STEADY_HOLD",
    "SETUP_LIGHTING", "ROUTINE", "LEVEL_UP", "NEXT_FOCUS",
}  # fmt: skip

#: Words no generated or template text may use (code rule 4).
BANNED = re.compile(
    r"\b(cure|cured|heal|healing|healed|recover|recovery|recovering|diagnos\w*|medicine|"
    r"medication|drug|dose|prescri\w*|treatment|therapy will)\b",
    re.IGNORECASE,
)


def metric(
    metric_id: str, status: str, change_mdc: float | None, game_id: str | None = None
) -> FactsMetric:
    return FactsMetric(
        id=metric_id,
        game_id=game_id,
        name=metric_id,
        value=1.0,
        baseline=None if change_mdc is None else 1.0,
        unit="share",
        change_mdc=change_mdc,
        mdc_status=status,  # type: ignore[arg-type]
    )


def make_facts(**changes: Any) -> SessionFacts:
    """A quiet session: one unchanged measure, the weekly goal met, nothing flagged.
    Only STEADY_EFFORT and NEXT_FOCUS apply to it."""
    facts = SessionFacts(
        session_id=9,
        patient_code="P001",
        session_no=6,
        language="en",
        affected_side="left",
        duration_min=25.0,
        baseline_available=True,
        games={"reach_activate": FactsGame(trials=20, success_rate=0.8, level_start=4, level_end=4)},
        metrics=[metric("G1", "no_detectable_change", 0.3)],
        directions=FactsDirections(weak=[], strong=[0]),
        flags=FactsFlags(
            compensation_rate=0.05,
            fatigue_flag=False,
            hand_loss_pct=1.0,
            shoulder_compensation_rate=0.0,
            safety_flags=[],
        ),
        self_report=FactsSelfReport(pain_0_10=1, fatigue_0_10=3, enjoyment_1_5=4),
        adherence=FactsAdherence(sessions_this_week=5, planned_this_week=5),
        next_session=FactsNextSession(
            focus_movements=["grip"], focus_directions=[90], planned_games=["grip_hold", "bloom"]
        ),
        safety_notice_present=False,
    )
    return facts.model_copy(update=changes)


def flags(**changes: Any) -> FactsFlags:
    return make_facts().flags.model_copy(update=changes)


def ids(found: list[Candidate]) -> list[str]:
    return [candidate.id for candidate in found]


def by_id(found: list[Candidate], suggestion_id: str) -> Candidate:
    [candidate] = [candidate for candidate in found if candidate.id == suggestion_id]
    return candidate


def evidence(found: list[Candidate], suggestion_id: str) -> list[dict[str, Any]]:
    return by_id(found, suggestion_id).as_dict()["evidence"]


# The catalogue and the tips


def test_the_catalogue_has_every_suggestion_with_a_rule_and_a_tip() -> None:
    catalogue = load_catalogue()
    assert {suggestion.id for suggestion in catalogue} == ALL_IDS
    assert set(rules.TRIGGERS) == ALL_IDS
    for suggestion in catalogue:
        assert (rules.KB_DIR / "en" / f"{suggestion.id}.md").is_file(), suggestion.id
        assert tip(suggestion.id).startswith("# ")
    with_threshold = {s.id for s in catalogue if s.threshold is not None}
    assert with_threshold == {
        "REST_BREAKS", "POSTURE_TRUNK", "SHOULDER_RELAX", "STEADY_HOLD", "SETUP_LIGHTING",
    }  # fmt: skip
    assert rules.get_suggestion("POSTURE_TRUNK").threshold == 0.20
    assert rules.get_suggestion("REST_BREAKS").threshold == 6
    assert rules.get_suggestion("SETUP_LIGHTING").threshold == 5


def test_the_kb_has_no_file_without_a_suggestion() -> None:
    files = {path.stem for path in (rules.KB_DIR / "en").glob("*.md")}
    assert files == ALL_IDS
    with pytest.raises(KeyError):
        tip("NOT_A_SUGGESTION")


def test_the_approved_texts_are_short_and_make_no_medical_claims() -> None:
    for suggestion in load_catalogue():
        sentences = [part for part in re.split(r"(?<=[.!?])\s+", suggestion.guidance) if part]
        assert 2 <= len(sentences) <= 3, suggestion.id
        assert not BANNED.search(suggestion.guidance), suggestion.id
        assert not BANNED.search(tip(suggestion.id)), suggestion.id
    notices = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))["notices"]
    for notice in notices.values():
        assert not BANNED.search(notice["en"])


# Each trigger


def test_the_quiet_session_only_gets_steady_effort_and_next_focus() -> None:
    found = candidates(make_facts())
    assert ids(found) == ["STEADY_EFFORT", "NEXT_FOCUS"]
    assert evidence(found, "STEADY_EFFORT") == [{"id": "G1", "value": 1.0}]


def test_celebrate_progress_needs_an_improved_measure() -> None:
    facts = make_facts(
        metrics=[
            metric("K6", "improved", 2.1, game_id="reach_activate"),
            metric("G1", "no_detectable_change", 0.2),
        ]
    )
    found = candidates(facts)
    assert evidence(found, "CELEBRATE_PROGRESS") == [
        {"id": "K6", "value": 1.0, "game_id": "reach_activate"}
    ]
    # Something improved, so the day was not "the same as usual".
    assert "STEADY_EFFORT" not in ids(found)


def test_steady_effort_not_when_something_got_worse_or_nothing_could_be_compared() -> None:
    worse = make_facts(metrics=[metric("K7", "worse", -1.2), metric("G1", "no_detectable_change", 0)])
    assert "STEADY_EFFORT" not in ids(candidates(worse))
    no_baseline = make_facts(metrics=[metric("G1", "no_baseline", None)])
    assert "STEADY_EFFORT" not in ids(candidates(no_baseline))


def test_first_sessions_when_there_is_no_baseline() -> None:
    found = candidates(
        make_facts(baseline_available=False, session_no=2, metrics=[metric("G1", "no_baseline", None)])
    )
    assert evidence(found, "FIRST_SESSIONS") == [
        {"id": "baseline_available", "value": False},
        {"id": "session_no", "value": 2},
    ]


def test_practice_direction_for_weak_directions() -> None:
    found = candidates(make_facts(directions=FactsDirections(weak=[90, 135], strong=[])))
    assert evidence(found, "PRACTICE_DIRECTION") == [{"id": "directions.weak", "value": [90, 135]}]


@pytest.mark.parametrize(("rate", "fires"), [(0.19, False), (0.20, True), (0.6, True), (None, False)])
def test_posture_trunk_from_the_compensation_rate(rate: float | None, fires: bool) -> None:
    found = candidates(make_facts(flags=flags(compensation_rate=rate)))
    assert ("POSTURE_TRUNK" in ids(found)) is fires
    if fires:
        assert evidence(found, "POSTURE_TRUNK") == [{"id": "flags.compensation_rate", "value": rate}]


@pytest.mark.parametrize(("rate", "fires"), [(0.1, False), (0.15, True), (None, False)])
def test_shoulder_relax_from_shoulder_compensation(rate: float | None, fires: bool) -> None:
    found = candidates(make_facts(flags=flags(shoulder_compensation_rate=rate)))
    assert ("SHOULDER_RELAX" in ids(found)) is fires


def test_rest_breaks_from_the_fatigue_flag_or_the_self_report() -> None:
    by_flag = candidates(make_facts(flags=flags(fatigue_flag=True)))
    assert evidence(by_flag, "REST_BREAKS") == [{"id": "flags.fatigue_flag", "value": True}]
    tired = FactsSelfReport(pain_0_10=0, fatigue_0_10=6, enjoyment_1_5=3)
    by_report = candidates(make_facts(self_report=tired))
    assert evidence(by_report, "REST_BREAKS") == [{"id": "self_report.fatigue_0_10", "value": 6}]
    a_bit_tired = FactsSelfReport(pain_0_10=0, fatigue_0_10=5, enjoyment_1_5=3)
    assert "REST_BREAKS" not in ids(candidates(make_facts(self_report=a_bit_tired)))
    assert "REST_BREAKS" not in ids(candidates(make_facts(self_report=None)))


def test_relax_after_squeeze_when_relaxation_time_got_worse() -> None:
    found = candidates(make_facts(metrics=[metric("H4", "worse", -1.4, game_id="grip_hold")]))
    assert evidence(found, "RELAX_AFTER_SQUEEZE") == [
        {"id": "H4", "value": 1.0, "game_id": "grip_hold"}
    ]
    better = make_facts(metrics=[metric("H4", "improved", 1.4)])
    assert "RELAX_AFTER_SQUEEZE" not in ids(candidates(better))


def test_steady_hold_from_grip_steadiness_or_grip_success() -> None:
    by_metric = candidates(make_facts(metrics=[metric("H3", "worse", -1.1, game_id="grip_hold")]))
    assert evidence(by_metric, "STEADY_HOLD") == [{"id": "H3", "value": 1.0, "game_id": "grip_hold"}]

    games = {"grip_hold": FactsGame(trials=8, success_rate=0.375)}
    by_success = candidates(make_facts(games=games))
    assert evidence(by_success, "STEADY_HOLD") == [
        {"id": "games.success_rate", "value": 0.375, "game_id": "grip_hold"}
    ]
    fine = {"grip_hold": FactsGame(trials=8, success_rate=0.5)}
    assert "STEADY_HOLD" not in ids(candidates(make_facts(games=fine)))


@pytest.mark.parametrize(("lost", "fires"), [(4.9, False), (5.0, True), (None, False)])
def test_setup_lighting_from_hand_loss(lost: float | None, fires: bool) -> None:
    found = candidates(make_facts(flags=flags(hand_loss_pct=lost)))
    assert ("SETUP_LIGHTING" in ids(found)) is fires


def test_routine_when_the_week_is_below_plan() -> None:
    behind = make_facts(adherence=FactsAdherence(sessions_this_week=2, planned_this_week=5))
    assert evidence(candidates(behind), "ROUTINE") == [
        {"id": "adherence.sessions_this_week", "value": 2},
        {"id": "adherence.planned_this_week", "value": 5},
    ]
    no_goal = make_facts(adherence=FactsAdherence(sessions_this_week=0, planned_this_week=0))
    assert "ROUTINE" not in ids(candidates(no_goal))


def test_level_up_when_most_games_rose() -> None:
    games = {
        "reach_activate": FactsGame(trials=20, success_rate=0.8, level_start=4, level_end=5),
        "bloom": FactsGame(trials=15, success_rate=0.8, level_start=3, level_end=4),
        "grip_hold": FactsGame(trials=8, success_rate=0.6, level_start=4, level_end=4),
        # Fixed settings: no levels, so not counted.
        "balloon_pop": FactsGame(trials=10, success_rate=0.7),
    }
    assert evidence(candidates(make_facts(games=games)), "LEVEL_UP") == [
        {"id": "games.level", "value": {"start": 4, "end": 5}, "game_id": "reach_activate"},
        {"id": "games.level", "value": {"start": 3, "end": 4}, "game_id": "bloom"},
    ]
    half = {
        "reach_activate": FactsGame(trials=20, success_rate=0.8, level_start=4, level_end=5),
        "bloom": FactsGame(trials=15, success_rate=0.8, level_start=3, level_end=3),
    }
    assert "LEVEL_UP" not in ids(candidates(make_facts(games=half)))


def test_next_focus_from_the_plan() -> None:
    assert evidence(candidates(make_facts()), "NEXT_FOCUS") == [
        {"id": "next_session.focus_movements", "value": ["grip"]},
        {"id": "next_session.focus_directions", "value": [90]},
        {"id": "next_session.planned_games", "value": ["grip_hold", "bloom"]},
    ]
    assert "NEXT_FOCUS" not in ids(candidates(make_facts(next_session=None)))


# Order, the maximum and evidence


def everything() -> SessionFacts:
    """A session that triggers every suggestion it can at once."""
    return make_facts(
        metrics=[
            metric("K6", "improved", 2.0),
            metric("H3", "worse", -1.1),
            metric("H4", "worse", -1.2),
        ],
        directions=FactsDirections(weak=[90], strong=[]),
        flags=flags(
            compensation_rate=0.3,
            shoulder_compensation_rate=0.2,
            fatigue_flag=True,
            hand_loss_pct=8.0,
        ),
        adherence=FactsAdherence(sessions_this_week=1, planned_this_week=5),
        games={"reach_activate": FactsGame(trials=20, success_rate=0.8, level_start=4, level_end=6)},
    )


def test_safety_first_then_celebrate_and_at_most_five_with_next_focus_last() -> None:
    found = candidates(everything())
    assert len(found) == MAX_CANDIDATES
    assert ids(found) == [
        "REST_BREAKS", "POSTURE_TRUNK", "SHOULDER_RELAX", "CELEBRATE_PROGRESS", "NEXT_FOCUS",
    ]  # fmt: skip


def test_the_rest_follow_by_priority() -> None:
    facts = everything().model_copy(
        update={"flags": flags(hand_loss_pct=8.0), "metrics": [metric("H3", "worse", -1.1)]}
    )
    assert ids(candidates(facts)) == [
        "STEADY_HOLD", "PRACTICE_DIRECTION", "SETUP_LIGHTING", "LEVEL_UP", "NEXT_FOCUS",
    ]  # fmt: skip
    # Without a plan, five others fill the list.
    no_plan = facts.model_copy(update={"next_session": None})
    assert ids(candidates(no_plan)) == [
        "STEADY_HOLD", "PRACTICE_DIRECTION", "SETUP_LIGHTING", "LEVEL_UP", "ROUTINE",
    ]  # fmt: skip


@pytest.mark.parametrize(
    "facts",
    [
        make_facts(),
        everything(),
        make_facts(next_session=None, metrics=[], self_report=None, games={}),
        make_facts(baseline_available=False, metrics=[metric("G1", "no_baseline", None)]),
        make_facts(flags=flags(compensation_rate=None, hand_loss_pct=None, shoulder_compensation_rate=None)),
    ],
)
def test_no_candidate_without_evidence(facts: SessionFacts) -> None:
    for audience in ("patient", "therapist"):
        for candidate in candidates(facts, audience=audience):  # type: ignore[arg-type]
            assert candidate.evidence, candidate.id
            assert candidate.guidance == rules.get_suggestion(candidate.id).guidance
            assert set(candidate.as_dict()) == {"id", "guidance", "evidence"}


def test_the_audience_filters_the_suggestions() -> None:
    first = make_facts(baseline_available=False, metrics=[], flags=flags(hand_loss_pct=9.0))
    assert {"FIRST_SESSIONS", "SETUP_LIGHTING"} <= set(ids(candidates(first)))
    therapist = ids(candidates(first, audience="therapist"))
    assert "FIRST_SESSIONS" not in therapist and "SETUP_LIGHTING" not in therapist


# Red flags


def stop_notice(language: str = "en") -> str:
    data = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    return str(data["notices"]["stop"][language])


def test_no_red_flags_on_a_quiet_session() -> None:
    assert red_flags(make_facts()) == []


def test_pain_and_new_symptoms_use_the_day_7_stop_notice() -> None:
    pain = red_flags(make_facts(flags=flags(safety_flags=["pain"]), safety_notice_present=True))
    assert [flag.as_dict() for flag in pain] == [{"code": "pain", "text": stop_notice()}]
    assert pain[0].text.startswith("Please stop practising for today")

    new = red_flags(make_facts(flags=flags(safety_flags=["new_symptoms"])))
    assert [flag.code for flag in new] == ["new_symptoms"]

    both = red_flags(make_facts(flags=flags(safety_flags=["new_symptoms", "pain", "high_fatigue"])))
    assert [flag.code for flag in both] == ["pain", "new_symptoms"]
    # One notice shown, not the same text twice.
    assert notice_texts(both) == [stop_notice()]


def test_pain_from_the_self_report_alone_is_a_red_flag() -> None:
    sore = FactsSelfReport(pain_0_10=4, fatigue_0_10=2, enjoyment_1_5=3)
    assert [flag.code for flag in red_flags(make_facts(self_report=sore))] == ["pain"]
    mild = FactsSelfReport(pain_0_10=3, fatigue_0_10=2, enjoyment_1_5=3)
    assert red_flags(make_facts(self_report=mild)) == []


def test_high_fatigue_alone_is_not_a_red_flag() -> None:
    assert red_flags(make_facts(flags=flags(fatigue_flag=True, safety_flags=["high_fatigue"]))) == []


def test_the_notice_is_in_the_patient_language() -> None:
    facts = make_facts(language="bn", flags=flags(safety_flags=["pain"]))
    assert red_flags(facts)[0].text == stop_notice("bn")


def test_sharp_decline_needs_three_key_measures_two_mdc_worse() -> None:
    three = [metric("K6", "worse", -2.0), metric("K7", "worse", -2.5), metric("G1", "worse", -3.1)]
    [flag] = red_flags(make_facts(metrics=three))
    assert flag.code == "sharp_decline"
    assert "therapist" in flag.text
    assert [item.id for item in flag.evidence] == ["K6", "K7", "G1"]

    # Two are not enough, nor a fall under 2 MDC.
    assert red_flags(make_facts(metrics=three[:2])) == []
    smaller = [*three[:2], metric("G1", "worse", -1.9)]
    assert red_flags(make_facts(metrics=smaller)) == []
    # A measure counts once, whatever games it came from.
    same = [
        metric("K6", "worse", -2.2, game_id="reach_activate"),
        metric("K6", "worse", -2.4, game_id="balloon_pop"),
        metric("K7", "worse", -2.5),
    ]
    assert red_flags(make_facts(metrics=same)) == []
    # Self-report measures are not key measures.
    not_key = [*three[:2], metric("P1", "worse", -3.0)]
    assert red_flags(make_facts(metrics=not_key)) == []


def test_a_red_flag_leaves_out_suggestions_that_ask_for_more_effort() -> None:
    facts = everything().model_copy(
        update={"flags": flags(safety_flags=["pain"], hand_loss_pct=8.0), "safety_notice_present": True}
    )
    found = ids(candidates(facts))
    for effort in ("PRACTICE_DIRECTION", "LEVEL_UP", "ROUTINE", "STEADY_HOLD"):
        assert effort not in found
    assert "NEXT_FOCUS" in found


# What the model sees


def test_the_model_is_only_told_a_notice_exists() -> None:
    facts = make_facts(
        flags=flags(safety_flags=["pain"]),
        self_report=FactsSelfReport(pain_0_10=6, fatigue_0_10=3, enjoyment_1_5=4),
        safety_notice_present=True,
    )
    data = facts_for_llm(facts)
    assert data["safety_notice_present"] is True
    assert "safety_flags" not in data["flags"]
    assert "pain_0_10" not in data["self_report"]
    text = json.dumps(data)
    assert "pain" not in text and stop_notice() not in text


def test_a_sharp_decline_also_sets_the_notice_for_the_model() -> None:
    three = [metric("K6", "worse", -2.0), metric("K7", "worse", -2.5), metric("G1", "worse", -3.1)]
    data = facts_for_llm(make_facts(metrics=three))
    assert data["safety_notice_present"] is True
    assert "therapist" not in json.dumps(data)


def test_without_a_red_flag_the_model_sees_the_facts_unchanged() -> None:
    facts = make_facts()
    data = facts_for_llm(facts)
    expected = facts.model_dump(mode="json")
    expected["flags"].pop("safety_flags")
    assert data == expected
