"""Evaluate every candidate model on the dev split and write docs/llm-model-choice.md.

Run from the repository root, with the Ollama app running:

    server\\.venv\\Scripts\\python.exe analysis\\llm\\compare_models.py
    server\\.venv\\Scripts\\python.exe analysis\\llm\\compare_models.py --limit 10
    server\\.venv\\Scripts\\python.exe analysis\\llm\\compare_models.py --no-run   (rewrite the page from saved results)

Runs run_eval.py for each model of LLM_MODELS_CANDIDATES (a stopped run resumes), then writes
the comparison table against the targets, with each model's writing speed from speed.csv when
it exists. The Decision section is left for you to fill in.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "server"))

import run_eval  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.feedback.llm import LLMProvider  # noqa: E402
from app.feedback.prompt import PROMPT_VERSION  # noqa: E402

DOC = ROOT / "docs" / "llm-model-choice.md"
SPEED = HERE / "speed.csv"

#: How each model runs on the project laptop (RTX 3050, 4 GB), from `ollama ps`.
HARDWARE_NOTES = {
    "qwen3.5:4b": "about 50% CPU / 50% GPU (does not fit in 4 GB)",
    "qwen3.5:2b": "fits on the GPU",
    "phi4-mini": "fits on the GPU",
}

#: (summary key, label, target, how it is met)
TARGETS: list[tuple[str, str, float, str]] = [
    ("valid_first_try", "Valid at the first try", 0.95, "min"),
    ("numeric_faithfulness", "Numeric faithfulness", 0.99, "min"),
    ("direction_errors", "Direction errors", 0, "max"),
    ("banned_hits", "Banned words", 0, "max"),
    ("fallback_rate", "Template used", 0.05, "max"),
    ("latency_p95_s", "p95 latency (s)", 30, "max"),
]
PERCENT_KEYS = {"valid_first_try", "final_valid", "numeric_faithfulness", "fallback_rate", "suggestion_validity", "coverage"}


def writing_rates(path: Path = SPEED) -> dict[str, float]:
    """Median writing rate (tokens/s) of the long prompt per model, from the speed test."""
    if not path.exists():
        return {}
    rates: dict[str, list[float]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("kind") == "long" and row.get("gen_rate_tps"):
                rates.setdefault(row["model"], []).append(float(row["gen_rate_tps"]))
    return {model: round(statistics.median(values), 1) for model, values in rates.items()}


def _cell(key: str, value: Any) -> str:
    if value is None:
        return "-"
    if key in PERCENT_KEYS:
        return f"{100 * value:.1f}%"
    return str(value)


def _meets(key: str, value: Any) -> str:
    for target_key, _, target, how in TARGETS:
        if target_key == key and value is not None:
            ok = value >= target if how == "min" else value <= target
            return " ✓" if ok else " ✗"
    return ""


def render(summaries: dict[str, dict[str, Any] | None], split: str, prompt_version: str, limit: int | None) -> str:
    rates = writing_rates()
    models = list(summaries)
    rows = [
        ("cases", "Cases"),
        ("valid_first_try", "Valid at the first try"),
        ("final_valid", "Valid in the end (no template)"),
        ("numeric_faithfulness", "Numeric faithfulness"),
        ("direction_errors", "Direction errors"),
        ("banned_hits", "Banned words"),
        ("leakage_hits", "Safety leaks"),
        ("suggestion_validity", "Suggestion ids valid"),
        ("coverage", "Mentions an improved measure"),
        ("fallback_rate", "Template used"),
        ("latency_p50_s", "p50 latency (s)"),
        ("latency_p95_s", "p95 latency (s)"),
        ("mean_prompt_tokens", "Prompt tokens per case"),
        ("mean_output_tokens", "Output tokens per case"),
    ]
    lines = [
        "# Choosing the feedback model",
        "",
        "Each candidate local model (Ollama) writes the feedback for the same synthetic sessions "
        f"(`analysis/llm/testset.json`, split `{split}`{f', first {limit} cases' if limit else ''}) "
        f"with prompt `{prompt_version}`. The full pipeline runs: validator, up to two retries, "
        "and the template. Every answer the model wrote is checked, not only the final report. "
        "Made by `analysis/llm/compare_models.py`; per-case results are in `analysis/llm/results/`.",
        "",
        "## Targets",
        "",
        "| Measure | Target |",
        "| --- | --- |",
        "| Valid at the first try | ≥ 95% |",
        "| Numeric faithfulness (numbers found in the facts) | ≥ 99% |",
        "| Direction errors (improved/worse words against `mdc_status`) | 0 |",
        "| Banned words | 0 |",
        "| Template used (fallback) | ≤ 5% |",
        "| p95 latency per report | ≤ 30 s |",
        "",
        "## Results",
        "",
        "| Measure | " + " | ".join(models) + " |",
        "| --- |" + " --- |" * len(models),
    ]
    for key, label in rows:
        cells = []
        for model in models:
            summary = summaries[model]
            value = None if summary is None else summary.get(key)
            cells.append("not run" if summary is None else _cell(key, value) + _meets(key, value))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    lines.append(
        "| Writing speed (tokens/s, speed test) | "
        + " | ".join(str(rates.get(model, "-")) for model in models)
        + " |"
    )
    lines.append(
        "| CPU/GPU on the 4 GB RTX 3050 | "
        + " | ".join(HARDWARE_NOTES.get(model, "-") for model in models)
        + " |"
    )
    lines += [
        "",
        "✓ meets the target, ✗ misses it. Safety leaks and every other failure are caught by the "
        "validator, so the patient never sees them: they cost a retry or the template.",
        "",
        "## Decision",
        "",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None, provider: LLMProvider | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare the candidate models on the dev split.")
    parser.add_argument("--models", help="comma-separated; default LLM_MODELS_CANDIDATES")
    parser.add_argument("--split", choices=["dev", "held_out"], default="dev")
    parser.add_argument("--prompt", default=PROMPT_VERSION)
    parser.add_argument("--limit", type=int, help="only the first N cases of the split")
    parser.add_argument("--no-run", action="store_true", help="only rewrite the page from saved results")
    parser.add_argument("--out-dir", type=Path, default=run_eval.RESULTS)
    parser.add_argument("--doc", type=Path, default=DOC)
    args = parser.parse_args(argv)
    models = [m.strip() for m in args.models.split(",")] if args.models else settings.llm_candidates

    summaries: dict[str, dict[str, Any] | None] = {}
    for model in models:
        if not args.no_run:
            print(f"\n=== {model} ===", flush=True)
            run_argv = ["--model", model, "--split", args.split, "--prompt", args.prompt, "--out-dir", str(args.out_dir)]
            if args.limit:
                run_argv += ["--limit", str(args.limit)]
            if run_eval.main(run_argv, provider=provider) != 0:
                print(f"{model}: skipped.")
        path = args.out_dir / f"{run_eval.output_stem(model, args.split, args.prompt)}_summary.json"
        summaries[model] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    args.doc.parent.mkdir(parents=True, exist_ok=True)
    args.doc.write_text(render(summaries, args.split, args.prompt, args.limit), encoding="utf-8")
    print(f"\nWrote {args.doc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
