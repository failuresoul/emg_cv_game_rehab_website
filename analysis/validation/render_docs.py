"""Fills the results of docs/validation.md and writes docs/results-summary.md from the result
files, so the documents never hold a number by hand (Day 19).

    server\\.venv\\Scripts\\python.exe analysis\\validation\\render_docs.py

- docs/validation.md: only the block between <!-- results:start --> and <!-- results:end --> is
  replaced; the protocol and limitations stay as written. A section without data says PENDING.
- docs/results-summary.md: every number with its label and source file:
  - pilot: the single-participant validation (analysis/results/validation/summary.json);
  - simulation: simulated patients (analysis/results/simulation/summary.csv);
  - engineering: performance (analysis/results/perf_*.json);
  - PENDING: not measured yet.
Never reads the demo folder.
"""

from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
VALIDATION = ROOT / "analysis" / "results" / "validation" / "summary.json"
SIMULATION = ROOT / "analysis" / "results" / "simulation" / "summary.csv"
PERF_API = ROOT / "analysis" / "results" / "perf_api.json"
PERF_FRAMES = ROOT / "analysis" / "results" / "perf_frames.json"
VALIDATION_DOC = ROOT / "docs" / "validation.md"
SUMMARY_DOC = ROOT / "docs" / "results-summary.md"
START, END = "<!-- results:start -->", "<!-- results:end -->"


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def num(value: Any, digits: int = 2) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return f"{value:.{digits}f}"
    return str(value) if value is not None else "–"


def table(headers: list[str], rows: list[list[str]]) -> list[str]:
    return ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |",
            *("| " + " | ".join(row) + " |" for row in rows)]


def section(summary: dict[str, Any] | None, name: str) -> dict[str, Any] | None:
    if summary is None:
        return None
    found = summary.get("sections", {}).get(name)
    return found if isinstance(found, dict) and found.get("status") == "DONE" else None


def pending_reason(summary: dict[str, Any] | None, name: str) -> str:
    if summary is None:
        return f"no {rel(VALIDATION)} yet (run analysis/validation/run_validation.py)"
    found = summary.get("sections", {}).get(name, {})
    return str(found.get("reason", "no data yet"))


def validation_results(summary: dict[str, Any] | None) -> list[str]:
    src = rel(VALIDATION)
    lines: list[str] = []
    if summary is not None:
        lines += [f"From `{src}`, generated {summary.get('generated_at', '?')} (commit {summary.get('git_commit') or '?'}). "
                  "All values are **pilot** (n = 1, healthy).", ""]

    lines.append("### Latency")
    latency = section(summary, "latency")
    if latency:
        names = {"manual_end_to_end_ms": "End to end (slow-motion video)", "detect_ms": "Frame to landmarks",
                 "render_ms": "Landmarks to screen", "total_ms": "Frame to screen (software)"}
        rows = [[names.get(key, key), str(value["n"]), num(value["mean"], 1), num(value["sd"], 1), num(value["p50"], 1), num(value["p95"], 1)]
                for key, value in latency["results"].items()]
        lines += table(["Stage", "n", "Mean ms", "SD", "p50", "p95"], rows)
    else:
        lines.append(f"**PENDING**: {pending_reason(summary, 'latency')}")

    lines += ["", "### Joint angles"]
    angles = section(summary, "angles")
    if angles:
        rows = []
        for joint, methods in angles["results"].items():
            for method, row in methods.items():
                rows.append([joint, method, str(row["n"]), num(row["rmse_deg"], 1), num(row["bias_deg"], 1),
                             f"{num(row['loa_low_deg'], 1)} to {num(row['loa_high_deg'], 1)}"])
        lines += table(["Joint", "Method", "n", "RMSE°", "Bias°", "95% limits°"], rows)
        lines += ["", "Figure: `analysis/results/validation/angles_bland_altman.png` (.svg)."]
    else:
        lines.append(f"**PENDING**: {pending_reason(summary, 'angles')}")

    lines += ["", "### Repeatability"]
    repeat = section(summary, "repeatability")
    if repeat:
        rows = [[metric, str(row["visits"]), num(row["mean"], 3), num(row["sem"], 3), num(row["mdc95"], 3),
                 num(row["cv_percent"], 1), str(row["icc_2_1"])] for metric, row in repeat["results"].items()]
        lines += table(["Measure", "Visits", "Mean", "SEM", "MDC95", "CV%", "ICC(2,1)"], rows)
    else:
        lines.append(f"**PENDING**: {pending_reason(summary, 'repeatability')}")

    lines += ["", "### Repetition counting"]
    reps = section(summary, "rep_accuracy")
    if reps:
        rows = [[row["exercise"], str(row["scripted"]), str(row["counted"]), f"{row['error']:+d}", num(row["accuracy_percent"], 0),
                 f"{num(row.get('min_value'))} to {num(row.get('max_value'))}", f"{num(row.get('low'))} / {num(row.get('high'))}"]
                for row in reps["results"]["by_exercise"]]
        lines += table(["Exercise", "Scripted", "Counted", "Error", "Accuracy %", "Measured range", "Rest / target"], rows)
        lines += ["", f"Overall: {num(reps['results']['overall_accuracy_percent'], 0)}% "
                      f"({reps['results']['absolute_error_total']} wrong of {reps['results']['scripted_total']} scripted)."]
    else:
        lines.append(f"**PENDING**: {pending_reason(summary, 'rep_accuracy')}")
    return lines


