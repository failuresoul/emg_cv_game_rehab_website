"""analysis/llm: the test set, run_eval.py and compare_models.py, with the model mocked."""

import csv
import importlib.util
import json
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.feedback import prompt
from app.feedback.fallback import build_fallback
from app.feedback.llm import MockProvider
from app.feedback.rules import candidates, red_flags
from app.schemas.metrics import SessionFacts

ROOT = Path(__file__).resolve().parents[2]
LLM_DIR = ROOT / "analysis" / "llm"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"llm_{name}", LLM_DIR / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def testset() -> dict[str, Any]:
    return load("make_testset").make_testset()


def good_answer(case: dict[str, Any]) -> dict[str, Any]:
    """A valid report for a case: the template's, as if a model had written it."""
    facts = SessionFacts.model_validate(case["facts"])
    seen = prompt.facts_seen(facts)
    report = build_fallback(facts, seen, candidates(facts), red_flags(facts, facts.language), facts.language)
    return report.model_dump()


# The test set


def test_the_testset_has_every_category_and_split(testset: dict[str, Any]) -> None:
    cases = testset["cases"]
    assert len(cases) == 60
    assert Counter(c["category"] for c in cases) == {
        "improving": 15, "declining": 15, "mixed": 15, "first_session": 5, "red_flag": 5, "messy": 5,
    }  # fmt: skip
    assert Counter(c["split"] for c in cases) == {"dev": 40, "held_out": 20}
    assert len({c["id"] for c in cases}) == 60
    assert {c["facts"]["language"] for c in cases} == {"en", "bn"}


def test_each_category_is_what_it_says(testset: dict[str, Any]) -> None:
    for case in testset["cases"]:
        facts = SessionFacts.model_validate(case["facts"])
        statuses = {m.mdc_status for m in facts.metrics}
        flagged = bool(red_flags(facts))
        category = case["category"]
        assert flagged == (category == "red_flag"), case["id"]
        if category == "improving":
            assert "improved" in statuses and "worse" not in statuses
        elif category == "declining":
            assert "worse" in statuses and "improved" not in statuses
        elif category == "mixed":
            assert {"improved", "worse"} <= statuses
        elif category == "first_session":
            assert not facts.baseline_available and statuses == {"no_baseline"}
        elif category == "messy":
            assert facts.duration_min is not None and facts.duration_min < 5
            assert len(facts.metrics) <= 1


def test_the_saved_testset_is_the_seeded_one(testset: dict[str, Any]) -> None:
    saved = json.loads((LLM_DIR / "testset.json").read_text(encoding="utf-8"))
    assert saved == testset
    assert load("make_testset").make_testset() == testset


# run_eval


