"""Compare the difficulty engines (L0, L1, L2) on simulated patients, with paper-ready output.

Run from the repository root with the server's virtual environment:

    server\\.venv\\Scripts\\python.exe analysis\\run_simulation.py
    server\\.venv\\Scripts\\python.exe analysis\\run_simulation.py --doc docs\\simulation-results.md

Design (fixed seeds, so every run gives the same numbers):
- **Main study.** For each profile (mild, moderate, severe) and engine (L0, L1, L2): 200
  simulated patients, 10 sessions x 40 trials of Reach and squeeze (reach_activate). Plus 50
  patients of Bloom, a game without directions.
- **Paired.** Within a profile every engine meets the same simulated patients (same seed).
- **Ablations of L2** (moderate profile): without the safety layer, without sectors (one
  global spatial belief), without the coverage term, and p* 0.6 / 0.7 / 0.8.

Outputs in --out (default analysis/results/simulation/):
- results.csv: one row per patient x engine x profile (x game).
- summary.csv: mean, SD and 95% CI per game x profile x engine x measure.
- stats.csv: Kruskal-Wallis per game x profile x measure; pairwise Mann-Whitney U with Holm
  correction and rank-biserial effect sizes.
- ablation_results.csv, ablation_summary.csv.
- figures/*.png.

--doc writes a Markdown report with the tables and figures. --quick uses 20 patients per group,
for testing.

The simulator (server/app/engine/sim) drives the server's real engines and safety layer, through
the same code as POST /api/engine/next. Results describe the engines' behaviour on a model of a
patient, not clinical effect.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import sys
import time
from collections import defaultdict
from collections.abc import Iterable, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from statistics import fmean, stdev
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from app.engine.base import Engine  # noqa: E402
from app.engine.l2_bayes import BayesEngine  # noqa: E402
from app.engine.sim import simulate  # noqa: E402
from app.engine.sim.measures import (  # noqa: E402
    WINDOW,
    ZONE,
    learning_gain,
    measure_run,
    rolling_success,
    runs,
)
from app.engine.sim.runner import SimResult  # noqa: E402

PROFILES = ("mild", "moderate", "severe")
ENGINES = ("L0", "L1", "L2")
GAMES = ("reach_activate", "bloom")
SEED_BASE = 2026
FULL = {"patients": 200, "bloom_patients": 50, "sessions": 10, "trials": 40}
QUICK_PATIENTS = 20
#: The measures reported per patient, with how they read.
MEASURES: dict[str, str] = {
    "success_rate": "Success rate",
    "challenge_error": "Challenge error |rolling success - 0.70|",
    "time_in_zone": "Time in the 0.6-0.8 zone",
    "trials_to_converge": "Trials to converge (first session)",
    "converged_share": "Sessions that converged",
    "compensation_rate": "Compensation rate",
    "coverage": "Workspace coverage (sectors visited 3+ times per session)",
    "learning_gain": "Simulated learning gain (mean ability change)",
    "mean_level": "Mean level",
}
STAT_MEASURES = (
    "challenge_error",
    "time_in_zone",
    "trials_to_converge",
    "compensation_rate",
    "coverage",
    "learning_gain",
)
#: Okabe-Ito colours (colourblind-safe).
COLOURS = {
    "L0": "#7F7F7F",
    "L1": "#0072B2",
    "L2": "#D55E00",
}
ABLATION_COLOURS = ["#D55E00", "#E69F00", "#56B4E9", "#009E73", "#CC79A7", "#0072B2"]
ERROR_COLOUR = "#333333"


@dataclass(frozen=True)
class Job:
    study: str  # "main" | "ablation"
    game: str
    profile: str
    engine_mode: str
    label: str
    patients: int
    sessions: int
    trials: int
    seed: int
    engine_options: dict[str, Any] = field(default_factory=dict)
    safety: bool = True


@dataclass
class JobResult:
    job: Job
    rows: list[dict[str, Any]]
    #: Mean rolling success at trials WINDOW..trials of a session, over patients and sessions.
    rolling: list[float]
    #: Mean learning gain after each session (index 0 = before the first).
    gain_by_session: list[float]
    seconds: float


def seed_for(game: str, profile: str) -> int:
    """The same patients for every engine within a game and profile."""
    return SEED_BASE + 100 * GAMES.index(game) + PROFILES.index(profile)


def patient_rows(result: SimResult, job: Job) -> list[dict[str, Any]]:
    by_run = runs(result.trials)
    rows = []
    for patient, history in enumerate(result.abilities):
        sessions = sorted(
            (session, measure_run(trials))
            for (p, session), trials in by_run.items()
            if p == patient
        )
        measured = [run for _, run in sessions]
        if not measured:
            continue
        first = measured[0]

        def mean_of(values: Iterable[float | None]) -> float:
            found = [v for v in values if v is not None]
            return fmean(found) if found else math.nan

        rows.append(
            {
                "study": job.study,
                "game": job.game,
                "profile": job.profile,
                "engine": job.label,
                "patient": patient,
                "sessions": len(measured),
                "trials": sum(run.trials for run in measured),
                "success_rate": fmean(run.success_rate for run in measured),
                "challenge_error": mean_of(run.challenge_error for run in measured),
                "time_in_zone": mean_of(run.time_in_zone for run in measured),
                "trials_to_converge": (
                    float(first.trials_to_converge)
                    if first.trials_to_converge is not None
                    else math.nan
                ),
                "converged_share": fmean(
                    run.trials_to_converge is not None for run in measured
                ),
                "compensation_rate": mean_of(run.compensation_rate for run in measured),
                "coverage": fmean(run.coverage for run in measured),
                "learning_gain": learning_gain(history[0], history[-1]),
                "mean_level": fmean(run.mean_level for run in measured),
            }
        )
    return rows


def curves(result: SimResult, trials: int) -> tuple[list[float], list[float]]:
    sums = [0.0] * (trials - WINDOW + 1)
    counts = [0] * (trials - WINDOW + 1)
    for run_trials in runs(result.trials).values():
        values = rolling_success([trial.success for trial in run_trials])
        for index, value in enumerate(values[: len(sums)]):
            sums[index] += value
            counts[index] += 1
    rolling = [s / c if c else math.nan for s, c in zip(sums, counts, strict=True)]
    sessions = max((len(history) for history in result.abilities), default=1)
    gains = []
    for index in range(sessions):
        values = [
            learning_gain(history[0], history[index])
            for history in result.abilities
            if len(history) > index
        ]
        gains.append(fmean(values) if values else math.nan)
    return rolling, gains


def run_job(job: Job) -> JobResult:
    started = time.perf_counter()
    engine: Engine | None = BayesEngine(**job.engine_options) if job.engine_options else None
    result = simulate(
        job.engine_mode,
        job.profile,
        n_patients=job.patients,
        sessions=job.sessions,
        trials_per_session=job.trials,
        game_id=job.game,
        seed=job.seed,
        engine=engine,
        safety=job.safety,
        label=job.label,
    )
    rolling, gains = curves(result, job.trials)
    return JobResult(
        job=job,
        rows=patient_rows(result, job),
        rolling=rolling,
        gain_by_session=gains,
        seconds=time.perf_counter() - started,
    )


#: The L2 ablations: label, engine options, safety layer on.
ABLATIONS: list[tuple[str, dict[str, Any], bool]] = [
    ("L2 (p*=0.7)", {}, True),
    ("L2 without safety layer", {}, False),
    ("L2 without sectors", {"workspace": False}, True),
    ("L2 without coverage term", {"w_cov": 0.0}, True),
    ("L2 p*=0.6", {"p_star": 0.6}, True),
    ("L2 p*=0.8", {"p_star": 0.8}, True),
]


def plan(patients: int, bloom_patients: int, sessions: int, trials: int) -> list[Job]:
    jobs = []
    for game, count in (("reach_activate", patients), ("bloom", bloom_patients)):
        for profile in PROFILES:
            for engine in ENGINES:
                jobs.append(
                    Job("main", game, profile, engine, engine, count, sessions, trials,
                        seed_for(game, profile))
                )
    for label, options, safety in ABLATIONS[1:]:
        jobs.append(
            Job(
                "ablation",
                "reach_activate",
                "moderate",
                "L2",
                label,
                patients,
                sessions,
                trials,
                seed_for("reach_activate", "moderate"),
                engine_options=options or {"p_star": 0.7},
                safety=safety,
            )
        )
    return jobs


# Statistics


def mean_ci(values: Sequence[float]) -> tuple[int, float, float, float, float]:
    """n, mean, SD and the 95% confidence interval of the mean (t distribution)."""
    from scipy.stats import t

    found = [v for v in values if not math.isnan(v)]
    n = len(found)
    if n == 0:
        return 0, math.nan, math.nan, math.nan, math.nan
    mean = fmean(found)
    if n == 1:
        return 1, mean, math.nan, math.nan, math.nan
    sd = stdev(found)
    half = float(t.ppf(0.975, n - 1)) * sd / math.sqrt(n)
    return n, mean, sd, mean - half, mean + half


def holm(p_values: Sequence[float]) -> list[float]:
    """Holm-Bonferroni adjusted p-values, in the original order."""
    order = sorted(range(len(p_values)), key=lambda i: p_values[i])
    adjusted = [math.nan] * len(p_values)
    running = 0.0
    m = len(p_values)
    for rank, index in enumerate(order):
        value = min(1.0, (m - rank) * p_values[index])
        running = max(running, value)
        adjusted[index] = running
    return adjusted


def rank_biserial(u: float, n_a: int, n_b: int) -> float:
    """r = 2U/(n_a n_b) - 1 for U of group a: positive when a's values tend to be larger."""
    return 2 * u / (n_a * n_b) - 1


