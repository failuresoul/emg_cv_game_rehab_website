"""analysis/emg/emg_validation.py on recordings with known answers: rate, gaps, rest, MVC CV% and
onset latency; PENDING without real data; mock and SIM recordings left out; the docs block."""

from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("emg_validation", ROOT / "analysis" / "emg" / "emg_validation.py")
assert SPEC and SPEC.loader
emg = importlib.util.module_from_spec(SPEC)
sys.modules["emg_validation"] = emg
SPEC.loader.exec_module(emg)

PROTOCOL = [(0, 10_000, "rest"), (10_000, 13_000, "mvc1"), (13_000, 16_000, "relax"), (16_000, 19_000, "mvc2"),
            (19_000, 22_000, "relax"), (22_000, 25_000, "mvc3"), (25_000, 30_000, "relax")]  # fmt: skip


def phase_at(t: float) -> str:
    return next(name for start, end, name in PROTOCOL if start <= t < end)


def write_recording(
    folder: Path,
    name: str,
    *,
    mvcs: tuple[float, float, float] = (1500, 1600, 1550),
    response_ms: float = 200,
    drop_every: int = 0,
    source: str = "serial",
    mode: str = "ADC",
) -> Path:
    """500 Hz for 30 s: rest 200 mV ± 4 (a sine), squeezes `response_ms` after each cue."""
    lines = [f"# source: {source}", f"# mode: {mode}", "# firmware: 1.0.0", ",".join(emg.HEADER)]
    last_phase = ""
    for counter in range(15_000):
        t = counter * 2.0
        phase = phase_at(t)
        if drop_every and counter % drop_every == 0 and counter > 0:
            continue
        # As the recorder does: the cue is on the first sample received in a squeeze.
        cue = phase.startswith("mvc") and phase != last_phase
        last_phase = phase
        level = 200 + 4 * math.sin(t / 37)
        if phase.startswith("mvc"):
            start = next(s for s, _, n in PROTOCOL if n == phase)
            if t - start >= response_ms:
                level = mvcs[int(phase[-1]) - 1]
        arrival = (counter // 25) * 50.0
        lines.append(f"{t},{arrival},{counter},{level:.0f},{level:.2f},{phase},{1 if cue else 0}")
    path = folder / f"{name}.csv"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def doc_with_markers(folder: Path) -> Path:
    doc = folder / "validation.md"
    doc.write_text(f"# V\n\n## EMG validation\n\n{emg.START}\nold\n{emg.END}\n\nafter\n", encoding="utf-8")
    return doc


def test_the_recorder_and_the_analysis_use_one_format() -> None:
    recorder = (ROOT / "web" / "src" / "dev" / "emgMonitor" / "recording.ts").read_text(encoding="utf-8")
    header = re.search(r'EMG_CSV_HEADER = "([^"]+)"', recorder)
    assert header and header.group(1).split(",") == emg.HEADER
    plugin = (ROOT / "web" / "plugins" / "saveLandmarks.ts").read_text(encoding="utf-8")
    assert '"../analysis/emg/recordings"' in plugin
    assert emg.RECORDINGS == ROOT / "analysis" / "emg" / "recordings"


def test_one_recording_gives_the_known_answers(tmp_path: Path) -> None:
    path = write_recording(tmp_path, "emg-1", drop_every=500)
    result = emg.analyse(emg.read_recording(path), emg.defaults())
    assert result["real"] is True
    assert result["missing"] == 29 and result["gap_runs"] == 29
    assert result["gaps_pct"] == pytest.approx(100 * 29 / 15_000, abs=0.01)
    assert result["counter_rate_hz"] == pytest.approx(500, rel=0.01)
    assert result["rest_mean_mv"] == pytest.approx(200, abs=1)
    assert 2 < result["rest_sd_mv"] < 4
    assert result["mvc_efforts_mv"] == [1500, 1600, 1550]
    assert result["mvc_cv_pct"] == pytest.approx(100 * 50 / 1550, abs=0.1)
    # The cue sample itself was lost, so the cue is the next one (2 ms later).
    assert result["onset_latency_ms"] == [198, 198, 198]


def test_without_real_recordings_everything_is_pending(tmp_path: Path) -> None:
    write_recording(tmp_path, "mock-run", source="mock board")
    write_recording(tmp_path, "sim-run", mode="SIM")
    doc = doc_with_markers(tmp_path)
    summary = emg.run(tmp_path, tmp_path / "out" / "summary.json", doc)
    assert summary["label"] == "PENDING"
    assert summary["overall"] == {"status": "PENDING", "reason": "no real sensor recordings yet", "recordings": 0}
    text = doc.read_text(encoding="utf-8")
    assert "**PENDING**" in text and "old" not in text and text.endswith("after\n")
    assert "Left out (mock board or SIM): mock-run, sim-run." in text
    # And with no folder at all.
    assert emg.run(tmp_path / "none", tmp_path / "out" / "s2.json", None)["overall"]["status"] == "PENDING"


def test_real_recordings_fill_the_results(tmp_path: Path) -> None:
    write_recording(tmp_path, "emg-a", mvcs=(1500, 1600, 1550), response_ms=180)
    write_recording(tmp_path, "emg-b", mvcs=(1400, 1450, 1500), response_ms=240)
    write_recording(tmp_path, "emg-mock", source="mock board")
    results = tmp_path / "out" / "summary.json"
    doc = doc_with_markers(tmp_path)
    summary = emg.run(tmp_path, results, doc)
    total: dict[str, Any] = summary["overall"]
    assert summary["label"] == "REAL DATA"
    assert total["status"] == "MEASURED" and total["recordings"] == 2
    assert total["onset_latency_ms_median"] == pytest.approx(210, abs=1)
    assert total["onsets_found"] == "6 of 6"
    assert total["mvc_cv_pct_between"] is not None
    assert json.loads(results.read_text(encoding="utf-8"))["overall"] == total
    text = doc.read_text(encoding="utf-8")
    assert "**PENDING**" not in text and "2 × 30 s recordings" in text and "emg-mock" in text


def test_a_file_that_is_not_a_recording_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "notes.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    write_recording(tmp_path, "emg-1")
    summary = emg.run(tmp_path, tmp_path / "s.json", None)
    assert [r["name"] for r in summary["recordings"]] == ["emg-1"]


def test_the_validation_doc_has_the_emg_markers() -> None:
    text = emg.VALIDATION_DOC.read_text(encoding="utf-8")
    assert text.count(emg.START) == 1 and text.count(emg.END) == 1
    assert text.index(emg.START) > text.index("## EMG validation")
