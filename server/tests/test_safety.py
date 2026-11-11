import pytest

from app.engine.base import EngineData
from app.engine.safety import (
    FAILURE_EASE,
    FATIGUE_EASE,
    SafetyInput,
    TrialRecord,
    apply_safety,
    fatigue_signs,
)

EVEN = {"spatial": 0.5, "precision": 0.5, "activation": 0.5}


def trials(*outcomes: str, compensated: tuple[int, ...] = ()) -> list[TrialRecord]:
    """Trials numbered from 1; `compensated` lists the numbers with compensation."""
    return [
        TrialRecord(trial_no=n, outcome=outcome, compensated=n in compensated)
        for n, outcome in enumerate(outcomes, start=1)
    ]


def check(
    after: dict[str, float],
    history: list[TrialRecord],
    before: dict[str, float] = EVEN,
    **changes: object,
) -> tuple[dict[str, float], str | None, str | None]:
    result = apply_safety(
        SafetyInput(
            before=EngineData(d=dict(before)),
            after=EngineData(d=dict(after), streak=1, turn=2),
            history=history,
            **changes,  # type: ignore[arg-type]
        )
    )
    assert result.state.streak == 1 and result.state.turn == 2
    return result.state.d, result.cue, result.safety_override


def test_nothing_changes_when_no_rule_applies() -> None:
    proposal = {**EVEN, "spatial": 0.56}
    d, cue, override = check(proposal, trials("success", "success"))
    assert d == proposal and cue is None and override is None


def test_hard_bounds_keep_every_d_within_the_maximum() -> None:
    d, cue, override = check({**EVEN, "spatial": 0.9}, trials("success"), max_difficulty=0.6)
    assert d["spatial"] == 0.6
    assert override is not None and "maximum difficulty 0.60" in override and "spatial" in override
    d, _, _ = check({"spatial": -0.2, "speed": 1.4}, [], before={"spatial": 0, "speed": 1})
    assert d == {"spatial": 0.0, "speed": 1.0}


def test_compensation_blocks_only_spatial_increases() -> None:
    history = trials("success", "success", "success", compensated=(2, 3))
    proposal = {"spatial": 0.56, "precision": 0.56, "activation": 0.5}
    d, cue, override = check(proposal, history)
    assert d["spatial"] == 0.5  # Blocked.
    assert d["precision"] == 0.56  # Allowed.
    assert cue == "posture"
    assert override is not None and "spatial kept at 0.50 instead of 0.56" in override


def test_compensation_lets_spatial_ease() -> None:
    history = trials("success", "reach_fail", "success", compensated=(1, 3))
    d, cue, override = check({**EVEN, "spatial": 0.42}, history)
    assert d["spatial"] == 0.42
    assert cue == "posture" and override is None


def test_compensation_needs_two_of_the_last_three() -> None:
    history = trials("success", "success", "success", "success", compensated=(1, 2))
    d, cue, _ = check({**EVEN, "spatial": 0.56}, history)
    assert d["spatial"] == 0.56 and cue is None


def test_three_failures_in_a_row_ease_everything() -> None:
    history = trials("success", "reach_fail", "miss", "activation_fail")
    d, cue, override = check(EVEN, history)
    assert d == {component: 0.5 - FAILURE_EASE for component in EVEN}
    assert cue == "encourage"
    assert override is not None and "3 failures in a row" in override
    d, cue, _ = check(EVEN, trials("reach_fail", "miss"))
    assert d == EVEN and cue is None
    d, _, _ = check({"spatial": 0.1}, trials("miss", "miss", "miss"), before={"spatial": 0.1})
    assert d == {"spatial": 0.0}


def test_tiring_success_rate() -> None:
    history = trials(*["success"] * 5, "success", "miss", "success", "miss", "miss")
    d, cue, override = check(EVEN, history)
    assert d == {component: 0.5 - FATIGUE_EASE for component in EVEN}
    assert cue == "rest"
    assert override is not None and "success fell from 100% to 40%" in override


def test_tiring_slower_movements_and_weaker_squeezes() -> None:
    slower = [TrialRecord(n, "success", time_ms=1000 if n <= 5 else 1400) for n in range(1, 11)]
    assert fatigue_signs(slower) == ["time rose from 1000 to 1400 ms"]
    same = [TrialRecord(n, "success", time_ms=1000 if n <= 5 else 1300) for n in range(1, 11)]
    assert fatigue_signs(same) == []  # 30% exactly is not "more than 30%".
    weaker = [
        TrialRecord(n, "success", activation_peak=0.8 if n <= 5 else 0.6) for n in range(1, 11)
    ]
    assert fatigue_signs(weaker) == ["squeeze fell from 0.80 to 0.60"]
    _, cue, _ = check(EVEN, weaker)
    assert cue == "rest"


def test_tiring_needs_ten_trials_and_waits_five_after_a_rest() -> None:
    history = trials(*["success"] * 5, "miss", "miss", "success", "miss", "success")
    assert fatigue_signs(history[:9]) == []
    _, cue, _ = check(EVEN, history, trials_since_rest=2)
    assert cue is None
    _, cue, _ = check(EVEN, history, trials_since_rest=5)
    assert cue == "rest"


def test_session_time_cues() -> None:
    _, cue, override = check(EVEN, [], active_minutes=26)
    assert cue == "finish_soon" and override is None
    _, cue, _ = check(EVEN, [], active_minutes=36)
    assert cue == "finish"
    _, cue, _ = check(EVEN, [], active_minutes=24)
    assert cue is None
    _, cue, _ = check(EVEN, [], active_minutes=11, finish_soon_minutes=5, finish_minutes=10)
    assert cue == "finish"


def test_rules_apply_in_order_and_the_most_important_cue_wins() -> None:
    # Bounds (0.7 -> 0.6), then compensation (spatial back to 0.5), then three failures
    # (everything 0.15 easier), then tiring (0.1 easier again).
    history = trials(
        *["success"] * 5, "success", "success", "miss", "miss", "miss", compensated=(9, 10)
    )
    d, cue, override = check(
        {"spatial": 0.7, "precision": 0.7, "activation": 0.5},
        history,
        max_difficulty=0.6,
        active_minutes=30,
    )
    assert d == {
        "spatial": pytest.approx(0.25),
        "precision": pytest.approx(0.35),
        "activation": pytest.approx(0.25),
    }
    assert cue == "rest"  # Before finish_soon, encourage and posture.
    assert override is not None
    parts = override.split("; ")
    assert [part.split(" ")[0] for part in parts] == ["Kept", "Compensation", "3", "Signs"]
