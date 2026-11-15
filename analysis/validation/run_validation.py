"""The validation analysis (Day 19): reads the single-person validation data and writes the
results, tables and figures.

    server\\.venv\\Scripts\\python.exe analysis\\validation\\run_validation.py
    server\\.venv\\Scripts\\python.exe analysis\\validation\\run_validation.py --demo   (tests only)

Inputs, in analysis/validation/ (any may be missing: its section is then PENDING):
- latency_manual.csv     trial, latency_ms          (phone slow-motion video of /dev/latency)
- latency_software.csv   the /dev/latency download   (frame, detect_ms, render_ms, total_ms, ...)
- angles.csv             the /dev/angle-validation download
                         (joint, reference_deg, mp3d_deg, mp2d_deg, visibility, timestamp)
- repeatability.csv      the admin's repeatability export (visit, metric_id, value)
- rep_accuracy.csv       rep_accuracy.py's output

Outputs, in analysis/results/validation/: summary.json (every number, with each input's
checksum and row count), a CSV and Markdown table per section, figures as PNG (300 dpi) and
SVG in the Okabe-Ito colour-blind-safe palette, and mdc.json (the smallest detectable change
per measure) from real data only. --demo writes made-up data's results to a separate
validation_demo/ folder, every file labelled "DEMO — SYNTHETIC"; it is for the tests, never
for the thesis.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import subprocess
import sys
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import stats  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "analysis" / "validation"
OUT = ROOT / "analysis" / "results" / "validation"
DEMO_OUT = ROOT / "analysis" / "results" / "validation_demo"
DEMO_LABEL = "DEMO — SYNTHETIC"

# Okabe-Ito: distinguishable with every common colour-vision deficiency.
COLOURS = {"blue": "#0072B2", "orange": "#E69F00", "green": "#009E73", "vermillion": "#D55E00", "grey": "#999999"}

Rows = list[dict[str, str]]


# ---------------------------------------------------------------------------------------------
# Reading


def read_csv(path: Path) -> Rows | None:
    if not path.exists():
        return None
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = [dict(row) for row in csv.DictReader(handle)]
    return rows or None


def number(value: str | None) -> float | None:
    try:
        result = float(value) if value not in (None, "") else None
    except ValueError:
        return None
    return result if result is not None and math.isfinite(result) else None


def provenance(path: Path, rows: Rows | None) -> dict[str, Any]:
    if rows is None:
        return {"file": path.name, "present": False}
    return {
        "file": path.name,
        "present": True,
        "rows": len(rows),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None,
    }


def git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True,
            check=False, stdin=subprocess.DEVNULL, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


# ---------------------------------------------------------------------------------------------
# Sections: each returns (status, results, table rows); PENDING when the data is not there yet.

Section = tuple[str, dict[str, Any], list[dict[str, Any]]]


def pending(reason: str) -> Section:
    return "PENDING", {"reason": reason}, []


def latency_section(manual: Rows | None, software: Rows | None) -> Section:
    if manual is None and software is None:
        return pending("No latency_manual.csv or latency_software.csv yet (see /dev/latency).")
    results: dict[str, Any] = {}
    table: list[dict[str, Any]] = []
    if manual is not None:
        values = [v for v in (number(row.get("latency_ms")) for row in manual) if v is not None]
        if values:
            results["manual_end_to_end_ms"] = stats.summary(values)
            table.append({"measure": "End to end (slow-motion video)", **results["manual_end_to_end_ms"]})
    if software is not None:
        for column, label in [("detect_ms", "Frame to landmarks"), ("render_ms", "Landmarks to screen"), ("total_ms", "Frame to screen (software)")]:
            values = [v for v in (number(row.get(column)) for row in software) if v is not None]
            if values:
                results[column] = stats.summary(values)
                table.append({"measure": label, **results[column]})
    if not table:
        return pending("The latency files have no usable numbers.")
    return "DONE", results, table


def angles_section(rows: Rows | None) -> Section:
    if rows is None:
        return pending("No angles.csv yet (see /dev/angle-validation).")
    by_joint: dict[str, dict[str, list[tuple[float, float]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        reference = number(row.get("reference_deg"))
        if reference is None:
            continue
        for method, column in (("3D", "mp3d_deg"), ("2D", "mp2d_deg")):
            measured = number(row.get(column))
            if measured is not None:
                by_joint[row.get("joint", "?")][method].append((measured, reference))
    results: dict[str, Any] = {}
    table: list[dict[str, Any]] = []
    for joint, methods in sorted(by_joint.items()):
        for method, pairs in sorted(methods.items()):
            measured = [m for m, _ in pairs]
            reference = [r for _, r in pairs]
            agreement = stats.bland_altman(measured, reference)
            row = {"joint": joint, "method": method, "n": len(pairs), "rmse_deg": stats.rmse(measured, reference),
                   "bias_deg": agreement["bias"], "loa_low_deg": agreement["loa_low"], "loa_high_deg": agreement["loa_high"]}
            results.setdefault(joint, {})[method] = row
            table.append(row)
    if not table:
        return pending("angles.csv has no rows with a reference angle and a measured angle.")
    return "DONE", {"by_joint": results, "pairs": {j: {m: p for m, p in ms.items()} for j, ms in by_joint.items()}}, table


def repeatability_section(rows: Rows | None) -> Section:
    if rows is None:
        return pending("No repeatability.csv yet (Admin > patient > Repeatability visit, 3 visits).")
    by_metric: dict[str, dict[int, float]] = defaultdict(dict)
    for row in rows:
        value = number(row.get("value"))
        visit = number(row.get("visit"))
        if value is None or visit is None:
            continue
        by_metric[row.get("metric_id", "?")][int(visit)] = value
    results: dict[str, Any] = {}
    table: list[dict[str, Any]] = []
    for metric, visits in sorted(by_metric.items()):
        values = [visits[v] for v in sorted(visits)]
        if len(values) < 2:
            continue
        groups = {"participant": values}
        sem = stats.sem(groups)
        mean = sum(values) / len(values)
        row = {"metric_id": metric, "visits": len(values), "mean": mean, "within_sd": stats.within_subject_sd(groups),
               "sem": sem, "mdc95": stats.mdc95(sem), "cv_percent": stats.cv_percent(groups) if mean else None,
               "icc_2_1": stats.icc_2_1([values])}
        results[metric] = row
        table.append(row)
    if not table:
        return pending("repeatability.csv needs each measure at two or more visits.")
    return "DONE", results, table


def rep_accuracy_section(rows: Rows | None) -> Section:
    if rows is None:
        return pending("No rep_accuracy.csv yet (run rep_accuracy.py).")
    table: list[dict[str, Any]] = []
    for row in rows:
        scripted = number(row.get("scripted"))
        counted = number(row.get("counted"))
        if scripted is None or counted is None or scripted <= 0:
            continue
        table.append({"exercise": row.get("exercise", "?"), "scripted": int(scripted), "counted": int(counted),
                      "error": int(counted - scripted), "accuracy_percent": 100 * max(0.0, 1 - abs(counted - scripted) / scripted),
                      "min_value": number(row.get("min_value")), "max_value": number(row.get("max_value")),
                      "low": number(row.get("low")), "high": number(row.get("high"))})
    if not table:
        return pending("rep_accuracy.csv has no usable rows.")
    scripted_total = sum(row["scripted"] for row in table)
    errors = sum(abs(row["error"]) for row in table)
    return "DONE", {"by_exercise": table, "scripted_total": scripted_total, "absolute_error_total": errors,
                    "overall_accuracy_percent": 100 * max(0.0, 1 - errors / scripted_total)}, table


# ---------------------------------------------------------------------------------------------
# Writing


def write_table(out: Path, name: str, table: list[dict[str, Any]], label: str | None) -> None:
    if not table:
        return
    columns = list(table[0].keys())
    with (out / f"{name}.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(table)

    def cell(value: Any) -> str:
        return f"{value:.2f}" if isinstance(value, float) else str(value)

    lines = ([f"**{label}**", ""] if label else []) + [
        "| " + " | ".join(columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
        *("| " + " | ".join(cell(row[c]) for c in columns) + " |" for row in table),
    ]
    (out / f"{name}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def figure(out: Path, name: str, draw: Callable[[Any], None], label: str | None) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axis = plt.subplots(figsize=(6.4, 4.2))
    draw(axis)
    if label:
        fig.suptitle(label, color=COLOURS["vermillion"], fontweight="bold")
    fig.tight_layout()
    fig.savefig(out / f"{name}.png", dpi=300)
    fig.savefig(out / f"{name}.svg")
    plt.close(fig)


def plots(out: Path, sections: dict[str, Section], label: str | None) -> list[str]:
    made: list[str] = []
    status, results, _ = sections["angles"]
    if status == "DONE":
        def draw_angles(axis: Any) -> None:
            markers = {"3D": ("o", COLOURS["blue"]), "2D": ("s", COLOURS["orange"])}
            for joint, methods in results["pairs"].items():
                for method, pairs in methods.items():
                    marker, colour = markers[method]
                    means = [(m + r) / 2 for m, r in pairs]
                    diffs = [m - r for m, r in pairs]
                    axis.scatter(means, diffs, marker=marker, color=colour, alpha=0.8, label=f"{joint} {method}")
                    agreement = stats.bland_altman([m for m, _ in pairs], [r for _, r in pairs])
                    for value, style in ((agreement["bias"], "-"), (agreement["loa_low"], "--"), (agreement["loa_high"], "--")):
                        axis.axhline(value, color=colour, linestyle=style, linewidth=0.8)
            axis.axhline(0, color=COLOURS["grey"], linewidth=0.6)
            axis.set_xlabel("Mean of MediaPipe and reference (deg)")
            axis.set_ylabel("MediaPipe − reference (deg)")
            axis.set_title("Joint angles: Bland–Altman (bias, 95% limits)")
            axis.legend(fontsize=7)
        figure(out, "angles_bland_altman", draw_angles, label)
        made.append("angles_bland_altman")

    status, _, table = sections["latency"]
    if status == "DONE":
        def draw_latency(axis: Any) -> None:
            names = [row["measure"] for row in table]
            axis.barh(names, [row["mean"] for row in table], color=COLOURS["blue"], label="mean")
            axis.scatter([row["p95"] for row in table], names, color=COLOURS["vermillion"], zorder=3, label="p95")
            axis.set_xlabel("ms")
            axis.set_title("Latency")
            axis.legend(fontsize=8)
        figure(out, "latency", draw_latency, label)
        made.append("latency")

    status, _, table = sections["repeatability"]
    if status == "DONE":
        def draw_mdc(axis: Any) -> None:
            axis.barh([row["metric_id"] for row in table], [row["mdc95"] for row in table], color=COLOURS["green"])
            axis.set_xlabel("MDC95 (the measure's own unit)")
            axis.set_title("Smallest detectable change per measure")
        figure(out, "repeatability_mdc", draw_mdc, label)
        made.append("repeatability_mdc")

    status, _, table = sections["rep_accuracy"]
    if status == "DONE":
        def draw_reps(axis: Any) -> None:
            names = [row["exercise"] for row in table]
            positions = range(len(names))
            axis.bar([p - 0.2 for p in positions], [row["scripted"] for row in table], width=0.4, color=COLOURS["grey"], label="scripted")
            axis.bar([p + 0.2 for p in positions], [row["counted"] for row in table], width=0.4, color=COLOURS["blue"], label="counted")
            axis.set_xticks(list(positions), names, rotation=20, ha="right", fontsize=8)
            axis.set_ylabel("Repetitions")
            axis.set_title("Repetition counts against the script")
            axis.legend(fontsize=8)
        figure(out, "rep_accuracy", draw_reps, label)
        made.append("rep_accuracy")
    return made


def analyse(inputs: dict[str, Rows | None], paths: dict[str, Path], out: Path, label: str | None) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    sections: dict[str, Section] = {
        "latency": latency_section(inputs["latency_manual"], inputs["latency_software"]),
        "angles": angles_section(inputs["angles"]),
        "repeatability": repeatability_section(inputs["repeatability"]),
        "rep_accuracy": rep_accuracy_section(inputs["rep_accuracy"]),
    }
    for name, (_, _, table) in sections.items():
        write_table(out, name, table, label)
    figures = plots(out, sections, label)
    summary = {
        "label": label or "REAL DATA",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "inputs": {name: provenance(paths[name], rows) for name, rows in inputs.items()},
        "sections": {
            name: {"status": status, **({"results": results} if status == "DONE" else results)}
            for name, (status, results, _) in sections.items()
        },
        "figures": [f"{name}.png" for name in figures] + [f"{name}.svg" for name in figures],
    }
    # The paired values are only for the figures.
    angles = summary["sections"]["angles"]
    if angles["status"] == "DONE":
        angles["results"] = angles["results"]["by_joint"]
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    status, results, _ = sections["repeatability"]
    mdc = {
        "label": label or "REAL DATA",
        "generated_at": summary["generated_at"],
        "source": summary["inputs"]["repeatability"],
        "metrics": {metric: {"mdc95": row["mdc95"], "sem": row["sem"], "visits": row["visits"], "participants": 1}
                    for metric, row in (results.items() if status == "DONE" else [])},
    }
    (out / "mdc.json").write_text(json.dumps(mdc, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


FILES = {
    "latency_manual": "latency_manual.csv",
    "latency_software": "latency_software.csv",
    "angles": "angles.csv",
    "repeatability": "repeatability.csv",
    "rep_accuracy": "rep_accuracy.csv",
}


def demo_inputs() -> dict[str, Rows]:
    """Made-up data with known properties, for the tests only."""
    rng = random.Random(19)
    angles: Rows = []
    for joint in ("elbow", "shoulder_flexion", "shoulder_abduction"):
        for reference in range(20, 160, 20):
            angles.append({"joint": joint, "reference_deg": str(reference), "mp3d_deg": f"{reference + rng.gauss(2, 4):.2f}",
                           "mp2d_deg": f"{reference + rng.gauss(-5, 7):.2f}", "visibility": "0.95", "timestamp": "2026-11-17T10:00:00Z"})
    repeat: Rows = [{"visit": str(v), "metric_id": m, "value": f"{base + rng.gauss(0, base * 0.05):.3f}"}
                    for m, base in (("W1", 95.0), ("K1", 0.62), ("C1", 2.1)) for v in (1, 2, 3)]
    return {
        "latency_manual": [{"trial": str(i), "latency_ms": f"{rng.gauss(140, 15):.1f}"} for i in range(1, 21)],
        "latency_software": [{"frame": str(i), "detect_ms": f"{rng.gauss(22, 3):.2f}", "render_ms": f"{rng.gauss(4, 1):.2f}",
                              "total_ms": f"{rng.gauss(26, 3.5):.2f}"} for i in range(300)],
        "angles": angles,
        "repeatability": repeat,
        "rep_accuracy": [{"exercise": e, "scripted": str(s), "counted": str(c)}
                         for e, s, c in (("shoulder_flexion", 10, 10), ("elbow_flexion", 10, 9), ("hand_open_close", 10, 10))],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--input", type=Path, default=INPUT)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--demo", action="store_true", help="synthetic data, to validation_demo/ (tests only)")
    parser.add_argument("--demo-out", type=Path, default=DEMO_OUT)
    args = parser.parse_args(argv)
    # Any console (Windows' cp1252 too): a character it cannot show is replaced, never fatal.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    paths = {name: args.input / file for name, file in FILES.items()}
    if args.demo:
        summary = analyse(demo_inputs(), paths, args.demo_out, DEMO_LABEL)
        out = args.demo_out
    else:
        inputs = {name: read_csv(path) for name, path in paths.items()}
        summary = analyse(inputs, paths, args.out, None)
        out = args.out
    for name, section in summary["sections"].items():
        note = section.get("reason", "")
        print(f"{section['status']:8} {name:14} {note}")
    print(f"Saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
