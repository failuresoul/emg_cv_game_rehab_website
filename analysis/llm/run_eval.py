"""Evaluate one model on the feedback test set.

Run from the repository root, with the Ollama app running:

    server\\.venv\\Scripts\\python.exe analysis\\llm\\run_eval.py --model qwen3.5:4b --split dev
    server\\.venv\\Scripts\\python.exe analysis\\llm\\run_eval.py --model qwen3.5:2b --split dev --limit 10

Each case runs the real pipeline (generate_report_from_facts: prompt, model, validator, up to two
retries, template). Every answer the model wrote is checked, not only the final report, since
the template always passes. Per case: valid at the first try, retries, template used, numeric
faithfulness, direction errors, banned words, safety leaks, suggestion validity, coverage of an
improved measure, patient word count, average sentence length, latency and tokens.

Writes analysis/llm/results/<model>_<split>_<prompt>.csv (one row per case, saved after every
case: a stopped run picks up where it left off), a .jsonl with every answer and error, and a
_summary.json and _summary.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app.core.config import settings  # noqa: E402
from app.feedback import prompt  # noqa: E402
from app.feedback.llm import LLMError, LLMProvider, LLMResult, OllamaProvider  # noqa: E402
from app.feedback.rules import candidates, red_flags  # noqa: E402
from app.feedback.service import generate_report_from_facts  # noqa: E402
from app.feedback.validate import (  # noqa: E402
    MAX_AVERAGE_SENTENCE_WORDS,
    fact_numbers,
    mention_patterns,
    number_is_known,
    numbers_in,
    words,
)
from app.schemas.metrics import SessionFacts  # noqa: E402

TESTSET = ROOT / "analysis" / "llm" / "testset.json"
RESULTS = ROOT / "analysis" / "llm" / "results"

#: Kinds of validator error, by the words of their message (first match wins).
ERROR_KINDS: list[tuple[str, re.Pattern[str]]] = [
    ("json", re.compile(r"not valid JSON|could not be read")),
    ("numeric", re.compile(r"is not in SESSION_FACTS")),
    ("direction", re.compile(r"describes an improvement|describes a worsening|did not improve|did not get worse")),
    ("leakage", re.compile(r"The app shows its own safety notice")),
    ("banned", re.compile(r'" is not allowed\.$')),
    ("suggestion_id", re.compile(r"CANDIDATE_SUGGESTIONS|each id may be used once")),
    ("length", re.compile(r"words; at most|sentences average")),
    ("script", re.compile(r"must be written in")),
]
COLUMNS = [
    "case_id", "category", "language", "model", "prompt_version", "valid_first_try", "final_valid", "retries", "fallback_used",
    "provider_error", "numbers_total", "numbers_known", "numeric_faithfulness", "direction_errors",
    "banned_hits", "leakage_hits", "suggestions_total", "suggestions_valid", "coverage",
    "patient_words", "avg_sentence_words", "latency_s", "prompt_tokens", "output_tokens",
    "first_errors",
]  # fmt: skip


def error_kind(error: str) -> str:
    for kind, pattern in ERROR_KINDS:
        if pattern.search(error):
            return kind
    return "schema"


class Recorder:
    """Wraps a provider and keeps every answer it gives, for checking the model's own writing."""

    def __init__(self, inner: LLMProvider) -> None:
        self.inner = inner
        self.name = getattr(inner, "name", "provider")
        self.model = getattr(inner, "model", "")
        self.answers: list[str] = []

    def generate(
        self, system: str, user: str, json_schema: dict[str, Any], model: str | None = None
    ) -> LLMResult:
        result = self.inner.generate(system, user, json_schema, model=model)
        self.answers.append(result.text)
        return result

    def health(self) -> Any:
        return self.inner.health()

    def warm_up(self, model: str | None = None) -> None:
        self.inner.warm_up(model)


