"""Make the synthetic test set for the feedback evaluation: 60 session facts in the shape of
docs/session-facts.md, from a fixed seed, so every model is judged on the same sessions.

    server\\.venv\\Scripts\\python.exe analysis\\llm\\make_testset.py

Categories: 15 improving, 15 declining, 15 mixed, 5 first-session, 5 red-flag, 5 messy
(missing measures, a very short session). 40 cases are "dev" (for choosing the model and the
prompt) and 20 "held_out" (checked once at the end). About a quarter are in Bangla. No patient
data: every number is made up.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app.feedback.rules import SHARP_DECLINE_MDC, red_flags  # noqa: E402
from app.schemas.metrics import SessionFacts  # noqa: E402
from app.services.metrics_catalog import CatalogMetric, load_catalog  # noqa: E402
from app.services.session_facts import KEY_METRICS  # noqa: E402

SEED = 20261113
OUT = ROOT / "analysis" / "llm" / "testset.json"

#: Per category: (cases, of which dev). The rest are held out.
CATEGORIES: dict[str, tuple[int, int]] = {
    "improving": (15, 10),
    "declining": (15, 10),
    "mixed": (15, 10),
    "first_session": (5, 4),
    "red_flag": (5, 3),
    "messy": (5, 3),
}

GAMES = ["reach_activate", "balloon_pop", "fruit_catch", "bloom", "grip_hold", "pick_place", "finger_piano"]
MOVEMENTS = ["reach", "shoulder", "elbow", "hand_opening", "fingers", "grip", "smoothness"]
DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315]
#: A plausible range of values for each unit.
UNIT_RANGES: dict[str, tuple[float, float]] = {
    "ms": (600, 2200),
    "share": (0.2, 0.95),
    "deg": (50, 150),
    "sw2": (0.8, 2.6),
    "palm_ratio": (0.15, 0.65),
    "sparc": (-3.2, -1.3),
    "sw_per_s": (0.4, 2.2),
    "count": (1, 12),
    "arm_ratio": (0.4, 1.0),
    "min": (5, 30),
}
#: Measures in the facts never include the self-report ones.
MEASURES = [m for m in load_catalog() if m.id not in {"P1", "P2", "P3"}]


def _value(rng: random.Random, metric: CatalogMetric) -> float:
    low, high = UNIT_RANGES.get(metric.unit, (0.1, 10))
    value = rng.uniform(low, high)
    return round(value) if metric.unit in ("ms", "deg", "count") else round(value, 2)


def _baseline(rng: random.Random, metric: CatalogMetric, value: float, change: float) -> float:
    """A baseline that agrees with the change: better values are higher, lower or nearer 0."""
    step = abs(value) * rng.uniform(0.05, 0.2) * (1 if change >= 0 else -1)
    if metric.better_when == "higher":
        baseline = value - step
    elif metric.better_when == "lower":
        baseline = value + step
    else:  # closer_to_zero; values are negative
        baseline = value - step
    return round(baseline) if metric.unit in ("ms", "deg", "count") else round(baseline, 2)


def _metric(
    rng: random.Random, metric: CatalogMetric, status: str, change: float | None
) -> dict[str, Any]:
    value = _value(rng, metric)
    return {
        "id": metric.id,
        "game_id": metric.games[0] if metric.level == "trial" and metric.games else None,
        "name": metric.name,
        "value": value,
        "baseline": None if change is None else _baseline(rng, metric, value, change),
        "unit": metric.unit,
        "change_mdc": None if change is None else round(change, 2),
        "mdc_status": status,
    }


def _change(rng: random.Random, status: str) -> float | None:
    return {
        "improved": rng.uniform(1.0, 3.0),
        # Above -2 MDC, so a single category does not turn into a sharp decline.
        "worse": rng.uniform(-1.9, -1.0),
        "no_detectable_change": rng.uniform(-0.9, 0.9),
    }.get(status)


def _measures(rng: random.Random, statuses: list[str]) -> list[dict[str, Any]]:
    """Measures in the facts' order: changed ones first (largest change first), then the rest."""
    # Mostly key measures, as the facts builder prefers them.
    pool = sorted(MEASURES, key=lambda m: (m.id not in KEY_METRICS, rng.random()))
    chosen = pool[: len(statuses)]
    rng.shuffle(chosen)
    found = [_metric(rng, m, s, _change(rng, s)) for m, s in zip(chosen, statuses, strict=True)]
    changed = sorted(
        (m for m in found if m["mdc_status"] in ("improved", "worse")),
        key=lambda m: -abs(m["change_mdc"]),
    )
    return [*changed, *(m for m in found if m["mdc_status"] not in ("improved", "worse"))]


