"""analysis/run_simulation.py: the engine comparison runs end to end and writes its outputs."""

import csv
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "analysis" / "run_simulation.py"

pytest.importorskip("matplotlib")


def read(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_quick_run_writes_every_output(tmp_path: Path) -> None:
    out = tmp_path / "simulation"
    doc = tmp_path / "simulation-results.md"
    # --quick (20 patients), shortened further so the test stays fast.
    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--quick",
            "--sessions",
            "2",
            "--trials",
            "20",
            "--workers",
            "1",
            "--out",
            str(out),
            "--doc",
            str(doc),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        cwd=ROOT,
    )
    assert completed.returncode == 0, completed.stderr[-2000:]
    assert "Done in" in completed.stdout

    results = read(out / "results.csv")
    # 2 games x 3 profiles x 3 engines x 20 patients.
    assert len(results) == 2 * 3 * 3 * 20
    assert {row["engine"] for row in results} == {"L0", "L1", "L2"}
    assert {row["profile"] for row in results} == {"mild", "moderate", "severe"}
    for column in ("challenge_error", "time_in_zone", "compensation_rate", "coverage", "learning_gain"):
        assert column in results[0]

    summary = read(out / "summary.csv")
    challenge = [
        row
        for row in summary
        if row["game"] == "reach_activate" and row["measure"] == "challenge_error"
    ]
    assert len(challenge) == 9
    assert all(float(row["ci_low"]) <= float(row["mean"]) <= float(row["ci_high"]) for row in challenge)

    stats = read(out / "stats.csv")
    assert {row["test"] for row in stats} == {"kruskal", "mannwhitney"}
    pairs = [row for row in stats if row["test"] == "mannwhitney"]
    assert all(float(row["p"]) <= float(row["p_holm"]) <= 1 for row in pairs)
    assert all(-1 <= float(row["effect_size"]) <= 1 for row in pairs)

    ablations = read(out / "ablation_results.csv")
    assert len({row["engine"] for row in ablations}) == 6
    assert len(ablations) == 6 * 20
    assert read(out / "ablation_summary.csv")

    figures = {path.name for path in (out / "figures").glob("*.png")}
    assert {
        "rolling_success_reach_activate.png",
        "challenge_error.png",
        "trials_to_converge.png",
        "compensation_rate.png",
        "coverage.png",
        "learning_gain.png",
        "ablations.png",
    } <= figures
    assert all((out / "figures" / name).stat().st_size > 5_000 for name in figures)

    report = doc.read_text(encoding="utf-8")
    assert "Quick run" in report
    assert "## Method" in report and "## Interpretation" in report
    assert "figures/challenge_error.png" in report
    assert "| Mild | L2 |" in report and "L2 without sectors" in report