def _texts(answer: dict[str, Any]) -> list[tuple[str, bool]]:
    """(text, is_patient_text) of an answer, however broken its shape."""
    found: list[tuple[str, bool]] = []
    for key in ("patient_summary", "next_session_text"):
        if isinstance(answer.get(key), str):
            found.append((answer[key], True))
    for key in ("highlights", "suggestions"):
        for item in answer.get(key) or []:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                found.append((item["text"], True))
    if isinstance(answer.get("therapist_summary"), str):
        found.append((answer["therapist_summary"], False))
    return found


def _parse(text: str) -> dict[str, Any] | None:
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _coverage(answer: dict[str, Any], facts: SessionFacts, language: str) -> bool | None:
    """Does the answer mention a measure that improved? None when none improved."""
    improved = {m.id for m in facts.metrics if m.mdc_status == "improved"}
    if not improved:
        return None
    if any(isinstance(h, dict) and h.get("metric_id") in improved for h in answer.get("highlights") or []):
        return True
    patient = " ".join(text for text, for_patient in _texts(answer) if for_patient)
    return any(
        pattern.search(patient)
        for metric_id in improved
        for pattern in mention_patterns(metric_id, language)  # type: ignore[arg-type]
    )


def _patient_style(answer: dict[str, Any]) -> tuple[int, float | None]:
    texts = [text for text, for_patient in _texts(answer) if for_patient]
    sentences = [words(part) for text in texts for part in re.split(r"[.!?।]+", text) if part.strip()]
    average = round(sum(sentences) / len(sentences), 1) if sentences else None
    return sum(words(text) for text in texts), average