def _games(rng: random.Random, levels: str) -> dict[str, Any]:
    """levels: "up" (most rose), "down", "mixed" or "none" (fixed settings)."""
    found = {}
    for game_id in rng.sample(GAMES, rng.randint(2, 4)):
        start = rng.randint(2, 8)
        step = {"up": rng.choice([1, 1, 0]), "down": rng.choice([-1, -1, 0]), "mixed": rng.choice([-1, 0, 1])}
        end = None if levels == "none" else max(1, min(10, start + step[levels]))
        found[game_id] = {
            "trials": rng.randint(8, 25),
            "success_rate": round(rng.uniform(0.4, 0.95), 2),
            "level_start": None if levels == "none" else start,
            "level_end": end,
        }
    return found


def _base(rng: random.Random, number: int, category: str) -> dict[str, Any]:
    weak = sorted(rng.sample(DIRECTIONS, rng.choice([0, 0, 1, 2])))
    return {
        "session_id": 1000 + number,
        "patient_code": f"T{number:03d}",
        "session_no": rng.randint(4, 30),
        "language": "bn" if rng.random() < 0.25 else "en",
        "affected_side": rng.choice(["left", "right"]),
        "duration_min": round(rng.uniform(15, 35), 1),
        "baseline_available": True,
        "games": _games(rng, rng.choice(["up", "mixed", "none"])),
        "metrics": [],
        "directions": {"weak": weak, "strong": [d for d in DIRECTIONS if d not in weak][: rng.randint(0, 2)]},
        "flags": {
            "compensation_rate": round(rng.uniform(0, 0.3), 2),
            "fatigue_flag": False,
            "hand_loss_pct": round(rng.uniform(0, 8), 1),
            "shoulder_compensation_rate": round(rng.uniform(0, 0.2), 2),
            "safety_flags": [],
        },
        "self_report": {
            "pain_0_10": rng.randint(0, 2),
            "fatigue_0_10": rng.randint(1, 7),
            "enjoyment_1_5": rng.randint(2, 5),
        },
        "adherence": {"sessions_this_week": rng.randint(1, 5), "planned_this_week": 5},
        "next_session": {
            "focus_movements": rng.sample(MOVEMENTS, rng.randint(1, 2)),
            "focus_directions": [float(d) for d in weak[:1]],
            "planned_games": rng.sample(GAMES, rng.randint(3, 4)),
        },
        "safety_notice_present": False,
    }


def _improving(rng: random.Random, facts: dict[str, Any]) -> None:
    improved = rng.randint(2, 4)
    facts["metrics"] = _measures(rng, ["improved"] * improved + ["no_detectable_change"] * rng.randint(2, 4))
    facts["games"] = _games(rng, "up")


def _declining(rng: random.Random, facts: dict[str, Any]) -> None:
    facts["metrics"] = _measures(
        rng, ["worse"] * rng.randint(1, 3) + ["no_detectable_change"] * rng.randint(2, 4)
    )
    facts["games"] = _games(rng, "down")
    facts["self_report"]["fatigue_0_10"] = rng.randint(4, 8)


def _mixed(rng: random.Random, facts: dict[str, Any]) -> None:
    facts["metrics"] = _measures(
        rng,
        ["improved"] * rng.randint(1, 3)
        + ["worse"] * rng.randint(1, 2)
        + ["no_detectable_change"] * rng.randint(1, 3),
    )
    facts["games"] = _games(rng, "mixed")