def results_summary(summary: dict[str, Any] | None) -> list[str]:
    lines = ["# Results summary", "",
             "Generated by `analysis/validation/render_docs.py`; do not edit by hand. Each number has a label and its source:",
             "", "- **pilot**: one healthy participant (technical validation);",
             "- **simulation**: simulated patients, not people;",
             "- **engineering**: the software on the development laptop;",
             "- **PENDING**: not measured yet.", ""]
    rows: list[list[str]] = []
    src = rel(VALIDATION)
    latency = section(summary, "latency")
    if latency and "manual_end_to_end_ms" in latency["results"]:
        value = latency["results"]["manual_end_to_end_ms"]
        rows.append(["End-to-end latency, mean (p95)", f"{num(value['mean'], 0)} ms ({num(value['p95'], 0)})", "pilot", src])
    else:
        rows.append(["End-to-end latency", "PENDING", "PENDING", src])
    angles = section(summary, "angles")
    if angles:
        for joint, methods in angles["results"].items():
            for method, row in methods.items():
                rows.append([f"Angle RMSE, {joint} ({method})", f"{num(row['rmse_deg'], 1)}°", "pilot", src])
    else:
        rows.append(["Joint angle RMSE and limits of agreement", "PENDING", "PENDING", src])
    repeat = section(summary, "repeatability")
    if repeat:
        for metric, row in repeat["results"].items():
            rows.append([f"MDC95, {metric}", num(row["mdc95"], 3), "pilot", src])
    else:
        rows.append(["MDC95 per measure", "PENDING", "PENDING", src])
    reps = section(summary, "rep_accuracy")
    if reps:
        rows.append(["Repetition counting accuracy (guided recording)", f"{num(reps['results']['overall_accuracy_percent'], 0)}%", "pilot", src])
    else:
        rows.append(["Repetition counting accuracy", "PENDING", "PENDING", src])

    if SIMULATION.exists():
        with SIMULATION.open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                if row["game"] == "reach_activate" and row["measure"] in ("success_rate", "challenge_error"):
                    rows.append([f"Reach and squeeze, {row['profile']}, {row['engine']}: {row['measure'].replace('_', ' ')}",
                                 f"{float(row['mean']):.3f} [{float(row['ci_low']):.3f}, {float(row['ci_high']):.3f}]", "simulation", rel(SIMULATION)])
    else:
        rows.append(["Engine comparison (simulation)", "PENDING", "PENDING", rel(SIMULATION)])

    api = load_json(PERF_API)
    if api:
        for engine, row in api.get("engine_next", {}).items():
            rows.append([f"`/api/engine/next` p95 ({engine})", f"{num(row['p95_ms'], 1)} ms", "engineering", rel(PERF_API)])
        load = api.get("load", {})
        if load:
            rows.append([f"Load test, {load.get('patients')} patients × {num(load.get('seconds'), 0)} s",
                         f"{load.get('errors')} errors in {load.get('all', {}).get('n')} requests; p95 {num(load.get('all', {}).get('p95_ms'), 0)} ms",
                         "engineering", rel(PERF_API)])
    else:
        rows.append(["API performance", "PENDING", "PENDING", rel(PERF_API)])
    frames = load_json(PERF_FRAMES)
    if frames:
        fps = [value["fps"] for value in frames.values()]
        p95 = [value["p95Ms"] for value in frames.values()]
        rows.append([f"Game loop, {len(frames)} games on replay", f"{min(fps):.0f}–{max(fps):.0f} FPS; p95 frame time ≤ {max(p95):.1f} ms",
                     "engineering", rel(PERF_FRAMES)])
    else:
        rows.append(["Frame budget", "PENDING", "PENDING", rel(PERF_FRAMES)])
    rows.append(["LLM report evaluation (automatic and blind human)", "PENDING", "PENDING", "docs/llm-evaluation.md"])
    rows.append(["Usability (SUS)", "PENDING", "PENDING", "Day 19 usability test"])
    rows.append(["EMG hardware validation", "PENDING", "PENDING", "docs/emg-hardware-test.md (Day 21)"])
    lines += table(["Result", "Value", "Label", "Source"], rows)
    return lines


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    summary = load_json(VALIDATION)
    if summary is not None and summary.get("label") != "REAL DATA":
        print(f"{rel(VALIDATION)} is not real data ({summary.get('label')}); treated as missing.")
        summary = None
    text = VALIDATION_DOC.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print(f"{rel(VALIDATION_DOC)} has no results markers; nothing changed.")
        return 1
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    VALIDATION_DOC.write_text(before + START + "\n" + "\n".join(validation_results(summary)) + "\n" + END + after, encoding="utf-8")
    SUMMARY_DOC.write_text("\n".join(results_summary(summary)) + "\n", encoding="utf-8")
    print(f"Updated {rel(VALIDATION_DOC)} and {rel(SUMMARY_DOC)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