def compare(groups: dict[str, list[float]]) -> list[dict[str, Any]]:
    """Kruskal-Wallis across the groups, then every pair with Mann-Whitney U and Holm."""
    from scipy.stats import kruskal, mannwhitneyu

    clean = {name: [v for v in values if not math.isnan(v)] for name, values in groups.items()}
    usable = {name: values for name, values in clean.items() if len(values) >= 2}
    rows: list[dict[str, Any]] = []
    if len(usable) >= 2:
        everything = [v for values in usable.values() for v in values]
        if len(set(everything)) > 1:
            h, p = kruskal(*usable.values())
            rows.append({"test": "kruskal", "group_a": "all", "group_b": "", "statistic": h,
                         "p": p, "p_holm": "", "effect_size": "", "n_a": len(everything), "n_b": ""})
    names = list(usable)
    pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:]]
    results = []
    for a, b in pairs:
        if len(set(usable[a]) | set(usable[b])) == 1:
            results.append((a, b, math.nan, 1.0))
            continue
        u, p = mannwhitneyu(usable[a], usable[b], alternative="two-sided")
        results.append((a, b, float(u), float(p)))
    adjusted = holm([p for *_, p in results]) if results else []
    for (a, b, u, p), p_holm in zip(results, adjusted, strict=True):
        rows.append({
            "test": "mannwhitney", "group_a": a, "group_b": b, "statistic": u, "p": p,
            "p_holm": p_holm,
            "effect_size": rank_biserial(u, len(usable[a]), len(usable[b])) if not math.isnan(u) else 0.0,
            "n_a": len(usable[a]), "n_b": len(usable[b]),
        })
    return rows


