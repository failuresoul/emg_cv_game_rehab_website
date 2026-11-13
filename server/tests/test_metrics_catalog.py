import json
from pathlib import Path

import pytest

from app.services import metrics_catalog
from app.services.metrics_catalog import (
    MetricsCatalogUnavailableError,
    get_metric,
    load_catalog,
)

REQUIRED = [
    *("K1", "K5", "K6", "K7", "K8", "K9", "K10", "K12"),
    *("R1", "R2", "R3", "R4"),
    *("H1", "H2", "H3", "H4", "H5", "H6"),
    *("G1", "G2", "G3", "G4"),
    # The muscle sensor (Day 16).
    *("E2", "E3", "E5", "E6", "E8", "E9"),
    *("P1", "P2", "P3"),
]


def test_the_catalog_has_every_required_metric_once() -> None:
    ids = [metric.id for metric in load_catalog()]
    assert ids == REQUIRED
    assert len(set(ids)) == len(ids)


def test_each_entry_is_complete() -> None:
    for metric in load_catalog():
        assert metric.name and metric.unit and metric.source and metric.description
        assert metric.better_when in ("higher", "lower", "closer_to_zero")
        if metric.level == "trial":
            assert metric.games, f"{metric.id} names no games"


@pytest.mark.parametrize(
    ("metric_id", "better_when"),
    [
        ("K5", "lower"),
        ("K7", "higher"),
        ("K8", "closer_to_zero"),
        ("H3", "lower"),
        ("P3", "higher"),
    ],
)
def test_which_way_is_better(metric_id: str, better_when: str) -> None:
    metric = get_metric(metric_id)
    assert metric is not None and metric.better_when == better_when


def test_unknown_metric() -> None:
    assert get_metric("Z9") is None


def test_a_missing_or_broken_catalog_is_a_clear_error(tmp_path: Path) -> None:
    with pytest.raises(MetricsCatalogUnavailableError):
        metrics_catalog._load(tmp_path / "nowhere.json")
    repeated = tmp_path / "repeated.json"
    entry = {
        "id": "K1",
        "name": "Reach area",
        "unit": "sw2",
        "better_when": "higher",
        "source": "calibration.hull_area_sw2",
        "level": "session",
        "description": "Area.",
    }
    repeated.write_text(json.dumps({"metrics": [entry, entry]}), encoding="utf-8")
    with pytest.raises(MetricsCatalogUnavailableError):
        metrics_catalog._load(repeated)
