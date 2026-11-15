"""Minimal detectable change (MDC) of each catalogue measure: the smallest change between
sessions that is larger than the measure's usual session-to-session noise.

Each measure's MDC is either:
- measured: from analysis/results/validation/mdc.json, which analysis/validation/run_validation.py
  writes from the repeatability visits (Day 19). It is used only if it is real data (never the
  validation_demo/ folder or a file labelled as a demo) and the value is usable; each measured
  value keeps where it came from (visits, participants, when, the input's checksum);
- provisional: a placeholder below, chosen to be plausible for the measure's unit, until it is
  measured.

A change judged against an MDC only says whether it is larger than that noise, not whether it
matters clinically. With one participant (n=1, pilot) a measured MDC is the noise of that one
person and is labelled so.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Literal

from app.core.config import SERVER_DIR, settings

logger = logging.getLogger("app.mdc")

#: Where run_validation.py writes the measured values. Never the demo folder.
MEASURED_PATH: Final = SERVER_DIR.parent / "analysis" / "results" / "validation" / "mdc.json"
DEMO_FOLDER: Final = "validation_demo"
REAL_LABEL: Final = "REAL DATA"
#: A measured MDC needs at least this many visits of the measure.
MIN_VISITS: Final = 2

#: Metric id (shared/metrics-catalog.json) to its placeholder MDC, in the metric's own unit.
PROVISIONAL_MDC: Final[dict[str, float]] = {
    "K1": 0.15,  # sw2: reach area
    "K5": 100.0,  # ms: reaction time
    "K6": 150.0,  # ms: movement time
    "K7": 0.05,  # share: path efficiency
    "K8": 0.3,  # SPARC
    "K9": 0.15,  # SW/s: peak speed
    "K10": 0.5,  # speed peaks per movement
    "K12": 0.1,  # share of trials with compensation
    "R1": 8.0,  # deg: shoulder raise forward
    "R2": 8.0,  # deg: shoulder raise sideways
    "R3": 8.0,  # deg: elbow range
    "R4": 0.05,  # arm ratio: forward reach
    "H1": 0.1,  # palm lengths: hand opening range
    "H2": 0.1,  # share: finger piano hit rate
    "H3": 0.02,  # share: grip steadiness (standard deviation)
    "H4": 300.0,  # ms: relaxation time
    "H5": 400.0,  # ms: transport time
    "H6": 0.08,  # share: bloom peak openness
    "G1": 0.1,  # share: game success rate
    "G2": 3.0,  # minutes active
    "G3": 10.0,  # warm-up repetitions
    "G4": 1.0,  # warm-up goals reached
    "E2": 150.0,  # mV: maximum voluntary contraction
    "E3": 0.1,  # share: activation success with EMG
    "E5": 100.0,  # ms: EMG onset latency
    "E6": 300.0,  # ms: EMG relaxation time
    "E8": 0.02,  # share: grip steadiness from EMG (standard deviation)
    "E9": 1.0,  # %MVC per activation: within-session fatigue slope
    "P1": 2.0,  # pain, 0-10
    "P2": 2.0,  # fatigue, 0-10
    "P3": 1.0,  # enjoyment, 1-5
}
#: Kept for code that reads the placeholder table by its old name.
MDC: Final = PROVISIONAL_MDC

MdcSource = Literal["measured", "provisional"]


@dataclass(frozen=True)
class MdcValue:
    value: float
    source: MdcSource
    #: Measured only: how many participants and visits it comes from, and from where.
    participants: int | None = None
    visits: int | None = None
    generated_at: str | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class MdcTable:
    measured: dict[str, MdcValue] = field(default_factory=dict)
    #: Metric id (or "*" for the whole file) to why its value was not used.
    rejected: dict[str, str] = field(default_factory=dict)
    path: str | None = None


def _usable(metric_id: str, entry: Any) -> tuple[MdcValue | None, str | None]:
    if metric_id not in PROVISIONAL_MDC:
        return None, "not a catalogue measure with an MDC"
    if not isinstance(entry, dict):
        return None, "not an object"
    value = entry.get("mdc95")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "mdc95 is not a number"
    if not math.isfinite(value) or value <= 0:
        return None, "mdc95 must be a positive number"
    visits = entry.get("visits")
    if not isinstance(visits, int) or isinstance(visits, bool) or visits < MIN_VISITS:
        return None, f"needs {MIN_VISITS} or more visits"
    participants = entry.get("participants", 1)
    if not isinstance(participants, int) or isinstance(participants, bool) or participants < 1:
        return None, "participants must be a whole number of 1 or more"
    return MdcValue(value=float(value), source="measured", participants=participants, visits=visits), None


def load_measured(path: Path = MEASURED_PATH) -> MdcTable:
    """The measured MDCs in a validation results file; empty (all provisional) if there is none
    or it cannot be used. Never raises."""
    if DEMO_FOLDER in path.parts:
        return MdcTable(rejected={"*": "the demo folder is never used"}, path=str(path))
    if not path.exists():
        return MdcTable(path=str(path))
    try:
        raw = path.read_bytes()
        data = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError) as error:
        logger.warning("MDC file %s cannot be read: %s", path, error)
        return MdcTable(rejected={"*": f"cannot be read: {error}"}, path=str(path))
    if not isinstance(data, dict) or data.get("label") != REAL_LABEL:
        return MdcTable(rejected={"*": f"not labelled {REAL_LABEL!r} (a demo or another file)"}, path=str(path))
    metrics = data.get("metrics")
    if not isinstance(metrics, dict):
        return MdcTable(rejected={"*": "no metrics object"}, path=str(path))
    import hashlib

    sha = hashlib.sha256(raw).hexdigest()
    generated = data.get("generated_at") if isinstance(data.get("generated_at"), str) else None
    measured: dict[str, MdcValue] = {}
    rejected: dict[str, str] = {}
    for metric_id, entry in metrics.items():
        value, reason = _usable(str(metric_id), entry)
        if value is None:
            rejected[str(metric_id)] = reason or "unusable"
            logger.warning("MDC for %s not used: %s", metric_id, reason)
        else:
            measured[str(metric_id)] = MdcValue(
                value=value.value, source="measured", participants=value.participants,
                visits=value.visits, generated_at=generated, sha256=sha,
            )
    return MdcTable(measured=measured, rejected=rejected, path=str(path))


@lru_cache(maxsize=1)
def _cached(path: str, modified: float) -> MdcTable:
    return load_measured(Path(path))


def measured_path() -> Path:
    """MDC_PATH if set, else analysis/results/validation/mdc.json."""
    return Path(settings.MDC_PATH) if settings.MDC_PATH else MEASURED_PATH


def table(path: Path | None = None) -> MdcTable:
    """The measured table, read again whenever the file changes."""
    path = path or measured_path()
    try:
        modified = path.stat().st_mtime
    except OSError:
        modified = -1.0
    return _cached(str(path), modified)


def mdc_info(metric_id: str, path: Path | None = None) -> MdcValue | None:
    """A measure's MDC: the measured one if usable, else its placeholder; None if it has none."""
    measured = table(path).measured.get(metric_id)
    if measured is not None:
        return measured
    placeholder = PROVISIONAL_MDC.get(metric_id)
    return MdcValue(value=placeholder, source="provisional") if placeholder is not None else None


def mdc_for(metric_id: str) -> float | None:
    """The MDC of a measure, or None if it has none."""
    info = mdc_info(metric_id)
    return info.value if info else None


def any_provisional(metric_ids: list[str]) -> bool:
    return any((info := mdc_info(metric_id)) is not None and info.source == "provisional" for metric_id in metric_ids)