# Output


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: (f"{v:.6g}" if isinstance(v, float) else v) for k, v in row.items()})


def summarise_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["game"], row["profile"], row["engine"])].append(row)
    out = []
    for (game, profile, engine), items in grouped.items():
        for measure in MEASURES:
            n, mean, sd, low, high = mean_ci([float(item[measure]) for item in items])
            out.append({"game": game, "profile": profile, "engine": engine, "measure": measure,
                        "n": n, "mean": mean, "sd": sd, "ci_low": low, "ci_high": high})
    return out


def statistics_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    games = sorted({row["game"] for row in rows}, key=GAMES.index)
    for game in games:
        for profile in PROFILES:
            subset = [r for r in rows if r["game"] == game and r["profile"] == profile]
            if not subset:
                continue
            for measure in STAT_MEASURES:
                groups = {engine: [float(r[measure]) for r in subset if r["engine"] == engine]
                          for engine in ENGINES}
                for row in compare(groups):
                    out.append({"game": game, "profile": profile, "measure": measure, **row})
    return out


def lookup(summary: list[dict[str, Any]]) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    return {(r["game"], r["profile"], r["engine"], r["measure"]): r for r in summary}


# Figures


def figures(results: list[JobResult], summary: list[dict[str, Any]], ablation_summary: list[dict[str, Any]], folder: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({
        "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
        "axes.grid": True, "grid.alpha": 0.25, "figure.dpi": 150, "savefig.bbox": "tight",
    })
    folder.mkdir(parents=True, exist_ok=True)
    table = lookup(summary)
    made: list[str] = []
    main = {(r.job.game, r.job.profile, r.job.label): r for r in results if r.job.study == "main"}

    def save(fig: Any, name: str) -> None:
        fig.savefig(folder / name)
        plt.close(fig)
        made.append(name)

    # Rolling success within a session.
    for game in GAMES:
        fig, axes = plt.subplots(1, 3, figsize=(10, 3.2), sharey=True)
        drawn = False
        for ax, profile in zip(axes, PROFILES, strict=True):
            ax.axhspan(*ZONE, color="#009E73", alpha=0.12, label="0.6-0.8 zone")
            ax.axhline(0.7, color="#009E73", lw=0.8, ls="--")
            for engine in ENGINES:
                result = main.get((game, profile, engine))
                if result is None:
                    continue
                drawn = True
                x = list(range(WINDOW, WINDOW + len(result.rolling)))
                ax.plot(x, result.rolling, color=COLOURS[engine], lw=1.8, label=engine)
            ax.set_title(profile.capitalize())
            ax.set_xlabel("Trial within session")
            ax.set_ylim(0, 1)
        if not drawn:
            plt.close(fig)
            continue
        axes[0].set_ylabel(f"Rolling success (last {WINDOW})")
        handles, labels = axes[0].get_legend_handles_labels()
        fig.legend(handles, labels, frameon=False, loc="lower center", ncols=4,
                   bbox_to_anchor=(0.5, -0.17))
        fig.suptitle(f"Rolling success, {game}", y=1.02)
        save(fig, f"rolling_success_{game}.png")

    # Bars with 95% CIs.
    def bars(measure: str, name: str, ylabel: str, game: str = "reach_activate") -> None:
        fig, ax = plt.subplots(figsize=(6.5, 3.2))
        width = 0.26
        for i, engine in enumerate(ENGINES):
            means, errors = [], [[], []]
            for profile in PROFILES:
                row = table.get((game, profile, engine, measure))
                mean = row["mean"] if row else math.nan
                low = row["ci_low"] if row else math.nan
                high = row["ci_high"] if row else math.nan
                means.append(mean)
                errors[0].append(0 if math.isnan(low) else mean - low)
                errors[1].append(0 if math.isnan(high) else high - mean)
            xs = [p + (i - 1) * width for p in range(len(PROFILES))]
            ax.bar(xs, means, width, yerr=errors, capsize=3, color=COLOURS[engine], label=engine,
                   ecolor=ERROR_COLOUR)
        ax.set_xticks(range(len(PROFILES)), [p.capitalize() for p in PROFILES])
        ax.set_ylabel(ylabel)
        ax.legend(frameon=False, ncols=3)
        ax.set_title(f"{MEASURES[measure]}, {game} (mean, 95% CI)", fontsize=10)
        save(fig, name)

    bars("challenge_error", "challenge_error.png", "Challenge error")
    bars("time_in_zone", "time_in_zone.png", "Share of rolling values in zone")
    bars("trials_to_converge", "trials_to_converge.png", "Trials (sessions that converged)")
    bars("compensation_rate", "compensation_rate.png", "Share of trials")
    bars("coverage", "coverage.png", "Sectors (of 24)")
    bars("challenge_error", "challenge_error_bloom.png", "Challenge error", game="bloom")

    # Learning gain across sessions.
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.2), sharey=True)
    for ax, profile in zip(axes, PROFILES, strict=True):
        for engine in ENGINES:
            result = main.get(("reach_activate", profile, engine))
            if result is None:
                continue
            ax.plot(range(len(result.gain_by_session)), result.gain_by_session,
                    color=COLOURS[engine], marker="o", ms=3, lw=1.6, label=engine)
        ax.set_title(profile.capitalize())
        ax.set_xlabel("Sessions completed")
        ax.xaxis.get_major_locator().set_params(integer=True)
    axes[0].set_ylabel("Mean ability change")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, loc="lower center", ncols=3,
               bbox_to_anchor=(0.5, -0.17))
    fig.suptitle("Simulated learning gain, reach_activate", y=1.02)
    save(fig, "learning_gain.png")

    # Ablations.
    if ablation_summary:
        ab = {(r["engine"], r["measure"]): r for r in ablation_summary}
        labels = [label for label, *_ in ABLATIONS]
        fig, axes = plt.subplots(1, 3, figsize=(11, 3.4))
        for ax, measure in zip(axes, ("challenge_error", "time_in_zone", "compensation_rate"), strict=True):
            means = [ab.get((label, measure), {}).get("mean", math.nan) for label in labels]
            lows = [ab.get((label, measure), {}).get("ci_low", math.nan) for label in labels]
            highs = [ab.get((label, measure), {}).get("ci_high", math.nan) for label in labels]
            err = [[0 if math.isnan(lo) else m - lo for m, lo in zip(means, lows, strict=True)],
                   [0 if math.isnan(hi) else hi - m for m, hi in zip(means, highs, strict=True)]]
            ax.barh(range(len(labels)), means, xerr=err, capsize=3,
                    color=ABLATION_COLOURS[: len(labels)], ecolor=ERROR_COLOUR)
            ax.set_yticks(range(len(labels)), labels if measure == "challenge_error" else [""] * len(labels))
            ax.invert_yaxis()
            ax.set_title(MEASURES[measure].split(" |")[0], fontsize=10)
        fig.suptitle("L2 ablations, moderate profile, reach_activate (mean, 95% CI)", y=1.02)
        save(fig, "ablations.png")
    return made