def run(module: ModuleType, tmp_path: Path, provider: MockProvider, *extra: str) -> int:
    code: int = module.main(
        ["--model", "qwen3.5:4b", "--split", "dev", "--out-dir", str(tmp_path), *extra],
        provider=provider,
    )
    return code


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_run_eval_on_three_cases_with_the_mock(tmp_path: Path, testset: dict[str, Any]) -> None:
    run_eval = load("run_eval")
    dev = [c for c in testset["cases"] if c["split"] == "dev"]
    provider = MockProvider(answers=[good_answer(case) for case in dev[:3]])
    assert run(run_eval, tmp_path, provider, "--limit", "3") == 0
    assert len(provider.calls) == 3  # one per case: each answer was valid

    stem = run_eval.output_stem("qwen3.5:4b", "dev", "v1")
    assert stem == "qwen3.5-4b_dev_v1"
    found = rows(tmp_path / f"{stem}.csv")
    assert [row["case_id"] for row in found] == [c["id"] for c in dev[:3]]
    for row in found:
        assert row["valid_first_try"] == "True" and row["fallback_used"] == "False"
        assert row["direction_errors"] == "0" and row["banned_hits"] == "0"
        assert row["suggestions_total"] == row["suggestions_valid"]
        assert row["coverage"] == "True"  # improving cases: the report names an improved measure
        assert int(row["patient_words"]) > 0
    summary = json.loads((tmp_path / f"{stem}_summary.json").read_text(encoding="utf-8"))
    assert summary["cases"] == 3
    assert summary["valid_first_try"] == 1.0 and summary["fallback_rate"] == 0.0
    assert summary["numeric_faithfulness"] in (None, 1.0)
    assert summary["failed_cases"] == []
    details = (tmp_path / f"{stem}.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(details) == 3 and json.loads(details[0])["answers"]
    assert "Valid at the first try: 100.0%" in (tmp_path / f"{stem}_summary.md").read_text(encoding="utf-8")


def test_run_eval_resumes_and_counts_failures(tmp_path: Path, testset: dict[str, Any]) -> None:
    run_eval = load("run_eval")
    dev = [c for c in testset["cases"] if c["split"] == "dev"]
    assert run(run_eval, tmp_path, MockProvider(answers=[good_answer(dev[0])]), "--limit", "1") == 0

    # The next run skips case 1; the mock's canned answer is not a report, so case 2 fails 3 times.
    bad = MockProvider()
    assert run(run_eval, tmp_path, bad, "--limit", "2") == 0
    assert len(bad.calls) == 3
    found = rows(tmp_path / "qwen3.5-4b_dev_v1.csv")
    assert [row["case_id"] for row in found] == [dev[0]["id"], dev[1]["id"]]
    second = found[1]
    assert second["fallback_used"] == "True" and second["retries"] == "2"
    assert second["valid_first_try"] == "False" and second["coverage"] == ""
    summary = json.loads((tmp_path / "qwen3.5-4b_dev_v1_summary.json").read_text(encoding="utf-8"))
    assert summary["fallback_rate"] == 0.5
    assert [item["case_id"] for item in summary["failed_cases"]] == [dev[1]["id"]]


def test_errors_are_sorted_into_kinds() -> None:
    kind = load("run_eval").error_kind
    assert kind("patient_summary: the number 37 is not in SESSION_FACTS. Use only numbers given.") == "numeric"
    assert kind('patient_summary: "better" describes an improvement of G1, but its mdc_status is x.') == "direction"
    assert kind("highlights[0].text: G1 did not improve (mdc_status x).") == "direction"
    assert kind('patient_summary: "cure" is not allowed.') == "banned"
    assert kind('patient_summary: "pain" is not allowed. The app shows its own safety notice; do not') == "leakage"
    assert kind("suggestions: LEVEL_UP is not in CANDIDATE_SUGGESTIONS (A).") == "suggestion_id"
    assert kind("The answer is not valid JSON. Output only the JSON object.") == "json"
    assert kind("therapist_summary: must be written in English.") == "script"
    assert kind("language: must be \"en\".") == "schema"


# compare_models


def test_compare_models_writes_the_choice_page(tmp_path: Path) -> None:
    compare = load("compare_models")
    doc = tmp_path / "llm-model-choice.md"
    argv = ["--models", "qwen3.5:4b,phi4-mini", "--limit", "1", "--out-dir", str(tmp_path), "--doc", str(doc)]
    assert compare.main(argv, provider=MockProvider()) == 0
    text = doc.read_text(encoding="utf-8")
    assert "| Measure | qwen3.5:4b | phi4-mini |" in text
    for label in ("Valid at the first try", "Numeric faithfulness", "Direction errors", "Banned words",
                  "Template used", "p50 latency (s)", "p95 latency (s)", "Writing speed"):
        assert f"| {label}" in text
    assert "about 50% CPU / 50% GPU" in text
    assert "≥ 95%" in text and "≤ 30 s" in text
    # The mock never writes a valid report: every case used the template.
    assert "| Template used | 100.0% ✗ | 100.0% ✗ |" in text
    assert text.rstrip().endswith("## Decision")

    # --no-run rewrites the page from the saved results; a model never run says so.
    assert compare.main([*argv[:1], "qwen3.5:4b,qwen3.5:2b", *argv[2:], "--no-run"]) == 0
    assert "not run" in doc.read_text(encoding="utf-8")


def test_writing_rates_come_from_the_speed_test(tmp_path: Path) -> None:
    compare = load("compare_models")
    speed = tmp_path / "speed.csv"
    speed.write_text(
        "model,kind,run,gen_rate_tps\nqwen3.5:4b,long,1,18\nqwen3.5:4b,long,2,20\nqwen3.5:4b,short,1,40\n",
        encoding="utf-8",
    )
    assert compare.writing_rates(speed) == {"qwen3.5:4b": 19.0}
    assert compare.writing_rates(tmp_path / "missing.csv") == {}
