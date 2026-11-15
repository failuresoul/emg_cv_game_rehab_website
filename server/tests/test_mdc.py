"""Measured or provisional MDCs (Day 19): app/core/mdc.py reads the validation's mdc.json."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.core import mdc
from app.core.config import settings
from app.schemas.metrics import MetricPoint, MetricSeries
from app.services.progress import metric_change


def write(path: Path, metrics: dict[str, Any], label: str = "REAL DATA") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"label": label, "generated_at": "2026-11-17T10:00:00+00:00", "metrics": metrics}), encoding="utf-8")
    return path


@pytest.fixture
def mdc_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "results" / "validation" / "mdc.json"
    monkeypatch.setattr(settings, "MDC_PATH", str(path))
    return path


def test_without_a_file_every_mdc_is_provisional(mdc_file: Path) -> None:
    assert not mdc_file.exists()
    info = mdc.mdc_info("K1")
    assert info is not None and info.source == "provisional" and info.value == mdc.PROVISIONAL_MDC["K1"]
    assert mdc.mdc_info("NOPE") is None
    assert mdc.mdc_for("K1") == mdc.PROVISIONAL_MDC["K1"]


def test_a_usable_measured_value_is_used_with_its_provenance(mdc_file: Path) -> None:
    write(mdc_file, {"K1": {"mdc95": 0.31, "sem": 0.11, "visits": 3, "participants": 1}})
    info = mdc.mdc_info("K1")
    assert info is not None
    assert (info.source, info.value, info.visits, info.participants) == ("measured", 0.31, 3, 1)
    assert info.generated_at == "2026-11-17T10:00:00+00:00"
    assert info.sha256 and len(info.sha256) == 64
    # The others stay provisional.
    assert mdc.mdc_info("K5").source == "provisional"  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("entry", "reason"),
    [
        ({"mdc95": 0, "visits": 3}, "positive"),
        ({"mdc95": -1.0, "visits": 3}, "positive"),
        ({"mdc95": float("nan"), "visits": 3}, "positive"),
        ({"mdc95": "0.3", "visits": 3}, "not a number"),
        ({"mdc95": True, "visits": 3}, "not a number"),
        ({"mdc95": 0.3, "visits": 1}, "visits"),
        ({"mdc95": 0.3}, "visits"),
        ({"mdc95": 0.3, "visits": 3, "participants": 0}, "participants"),
        ("0.3", "not an object"),
    ],
)
def test_unusable_values_are_refused_with_a_reason(mdc_file: Path, entry: Any, reason: str) -> None:
    write(mdc_file, {"K1": entry})
    measured = mdc.table()
    assert "K1" not in measured.measured
    assert reason in measured.rejected["K1"]
    assert mdc.mdc_info("K1").source == "provisional"  # type: ignore[union-attr]


def test_an_unknown_measure_is_refused(mdc_file: Path) -> None:
    write(mdc_file, {"ZZ9": {"mdc95": 1.0, "visits": 3}})
    assert "catalogue" in mdc.table().rejected["ZZ9"]


def test_a_demo_file_is_never_used(mdc_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Labelled as the demo, wherever it is.
    write(mdc_file, {"K1": {"mdc95": 0.31, "visits": 3}}, label="DEMO — SYNTHETIC")
    assert mdc.table().measured == {}
    assert "*" in mdc.table().rejected
    # Or in the demo folder, whatever its label.
    demo = write(tmp_path / "results" / "validation_demo" / "mdc.json", {"K1": {"mdc95": 0.31, "visits": 3}})
    monkeypatch.setattr(settings, "MDC_PATH", str(demo))
    assert mdc.table().measured == {}
    assert "demo folder" in mdc.table().rejected["*"]


def test_a_broken_file_leaves_everything_provisional(mdc_file: Path) -> None:
    mdc_file.parent.mkdir(parents=True, exist_ok=True)
    mdc_file.write_text("{not json", encoding="utf-8")
    assert mdc.table().measured == {}
    assert "cannot be read" in mdc.table().rejected["*"]
    write(mdc_file, {"K1": {"mdc95": 0.31, "visits": 3}})
    # Read again when the file changes.
    assert "K1" in mdc.table().measured


def test_the_default_place_is_the_real_results_folder() -> None:
    assert mdc.MEASURED_PATH.parts[-3:] == ("results", "validation", "mdc.json")
    assert "validation_demo" not in str(mdc.MEASURED_PATH)


def test_a_metric_change_shows_where_its_mdc_came_from(mdc_file: Path) -> None:
    series = MetricSeries(
        metric_id="K1", game_id=None, name="Reach area", unit="sw2", better_when="higher",
        points=[MetricPoint(session_id=i, date="2026-11-0%dT10:00:00Z" % (i + 1), value=v)  # type: ignore[arg-type]
                for i, v in enumerate([1.0, 1.0, 1.5])],
    )
    before = metric_change(series)
    assert (before.provisional, before.mdc_source, before.status) == (True, "provisional", "improved")
    write(mdc_file, {"K1": {"mdc95": 0.6, "visits": 3, "participants": 1}})
    after = metric_change(series)
    assert (after.provisional, after.mdc_source, after.mdc_participants, after.mdc_visits) == (False, "measured", 1, 3)
    # Measured noise of 0.6: a 0.5 gain is no longer a detectable change.
    assert after.status == "no_detectable_change"


def test_the_backfill_reports_each_mdc_source_and_the_statuses(mdc_file: Path, session: Any) -> None:
    from scripts.backfill_metrics import status_report

    write(mdc_file, {"K1": {"mdc95": 0.6, "visits": 3, "participants": 1}, "K5": {"mdc95": -1, "visits": 3}})
    lines = status_report(session)
    assert any("K1: 0.6 measured (n=1, 3 visits)" in line for line in lines)
    assert any("K6:" in line and "provisional" in line for line in lines)
    assert any("not used K5" in line and "positive" in line for line in lines)
    assert lines[-1].startswith("Statuses now:")
