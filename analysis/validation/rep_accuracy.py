"""Rep-count accuracy (Day 19): a guided landmark recording played through the warm-up's own
repetition counters, against the repetitions the guide asked for in each step.

    server\\.venv\\Scripts\\python.exe analysis\\validation\\rep_accuracy.py
    server\\.venv\\Scripts\\python.exe analysis\\validation\\rep_accuracy.py --recording my.json --side left

The counting is the app's code, not a copy: web/scripts/export-rep-counts.mjs runs
src/testing/repReplay.ts (MotionMeasurer, frameForExercise, createCounter, standard preset),
whose own Vitest test checks it against scripted movements with known counts. The scripted
counts come from the recording's step markers (/dev/record-guide). Writes
analysis/validation/rep_accuracy.csv, which run_validation.py reads.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
DEFAULT_RECORDING = WEB / "public" / "test-fixtures" / "landmarks" / "shadik_full.json"
OUT = ROOT / "analysis" / "validation" / "rep_accuracy.csv"
FIELDS = [
    "marker", "exercise", "scripted", "counted", "partial", "error", "frames", "frames_with_measure",
    "min_value", "max_value", "low", "high", "recording",
]


def _round(value: object) -> object:
    return round(float(value), 2) if isinstance(value, (int, float)) else ""


def export_counts(recording: Path, side: str) -> list[dict[str, object]]:
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Node.js is needed (it runs the app's own counters).")
    result = subprocess.run(
        [node, "scripts/export-rep-counts.mjs", str(recording), side],
        cwd=WEB,
        capture_output=True,
        text=True,
        check=False,
        stdin=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        raise SystemExit(f"The exporter failed:\n{result.stderr}")
    return json.loads(result.stdout.strip().splitlines()[-1])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--recording", type=Path, default=DEFAULT_RECORDING)
    # shadik_full.json: the right arm is affected (the tracked hand is at the right wrist).
    parser.add_argument("--side", choices=["left", "right"], default="right")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)

    rows = export_counts(args.recording, args.side)
    if not rows:
        print("The recording has no guided step markers to compare.")
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "marker": row["marker"],
                    "exercise": row["exercise"],
                    "scripted": row["scripted"],
                    "counted": row["counted"],
                    "partial": row["partial"],
                    "error": int(row["counted"]) - int(row["scripted"]),  # type: ignore[call-overload]
                    "frames": row["frames"],
                    "frames_with_measure": row["framesWithMeasure"],
                    "min_value": _round(row["minValue"]),
                    "max_value": _round(row["maxValue"]),
                    "low": row["low"],
                    "high": row["high"],
                    "recording": args.recording.name,
                }
            )
    print(f"{'Step':18} {'Exercise':20} {'Scripted':>8} {'Counted':>8} {'Error':>6}   measured range  (thresholds)")
    for row in rows:
        error = int(row["counted"]) - int(row["scripted"])  # type: ignore[call-overload]
        span = f"{_round(row['minValue'])} to {_round(row['maxValue'])}  ({row['low']} / {row['high']})"
        print(f"{row['marker']:18} {row['exercise']:20} {row['scripted']:>8} {row['counted']:>8} {error:>+6}   {span}")
    total_scripted = sum(int(row["scripted"]) for row in rows)  # type: ignore[call-overload]
    total_error = sum(abs(int(row["counted"]) - int(row["scripted"])) for row in rows)  # type: ignore[call-overload]
    print(f"\nAbsolute error {total_error} of {total_scripted} scripted repetitions. Saved {args.out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
