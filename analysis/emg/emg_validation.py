"""EMG validation from the recordings made on /dev/emg-monitor ("Record 30 s CSV").

    server\\.venv\\Scripts\\python.exe analysis\\emg\\emg_validation.py
    server\\.venv\\Scripts\\python.exe analysis\\emg\\emg_validation.py --recordings path\\to\\csvs --no-docs

Reads analysis/emg/recordings/*.csv (format: web/src/dev/emgMonitor/recording.ts) and reports, per
recording and overall:
- sample rate: counters per second of arrival time, and samples received per second;
- gaps: counters missing between those received (percent of expected, and how many runs);
- rest: the envelope's mean and SD over the 10 s rest (its first second skipped while the
  smoothing settles);
- MVC repeatability: each squeeze's highest 0.5 s envelope mean, and their CV% (sample SD / mean);
- onset latency: from each squeeze cue to the envelope staying above rest mean + 3 SD for 50 ms
  (the app's onset rule and default settings, web/src/emg/emgSettings.json).

Only real sensor data counts: recordings from the mock board or the firmware's SIM mode are listed
but left out of the results. Without real recordings every result is PENDING.

Writes analysis/results/emg/emg_summary.json and replaces the block between
<!-- emg-results:start --> and <!-- emg-results:end --> in docs/validation.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS = ROOT / "analysis" / "emg" / "recordings"
RESULTS = ROOT / "analysis" / "results" / "emg" / "emg_summary.json"
VALIDATION_DOC = ROOT / "docs" / "validation.md"
SETTINGS = ROOT / "web" / "src" / "emg" / "emgSettings.json"
START, END = "<!-- emg-results:start -->", "<!-- emg-results:end -->"
HEADER = ["t_ms", "arrival_ms", "counter", "mv", "envelope_mv", "phase", "cue"]
REST_SETTLE_MS = 1000


def defaults() -> dict[str, float]:
    """The app's default EMG settings (onset rule and MVC window)."""
    spec = json.loads(SETTINGS.read_text(encoding="utf-8"))["settings"]
    return {key: float(rule["default"]) for key, rule in spec.items()}


@dataclass
class Recording:
    name: str
    meta: dict[str, str]
    t: list[float] = field(default_factory=list)
    arrival: list[float] = field(default_factory=list)
    counter: list[int] = field(default_factory=list)
    mv: list[float] = field(default_factory=list)
    envelope: list[float] = field(default_factory=list)
    phase: list[str] = field(default_factory=list)
    cue: list[bool] = field(default_factory=list)

    @property
    def real(self) -> bool:
        """Sensor data: not the mock board, not the firmware's SIM mode."""
        source = self.meta.get("source", "").lower()
        return "mock" not in source and self.meta.get("mode", "ADC").upper() != "SIM"


def read_recording(path: Path) -> Recording:
    meta: dict[str, str] = {}
    rows: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            key, _, value = line[1:].partition(":")
            meta[key.strip()] = value.strip()
        elif line.strip():
            rows.append(line)
    reader = csv.reader(rows)
    header = next(reader, None)
    if header != HEADER:
        raise ValueError(f"{path.name}: not an EMG recording (header {header})")
    recording = Recording(name=path.stem, meta=meta)
    for row in reader:
        if len(row) != len(HEADER):
            continue
        recording.t.append(float(row[0]))
        recording.arrival.append(float(row[1]))
        recording.counter.append(int(row[2]))
        recording.mv.append(float(row[3]))
        recording.envelope.append(float(row[4]))
        recording.phase.append(row[5])
        recording.cue.append(row[6] == "1")
    return recording


def stream_quality(rec: Recording) -> dict[str, Any]:
    """Rates from arrival time, and counter gaps."""
    missing = runs = 0
    for previous, current in zip(rec.counter, rec.counter[1:]):
        if current > previous + 1:
            missing += current - previous - 1
            runs += 1
    span_s = (rec.arrival[-1] - rec.arrival[0]) / 1000 if len(rec.arrival) > 1 else 0.0
    expected = len(rec.counter) + missing
    return {
        "samples": len(rec.counter),
        "counter_rate_hz": round((rec.counter[-1] - rec.counter[0]) / span_s, 1) if span_s > 0 else None,
        "received_rate_hz": round((len(rec.counter) - 1) / span_s, 1) if span_s > 0 else None,
        "missing": missing,
        "gap_runs": runs,
        "gaps_pct": round(100 * missing / expected, 3) if expected else None,
        "max_mv": max(rec.mv) if rec.mv else None,
    }