# Report


def relative(path: Path, start: Path) -> str:
    """A forward-slash path from `start`, or the absolute path on another drive (Windows)."""
    try:
        return os.path.relpath(path, start).replace(os.sep, "/")
    except ValueError:
        return path.resolve().as_posix()


def fmt(value: Any, digits: int = 3) -> str:
    if value is None or value == "" or (isinstance(value, float) and math.isnan(value)):
        return "–"
    return f"{float(value):.{digits}f}"


def cell(row: dict[str, Any] | None, digits: int = 3) -> str:
    if row is None or row["n"] == 0:
        return "–"
    return f"{fmt(row['mean'], digits)} [{fmt(row['ci_low'], digits)}, {fmt(row['ci_high'], digits)}]"


def p_text(p: Any) -> str:
    if p in ("", None) or (isinstance(p, float) and math.isnan(p)):
        return "–"
    return "<0.001" if float(p) < 0.001 else f"{float(p):.3f}"


def report(path: Path, out: Path, figures_made: list[str], summary: list[dict[str, Any]],
           stats: list[dict[str, Any]], ablation_summary: list[dict[str, Any]],
           settings: dict[str, Any], quick: bool, seconds: float) -> None:
    table = lookup(summary)
    figure_dir = relative(out / "figures", path.parent)
    lines: list[str] = []
    add = lines.append
    add("# Simulation results: L0, L1 and L2")
    add("")
    if quick:
        add("> **Quick run** (20 patients per group). These numbers are only for checking the "
            "pipeline; regenerate this page with the full run (see Reproducing).")
        add("")
    add("These results describe how the difficulty engines behave on a *model* of a patient. "
        "They are not evidence of clinical effect.")
    add("")
    add("## Method")
    add("")
    add("- **Simulator** (`server/app/engine/sim/`):")
    add("  - Each simulated patient has abilities on the same scale as the demands they meet:")
    add("    - reach per direction (a fraction of the calibrated reach);")
    add("    - activation (0–1);")
    add("    - speed and precision (0–1, against the difficulty d of those settings).")
    add("  - Each component succeeds with p = 1 / (1 + e^(−k (ability − demand))), k = 8 (k = 12 for activation). A trial succeeds when every component the game uses succeeds; the first to fail names the failure, as the browser does.")
    add("  - Fatigue within a session multiplies every ability by 1 − f (1 − e^(−t/τ)), f 0.05–0.3, τ about 60 trials; a rest cue halves t.")
    add("  - Learning between sessions: each ability rises by η (0.001–0.003) per success near its edge, capped at 1.")
    add("  - Compensation becomes likely beyond the reach in a direction.")
    add("- **Same code as the app:** the simulator runs the server's real engines and safety layer through the same function as `POST /api/engine/next`; a test replays a simulated session through the API and gets identical decisions.")
    add("- **Profiles:**")
    add("")
    add("  | Profile | Reach (fraction of calibrated reach) | Activation | Speed, precision |")
    add("  | --- | --- | --- | --- |")
    add("  | Mild | 0.85–1.0 | 0.70 | 0.70 |")
    add("  | Moderate | 0.55–0.8, two weak directions 0.35–0.5 | 0.45 | 0.50 |")
    add("  | Severe | 0.3–0.5 | 0.25 | 0.30 |")
    add("")
    add("  Activation, speed and precision vary ±0.05 between patients.")
    add(f"- **Design:** {settings['patients']} patients per profile and engine, {settings['sessions']} sessions × {settings['trials']} trials of Reach and squeeze (`reach_activate`, a spatial game with directions); {settings['bloom_patients']} patients of Bloom (`bloom`, no directions). Within a profile every engine meets the same simulated patients (fixed seeds).")
    add("- **Engines:** L0 keeps the admin's defaults; L1 is the 2-up/1-down staircase; L2 is the Bayesian, workspace-aware engine (see [the engine](ai-engine.md)).")
    add("- **Measures** (per session, then averaged per patient):")
    add("  - rolling success over 10 trials;")
    add("  - challenge error: the mean |rolling success − 0.70|;")
    add("  - time in the 0.6–0.8 zone;")
    add("  - trials to converge: the first trial after which rolling success stays in the zone for 10 trials, in the first session;")
    add("  - compensation rate;")
    add("  - workspace coverage: sectors (8 directions × 3 rings) visited at least 3 times;")
    add("  - learning gain: the mean ability change from the first to the last session.")
    add("- **Statistics:**")
    add("  - per profile, Kruskal–Wallis across the three engines;")
    add("  - pairwise Mann–Whitney U, Holm-corrected over the three pairs;")
    add("  - rank-biserial effect sizes r (positive when the first engine's values tend to be larger);")
    add("  - 95% confidence intervals of the mean from the t distribution.")
    add("")
    add("## Results: Reach and squeeze")
    add("")
    add("Mean [95% CI] per patient. Trials to converge is the mean over the patients whose first session converged (n of them).")
    add("")
    shown = ("success_rate", "challenge_error", "time_in_zone", "trials_to_converge",
             "compensation_rate", "coverage", "learning_gain")
    add("| Profile | Engine | " + " | ".join(MEASURES[m].split(" (")[0].split(" |")[0] for m in shown) + " |")
    add("| --- | --- |" + " --- |" * len(shown))
    for profile in PROFILES:
        for engine in ENGINES:
            cells = []
            for m in shown:
                digits = 1 if m in ("trials_to_converge", "coverage") else (4 if m == "learning_gain" else 3)
                row = table.get(("reach_activate", profile, engine, m))
                text = cell(row, digits)
                if m == "trials_to_converge" and row is not None and row["n"]:
                    text += f" (n={row['n']})"
                cells.append(text)
            add(f"| {profile.capitalize()} | {engine} | " + " | ".join(cells) + " |")
    add("")
    for name, caption in (
        ("rolling_success_reach_activate.png", "Rolling success within a session; the 0.6–0.8 zone is shaded."),
        ("challenge_error.png", "Challenge error (lower is better)."),
        ("time_in_zone.png", "Time in the 0.6–0.8 zone (higher is better)."),
        ("trials_to_converge.png", "Trials to converge in the first session (patients whose session converged)."),
        ("compensation_rate.png", "Compensation rate (lower is better)."),
        ("coverage.png", "Workspace coverage."),
        ("learning_gain.png", "Simulated learning gain across sessions."),
    ):
        if name in figures_made:
            add(f"![{caption}]({figure_dir}/{name})")
            add("")
            add(f"*{caption}*")
            add("")
    add("### Engine comparisons (challenge error)")
    add("")
    add("r is positive when the first engine of the pair tends to have the larger challenge error.")
    add("")
    add("| Profile | Kruskal–Wallis p | Pair | Holm p | Rank-biserial r |")
    add("| --- | --- | --- | --- | --- |")
    for profile in PROFILES:
        rows = [r for r in stats if r["game"] == "reach_activate" and r["profile"] == profile and r["measure"] == "challenge_error"]
        kw = next((r for r in rows if r["test"] == "kruskal"), None)
        for r in rows:
            if r["test"] != "mannwhitney":
                continue
            add(f"| {profile.capitalize()} | {p_text(kw['p']) if kw else '–'} | {r['group_a']} vs {r['group_b']} | {p_text(r['p_holm'])} | {fmt(r['effect_size'], 2)} |")
    add("")
    add("Every measure's tests are in `stats.csv`.")
    add("")
    add("## Results: Bloom (no directions)")
    add("")
    add("| Profile | Engine | Success rate | Challenge error | Time in zone |")
    add("| --- | --- | --- | --- | --- |")
    for profile in PROFILES:
        for engine in ENGINES:
            add(f"| {profile.capitalize()} | {engine} | "
                + " | ".join(cell(table.get(("bloom", profile, engine, m))) for m in ("success_rate", "challenge_error", "time_in_zone"))
                + " |")
    add("")
    if "challenge_error_bloom.png" in figures_made:
        add(f"![Challenge error in Bloom.]({figure_dir}/challenge_error_bloom.png)")
        add("")
    add("## Ablations of L2 (moderate profile, Reach and squeeze)")
    add("")
    ab = {(r["engine"], r["measure"]): r for r in ablation_summary}
    add("| Variant | Success rate | Challenge error | Time in zone | Compensation | Coverage |")
    add("| --- | --- | --- | --- | --- | --- |")
    for label, *_ in ABLATIONS:
        add(f"| {label} | " + " | ".join(
            cell(ab.get((label, m)), 1 if m == "coverage" else 3)
            for m in ("success_rate", "challenge_error", "time_in_zone", "compensation_rate", "coverage")
        ) + " |")
    add("")
    if "ablations.png" in figures_made:
        add(f"![L2 ablations.]({figure_dir}/ablations.png)")
        add("")
    add("## Interpretation")
    add("")
    add(interpretation(table, stats))
    add("")
    add("## Reproducing")
    add("")
    add("```powershell")
    add("server\\.venv\\Scripts\\python.exe -m pip install -r analysis\\requirements.txt")
    add("server\\.venv\\Scripts\\python.exe analysis\\run_simulation.py --doc docs\\simulation-results.md")
    add("```")
    add("")
    add(f"Outputs go to `{relative(out, ROOT)}/`: `results.csv`, `summary.csv`, `stats.csv`, `ablation_results.csv`, `ablation_summary.csv` and `figures/`. This run took {seconds / 60:.1f} minutes.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def interpretation(table: dict[tuple[str, str, str, str], dict[str, Any]], stats: list[dict[str, Any]]) -> str:
    """Neutral sentences from the numbers; the likely reasons are listed whenever L2 is not
    better than L1 on challenge error in every profile."""
    parts: list[str] = []
    l2_better_everywhere = True
    for profile in PROFILES:
        l1 = table.get(("reach_activate", profile, "L1", "challenge_error"))
        l2 = table.get(("reach_activate", profile, "L2", "challenge_error"))
        pair = next((r for r in stats if r["game"] == "reach_activate" and r["profile"] == profile
                     and r["measure"] == "challenge_error" and r["test"] == "mannwhitney"
                     and {r["group_a"], r["group_b"]} == {"L1", "L2"}), None)
        if not l1 or not l2 or pair is None:
            l2_better_everywhere = False
            continue
        p = pair["p_holm"]
        significant = isinstance(p, float) and p < 0.05
        # r as L2 against L1: negative when L2's challenge errors tend to be lower.
        r_l2 = pair["effect_size"] if pair["group_a"] == "L2" else -pair["effect_size"]
        if l2["mean"] < l1["mean"] and significant:
            verdict = "lower than L1's"
        elif l2["mean"] > l1["mean"] and significant:
            verdict = "higher than L1's"
            l2_better_everywhere = False
        else:
            verdict = "not clearly different from L1's"
            l2_better_everywhere = False
        parts.append(
            f"- **{profile.capitalize()}:** L2's challenge error ({fmt(l2['mean'])}) was {verdict} "
            f"({fmt(l1['mean'])}; Holm p {p_text(p)}, rank-biserial r for L2 against L1 "
            f"{fmt(r_l2, 2)})."
        )
    text = "\n".join(parts)
    if not l2_better_everywhere:
        text += (
            "\n\n**L2 was not better than L1 on challenge error in every profile.** Likely reasons:\n\n"
            "- **Exploration cost:** L2 keeps an independent belief for each of 24–32 sectors. With 40-trial sessions most far sectors get less than one trial per session, so their beliefs stay close to the priors and L2 keeps exploring targets the patient fails.\n"
            "- **Forgetting:** 30% of what was learned drifts back to the prior between sessions, which slows convergence further for rarely visited sectors.\n"
            "- **Credit assignment:** a trial succeeds only when every part does. L2 aims each part at 0.70^(1/k) and shares an ambiguous reach failure between the sector and the precision level; both are approximations of the joint outcome.\n"
            "- **Optimistic priors** for the outer rings (R2 3:2, R3 2:2) suit mild patients but not moderate or severe ones, whose reach rarely meets them; without a calibration or warm-up (not simulated here) nothing corrects them early.\n"
            "- **The simulator's assumptions:** independent logistic components, a fixed floor of 0.40 for the easiest distance and no between-direction learning transfer all favour a single global staircase such as L1.\n\n"
            "Possible next steps, not tested here: share evidence between neighbouring sectors (a hierarchical prior), start from the calibration and warm-up, and reconsider the coverage term in the light of the ablations."
        )
    text += (
        "\n\nL0 keeps the admin's defaults, so its success depends only on how well they fit "
        "the profile. Results are from simulated patients and do not show clinical effect."
    )
    return text


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--quick", action="store_true", help="20 patients per group, for testing")
    parser.add_argument("--out", type=Path, default=ROOT / "analysis" / "results" / "simulation")
    parser.add_argument("--doc", type=Path, help="write the Markdown report here")
    parser.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument("--sessions", type=int, help="override the sessions per patient")
    parser.add_argument("--trials", type=int, help="override the trials per session")
    args = parser.parse_args(argv)

    patients = QUICK_PATIENTS if args.quick else FULL["patients"]
    bloom_patients = QUICK_PATIENTS if args.quick else FULL["bloom_patients"]
    sessions = args.sessions or FULL["sessions"]
    trials = args.trials or FULL["trials"]
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    jobs = plan(patients, bloom_patients, sessions, trials)
    # The slowest jobs (L2) first, so the workers stay busy.
    jobs.sort(key=lambda job: (job.engine_mode != "L2", -job.patients))

    started = time.perf_counter()
    print(f"{len(jobs)} simulation jobs on {args.workers} worker(s)...", flush=True)
    results: list[JobResult] = []
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            for result in pool.map(run_job, jobs):
                results.append(result)
                print(f"  {result.job.game} {result.job.profile} {result.job.label}: {result.seconds:.1f} s", flush=True)
    else:
        for job in jobs:
            result = run_job(job)
            results.append(result)
            print(f"  {job.game} {job.profile} {job.label}: {result.seconds:.1f} s", flush=True)

    main_rows = [row for r in results if r.job.study == "main" for row in r.rows]
    main_rows.sort(key=lambda row: (GAMES.index(row["game"]), PROFILES.index(row["profile"]), row["engine"], row["patient"]))
    baseline = [dict(row, study="ablation", engine=ABLATIONS[0][0]) for row in main_rows
                if row["game"] == "reach_activate" and row["profile"] == "moderate" and row["engine"] == "L2"]
    ablation_rows = baseline + [row for r in results if r.job.study == "ablation" for row in r.rows]

    summary = summarise_rows(main_rows)
    ablation_summary = summarise_rows(ablation_rows)
    stats = statistics_rows(main_rows)
    write_csv(out / "results.csv", main_rows)
    write_csv(out / "summary.csv", summary)
    write_csv(out / "stats.csv", stats)
    write_csv(out / "ablation_results.csv", ablation_rows)
    write_csv(out / "ablation_summary.csv", ablation_summary)
    made = figures(results, summary, ablation_summary, out / "figures")
    seconds = time.perf_counter() - started
    settings = {"patients": patients, "bloom_patients": bloom_patients, "sessions": sessions, "trials": trials}
    if args.doc:
        report(args.doc, out, made, summary, stats, ablation_summary, settings, args.quick, seconds)
    print(f"Done in {seconds / 60:.1f} min: {len(main_rows)} patient rows, {len(made)} figures -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