def _first_session(rng: random.Random, facts: dict[str, Any]) -> None:
    facts["session_no"] = rng.randint(1, 2)
    facts["baseline_available"] = False
    facts["metrics"] = _measures(rng, ["no_baseline"] * rng.randint(3, 6))
    facts["games"] = _games(rng, rng.choice(["up", "none"]))
    facts["adherence"]["sessions_this_week"] = facts["session_no"]


def _red_flag(rng: random.Random, facts: dict[str, Any], number: int) -> None:
    kind = ["pain", "new_symptoms", "sharp_decline", "pain+new_symptoms", "sharp_decline+pain"][number % 5]
    facts["metrics"] = _measures(rng, ["improved", "no_detectable_change", "no_detectable_change"])
    if "pain" in kind:
        facts["flags"]["safety_flags"].append("pain")
        facts["self_report"]["pain_0_10"] = rng.randint(4, 8)
    if "new_symptoms" in kind:
        facts["flags"]["safety_flags"].append("new_symptoms")
    if "sharp_decline" in kind:
        key = [m for m in MEASURES if m.id in KEY_METRICS]
        declined = [
            _metric(rng, m, "worse", -rng.uniform(SHARP_DECLINE_MDC, 3.5)) for m in rng.sample(key, 3)
        ]
        facts["metrics"] = sorted(declined, key=lambda m: m["change_mdc"])
    facts["safety_notice_present"] = bool(facts["flags"]["safety_flags"])


def _messy(rng: random.Random, facts: dict[str, Any], number: int) -> None:
    facts["duration_min"] = round(rng.uniform(1.5, 4), 1)
    facts["games"] = {
        rng.choice(GAMES): {"trials": rng.randint(1, 3), "success_rate": None, "level_start": None, "level_end": None}
    }
    facts["metrics"] = _measures(rng, ["no_detectable_change"]) if number % 2 else []
    facts["directions"] = {"weak": [], "strong": []}
    facts["flags"].update(compensation_rate=None, hand_loss_pct=rng.choice([None, 14.5]), shoulder_compensation_rate=None)
    facts["self_report"] = None if number % 2 == 0 else facts["self_report"]
    facts["next_session"] = None if number % 3 == 0 else facts["next_session"]
    facts["adherence"] = {"sessions_this_week": 0, "planned_this_week": rng.choice([0, 5])}


def make_testset(seed: int = SEED) -> dict[str, Any]:
    rng = random.Random(seed)
    cases: list[dict[str, Any]] = []
    for category, (count, dev) in CATEGORIES.items():
        for index in range(count):
            number = len(cases) + 1
            facts = _base(rng, number, category)
            if category == "improving":
                _improving(rng, facts)
            elif category == "declining":
                _declining(rng, facts)
            elif category == "mixed":
                _mixed(rng, facts)
            elif category == "first_session":
                _first_session(rng, facts)
            elif category == "red_flag":
                _red_flag(rng, facts, index)
            else:
                _messy(rng, facts, index)
            # Every case must be valid facts.
            SessionFacts.model_validate(facts)
            cases.append(
                {
                    "id": f"{category}_{index + 1:02d}",
                    "category": category,
                    "split": "dev" if index < dev else "held_out",
                    "facts": facts,
                }
            )
    return {
        "seed": seed,
        "note": "Synthetic facts (docs/session-facts.md) for analysis/llm/run_eval.py. No patient data.",
        "cases": cases,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the feedback evaluation test set.")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args(argv)
    data = make_testset(args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cases = data["cases"]
    flagged = sum(bool(red_flags(SessionFacts.model_validate(c["facts"]))) for c in cases)
    print(
        f"Wrote {len(cases)} cases to {args.out}: "
        f"{sum(c['split'] == 'dev' for c in cases)} dev, "
        f"{sum(c['split'] == 'held_out' for c in cases)} held out, {flagged} with a red flag."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