def rest_stats(rec: Recording) -> dict[str, float] | None:
    values = [e for t, e, p in zip(rec.t, rec.envelope, rec.phase) if p == "rest" and t >= REST_SETTLE_MS]
    if len(values) < 2:
        return None
    return {"mean": statistics.fmean(values), "sd": statistics.pstdev(values)}


def highest_window_mean(times: list[float], values: list[float], window_ms: float) -> float:
    """The highest mean over any window_ms of the samples (the app's MVC rule)."""
    best = float("-inf")
    start = 0
    total = 0.0
    for end, value in enumerate(values):
        total += value
        while times[end] - times[start] >= window_ms:
            total -= values[start]
            start += 1
        if times[end] - times[0] >= window_ms - 1e-9:
            best = max(best, total / (end - start + 1))
    return best if best != float("-inf") else statistics.fmean(values)


def mvc_efforts(rec: Recording, window_ms: float) -> list[float]:
    efforts: list[float] = []
    for name in ("mvc1", "mvc2", "mvc3"):
        times = [t for t, p in zip(rec.t, rec.phase) if p == name]
        values = [e for e, p in zip(rec.envelope, rec.phase) if p == name]
        if values:
            efforts.append(highest_window_mean(times, values, window_ms))
    return efforts


def cv_percent(values: list[float]) -> float | None:
    if len(values) < 2 or statistics.fmean(values) == 0:
        return None
    return 100 * statistics.stdev(values) / statistics.fmean(values)


def onset_latencies(rec: Recording, rest: dict[str, float], k: float, hold_ms: float) -> list[float | None]:
    """Cue to onset (envelope above rest mean + k SD for hold_ms), per cue; None if none follows
    before the next cue."""
    threshold = rest["mean"] + k * rest["sd"]
    cues = [index for index, flag in enumerate(rec.cue) if flag]
    latencies: list[float | None] = []
    for number, index in enumerate(cues):
        stop = cues[number + 1] if number + 1 < len(cues) else len(rec.t)
        since: float | None = None
        found: float | None = None
        for j in range(index, stop):
            if rec.envelope[j] > threshold:
                since = rec.t[j] if since is None else since
                if rec.t[j] - since >= hold_ms:
                    found = since - rec.t[index]
                    break
            else:
                since = None
        latencies.append(found)
    return latencies


def analyse(rec: Recording, settings: dict[str, float]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": rec.name,
        "label": rec.meta.get("label", ""),
        "source": rec.meta.get("source", ""),
        "mode": rec.meta.get("mode", ""),
        "firmware": rec.meta.get("firmware", ""),
        "real": rec.real,
        **stream_quality(rec),
    }
    rest = rest_stats(rec)
    result["rest_mean_mv"] = round(rest["mean"], 1) if rest else None
    result["rest_sd_mv"] = round(rest["sd"], 2) if rest else None
    efforts = mvc_efforts(rec, settings["mvcWindowMs"])
    result["mvc_efforts_mv"] = [round(value, 1) for value in efforts]
    cv = cv_percent(efforts)
    result["mvc_cv_pct"] = round(cv, 1) if cv is not None else None
    latencies = onset_latencies(rec, rest, settings["onsetK"], settings["onsetMs"]) if rest else []
    result["onset_latency_ms"] = [round(value, 1) if value is not None else None for value in latencies]
    return result


def overall(results: list[dict[str, Any]]) -> dict[str, Any]:
    real = [r for r in results if r["real"]]
    if not real:
        return {"status": "PENDING", "reason": "no real sensor recordings yet", "recordings": 0}
    def values(key: str) -> list[float]:
        return [r[key] for r in real if r.get(key) is not None]
    latencies = [v for r in real for v in r["onset_latency_ms"] if v is not None]
    missing = sum(r["missing"] for r in real)
    expected = sum(r["samples"] + r["missing"] for r in real)
    mvc_means = [statistics.fmean(r["mvc_efforts_mv"]) for r in real if r["mvc_efforts_mv"]]
    between = cv_percent(mvc_means)
    return {
        "status": "MEASURED",
        "recordings": len(real),
        "counter_rate_hz_mean": round(statistics.fmean(values("counter_rate_hz")), 1) if values("counter_rate_hz") else None,
        "gaps_pct": round(100 * missing / expected, 3) if expected else None,
        "rest_mean_mv": round(statistics.fmean(values("rest_mean_mv")), 1) if values("rest_mean_mv") else None,
        "rest_sd_mv": round(statistics.fmean(values("rest_sd_mv")), 2) if values("rest_sd_mv") else None,
        "mvc_cv_pct_within": round(statistics.fmean(values("mvc_cv_pct")), 1) if values("mvc_cv_pct") else None,
        "mvc_cv_pct_between": round(between, 1) if between is not None else None,
        "onset_latency_ms_median": round(statistics.median(latencies), 1) if latencies else None,
        "onset_latency_ms_iqr": (
            [round(q, 1) for q in (statistics.quantiles(latencies, n=4)[0], statistics.quantiles(latencies, n=4)[2])]
            if len(latencies) >= 2 else None
        ),
        "onsets_found": f"{len(latencies)} of {sum(len(r['onset_latency_ms']) for r in real)}",
    }