def evaluate_case(
    case: dict[str, Any], provider: LLMProvider, model: str | None, prompt_version: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """One case: (its CSV row, its details for the .jsonl)."""
    facts = SessionFacts.model_validate(case["facts"])
    language = facts.language
    recorder = Recorder(provider)
    result = generate_report_from_facts(
        facts, language=language, model=model, provider=recorder, prompt_version=prompt_version
    )
    meta = result.meta
    seen = prompt.facts_seen(facts)
    known = list(fact_numbers(seen))
    candidate_ids = {c.id for c in candidates(facts)}

    numbers_total = numbers_known = suggestions_total = suggestions_valid = 0
    for text in recorder.answers:
        answer = _parse(text) or {}
        for written, _ in _texts(answer):
            for number in numbers_in(written):
                numbers_total += 1
                numbers_known += number_is_known(number, known)
        for item in answer.get("suggestions") or []:
            if isinstance(item, dict):
                suggestions_total += 1
                suggestions_valid += item.get("id") in candidate_ids
    kinds = [error_kind(error) for errors in meta.validation_errors for error in errors]

    # Style and coverage of the report the model wrote (the template's would say nothing).
    model_answer = None if meta.fallback_used else result.report.model_dump()
    patient_words, average = _patient_style(model_answer) if model_answer else (None, None)
    covered = None if model_answer is None else _coverage(model_answer, facts, language)
    row = {
        "case_id": case["id"],
        "category": case["category"],
        "language": language,
        # Stored with every result, so runs of different models and prompts never mix.
        "model": meta.model or "",
        "prompt_version": meta.prompt_version,
        "valid_first_try": not meta.fallback_used and meta.retries == 0,
        "final_valid": not meta.fallback_used,
        "retries": meta.retries,
        "fallback_used": meta.fallback_used,
        "provider_error": meta.provider_error or "",
        "numbers_total": numbers_total,
        "numbers_known": numbers_known,
        "numeric_faithfulness": round(numbers_known / numbers_total, 4) if numbers_total else "",
        "direction_errors": kinds.count("direction"),
        "banned_hits": kinds.count("banned"),
        "leakage_hits": kinds.count("leakage"),
        "suggestions_total": suggestions_total,
        "suggestions_valid": suggestions_valid,
        "coverage": "" if covered is None else covered,
        "patient_words": "" if patient_words is None else patient_words,
        "avg_sentence_words": "" if average is None else average,
        "latency_s": round(meta.latency_ms / 1000, 2),
        "prompt_tokens": meta.prompt_tokens,
        "output_tokens": meta.output_tokens,
        "first_errors": " | ".join(meta.validation_errors[0][:3]) if meta.validation_errors else "",
    }
    details = {
        "case_id": case["id"],
        "red_flags": [flag.code for flag in red_flags(facts)],
        "answers": recorder.answers,
        "validation_errors": meta.validation_errors,
        "final_report": result.report.model_dump(),
        "meta": meta.model_dump(),
    }
    return row, details


def _number(value: Any) -> float | None:
    if value in ("", None):
        return None
    if isinstance(value, bool):
        return float(value)
    if value in ("True", "False"):
        return 1.0 if value == "True" else 0.0
    return float(value)


def _percentile(values: list[float], share: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return round(ordered[index], 2)


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def mean(column: str) -> float | None:
        values = [v for v in (_number(row[column]) for row in rows) if v is not None]
        return round(statistics.fmean(values), 4) if values else None

    def total(column: str) -> int:
        return int(sum(_number(row[column]) or 0 for row in rows))

    latencies = [_number(row["latency_s"]) or 0.0 for row in rows if not row["provider_error"]]
    numbers = total("numbers_total")
    suggestions = total("suggestions_total")
    failed = [
        {"case_id": row["case_id"], "reason": row["provider_error"] or row["first_errors"] or "-"}
        for row in rows
        if _number(row["fallback_used"])
    ]
    worst = sorted(
        rows,
        key=lambda row: (
            -(_number(row["fallback_used"]) or 0),
            -(_number(row["retries"]) or 0),
            -(_number(row["latency_s"]) or 0),
        ),
    )[:5]
    return {
        "cases": len(rows),
        "valid_first_try": mean("valid_first_try"),
        "final_valid": mean("final_valid"),
        "fallback_rate": mean("fallback_used"),
        "mean_retries": mean("retries"),
        "numeric_faithfulness": round(total("numbers_known") / numbers, 4) if numbers else None,
        "direction_errors": total("direction_errors"),
        "banned_hits": total("banned_hits"),
        "leakage_hits": total("leakage_hits"),
        "suggestion_validity": round(total("suggestions_valid") / suggestions, 4) if suggestions else None,
        "coverage": mean("coverage"),
        "mean_patient_words": mean("patient_words"),
        "mean_sentence_words": mean("avg_sentence_words"),
        "latency_p50_s": _percentile(latencies, 0.5),
        "latency_p95_s": _percentile(latencies, 0.95),
        "mean_prompt_tokens": mean("prompt_tokens"),
        "mean_output_tokens": mean("output_tokens"),
        "provider_errors": sum(1 for row in rows if row["provider_error"]),
        "worst_cases": [
            {k: worst_row[k] for k in ("case_id", "retries", "fallback_used", "latency_s", "first_errors")}
            for worst_row in worst
        ],
        "failed_cases": failed,
    }


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{100 * value:.1f}%"


def summary_markdown(model: str, split: str, prompt_version: str, summary: dict[str, Any]) -> str:
    lines = [
        f"# {model} on {split} (prompt {prompt_version})",
        "",
        f"- Cases: {summary['cases']} (Ollama errors: {summary['provider_errors']})",
        f"- Valid at the first try: {_pct(summary['valid_first_try'])}",
        f"- Valid in the end (no template): {_pct(summary['final_valid'])}; template used: {_pct(summary['fallback_rate'])}",
        f"- Mean retries: {summary['mean_retries']}",
        f"- Numeric faithfulness: {_pct(summary['numeric_faithfulness'])}",
        f"- Direction errors: {summary['direction_errors']}; banned words: {summary['banned_hits']}; safety leaks: {summary['leakage_hits']}",
        f"- Suggestion ids valid: {_pct(summary['suggestion_validity'])}; mentions an improved measure: {_pct(summary['coverage'])}",
        f"- Patient text: {summary['mean_patient_words']} words, sentences of {summary['mean_sentence_words']} words on average (limit {MAX_AVERAGE_SENTENCE_WORDS})",
        f"- Latency per case: p50 {summary['latency_p50_s']} s, p95 {summary['latency_p95_s']} s",
        f"- Tokens per case: {summary['mean_prompt_tokens']} prompt, {summary['mean_output_tokens']} output",
        "",
        "## Worst cases",
        "",
        "| Case | Retries | Template | Seconds | First errors |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in summary["worst_cases"]:
        errors = str(row["first_errors"]).replace("|", "/")[:160] or "-"
        lines.append(f"| {row['case_id']} | {row['retries']} | {row['fallback_used']} | {row['latency_s']} | {errors} |")
    lines += ["", "## Cases that needed the template", ""]
    lines += [f"- {item['case_id']}: {str(item['reason'])[:200]}" for item in summary["failed_cases"]] or ["None."]
    return "\n".join(lines) + "\n"


def output_stem(model: str, split: str, prompt_version: str) -> str:
    safe_model = re.sub(r"[^A-Za-z0-9.-]+", "-", model)
    return f"{safe_model}_{split}_{prompt_version}"


def _read_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def main(argv: list[str] | None = None, provider: LLMProvider | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate one model on the feedback test set.")
    parser.add_argument("--model", default=settings.LLM_MODEL)
    parser.add_argument("--split", choices=["dev", "held_out"], default="dev")
    parser.add_argument("--prompt", default=prompt.PROMPT_VERSION, help="prompt version, such as v1")
    parser.add_argument("--limit", type=int, help="only the first N cases of the split")
    parser.add_argument("--testset", type=Path, default=TESTSET)
    parser.add_argument("--out-dir", type=Path, default=RESULTS)
    parser.add_argument("--restart", action="store_true", help="forget earlier results of this run")
    args = parser.parse_args(argv)

    if not (prompt.PROMPTS_DIR / f"system_{args.prompt}.txt").exists():
        print(f"There is no prompt {args.prompt} in {prompt.PROMPTS_DIR}.")
        return 1
    cases = [c for c in json.loads(args.testset.read_text(encoding="utf-8"))["cases"] if c["split"] == args.split]
    cases = cases[: args.limit] if args.limit else cases

    if provider is None:
        ollama = OllamaProvider(model=args.model, timeout_s=max(settings.LLM_TIMEOUT_S, 120))
        health = ollama.health()
        if not health.reachable:
            print(f"Ollama is not reachable at {ollama.url} ({health.error}). Start the Ollama app.")
            return 1
        if not any(args.model == n or f"{args.model}:latest" == n for n in health.models_available):
            print(f"{args.model} is not installed: ollama pull {args.model}")
            return 1
        provider = ollama
    try:
        print(f"Loading {args.model}...", flush=True)
        provider.warm_up(args.model)
    except LLMError as error:
        print(f"Could not load {args.model}: {error}")
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = output_stem(args.model, args.split, args.prompt)
    csv_path = args.out_dir / f"{stem}.csv"
    details_path = args.out_dir / f"{stem}.jsonl"
    if args.restart:
        for path in (csv_path, details_path):
            path.unlink(missing_ok=True)
    rows = _read_rows(csv_path)
    done = {row["case_id"] for row in rows}
    if done:
        print(f"Resuming: {len(done)} of {len(cases)} cases already done.")

    for number, case in enumerate(cases, start=1):
        if case["id"] in done:
            continue
        row, details = evaluate_case(case, provider, args.model, args.prompt)
        new_file = not csv_path.exists()
        with csv_path.open("a", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            if new_file:
                writer.writeheader()
            writer.writerow(row)
        with details_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(details, ensure_ascii=False) + "\n")
        rows.append({key: str(value) for key, value in row.items()})
        print(
            f"[{number}/{len(cases)}] {case['id']}: {row['latency_s']} s, retries {row['retries']}"
            + (", TEMPLATE" if row["fallback_used"] else "")
            + (f" ({row['provider_error'][:80]})" if row["provider_error"] else ""),
            flush=True,
        )

    wanted = {case["id"] for case in cases}
    rows = [row for row in rows if row["case_id"] in wanted]
    summary = summarise(rows)
    summary.update(model=args.model, split=args.split, prompt=args.prompt)
    (args.out_dir / f"{stem}_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    markdown = summary_markdown(args.model, args.split, args.prompt, summary)
    (args.out_dir / f"{stem}_summary.md").write_text(markdown, encoding="utf-8")
    print("\n" + markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