def fmt(value: Any, unit: str = "") -> str:
    if value is None:
        return "–"
    return f"{value}{unit}"


def doc_block(summary: dict[str, Any]) -> list[str]:
    """The EMG results for docs/validation.md (only numbers from the summary)."""
    total = summary["overall"]
    excluded = [r["name"] for r in summary["recordings"] if not r["real"]]
    lines = ["", "| Measure | Method | Result | Notes |", "| --- | --- | --- | --- |"]
    if total["status"] == "PENDING":
        for measure, method in (
            ("Sample rate and gaps", "30 s recordings"),
            ("Rest noise (mV, SD)", "10 s relaxed"),
            ("MVC repeatability", "CV% of 3 efforts"),
            ("Onset latency (cue to EMG onset)", "3 cued squeezes per recording"),
        ):
            lines.append(f"| {measure} | {method} | **PENDING** | {total['reason']} |")
    else:
        n = total["recordings"]
        lines += [
            f"| Sample rate and gaps | {n} × 30 s recordings | {fmt(total['counter_rate_hz_mean'], ' Hz')}, gaps {fmt(total['gaps_pct'], '%')} | counters per second of arrival |",
            f"| Rest noise | 10 s relaxed (first 1 s skipped) | {fmt(total['rest_mean_mv'], ' mV')} ± {fmt(total['rest_sd_mv'], ' mV')} SD | smoothed envelope |",
            f"| MVC repeatability | highest 0.5 s mean of each effort | CV {fmt(total['mvc_cv_pct_within'], '%')} within, {fmt(total['mvc_cv_pct_between'], '%')} between recordings | n = {n} |",
            f"| Onset latency | cue to rest + 3 SD for 50 ms | median {fmt(total['onset_latency_ms_median'], ' ms')}, IQR {fmt(total['onset_latency_ms_iqr'])} | {total['onsets_found']} onsets; includes reaction time |",
        ]
    lines.append("")
    lines.append(f"Source: `analysis/results/emg/emg_summary.json` ({summary['generated_at']}), from `analysis/emg/recordings/`.")
    if excluded:
        lines.append(f"Left out (mock board or SIM): {', '.join(excluded)}.")
    lines.append("")
    return lines


def update_doc(summary: dict[str, Any], doc: Path = VALIDATION_DOC) -> bool:
    text = doc.read_text(encoding="utf-8")
    if START not in text or END not in text:
        return False
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    doc.write_text(before + START + "\n".join(doc_block(summary)) + END + after, encoding="utf-8", newline="\n")
    return True


def run(recordings: Path, results: Path, doc: Path | None) -> dict[str, Any]:
    settings = defaults()
    analysed: list[dict[str, Any]] = []
    for path in sorted(recordings.glob("*.csv")) if recordings.exists() else []:
        try:
            analysed.append(analyse(read_recording(path), settings))
        except ValueError as error:
            print(f"Skipped {path.name}: {error}")
    summary = {
        "label": "REAL DATA" if any(r["real"] for r in analysed) else "PENDING",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "settings": {key: settings[key] for key in ("onsetK", "onsetMs", "mvcWindowMs", "smoothingMs")},
        "overall": overall(analysed),
        "recordings": analysed,
    }
    results.parent.mkdir(parents=True, exist_ok=True)
    results.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8", newline="\n")
    if doc is not None:
        update_doc(summary, doc)
    return summary


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description="EMG validation from /dev/emg-monitor recordings.")
    parser.add_argument("--recordings", type=Path, default=RECORDINGS)
    parser.add_argument("--results", type=Path, default=RESULTS)
    parser.add_argument("--no-docs", action="store_true", help="do not update docs/validation.md")
    args = parser.parse_args(argv)
    summary = run(args.recordings, args.results, None if args.no_docs else VALIDATION_DOC)
    total = summary["overall"]
    print(f"{len(summary['recordings'])} recording(s), {total['recordings']} real: {total['status']}")
    for key, value in total.items():
        if key not in ("status", "recordings"):
            print(f"  {key}: {value}")
    print(f"Wrote {args.results}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
