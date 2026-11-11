"""The measures MotionLab reports, from shared/metrics-catalog.json."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.core.config import settings

BetterWhen = Literal["higher", "lower", "closer_to_zero"]


class CatalogMetric(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str
    name: str
    unit: str
    better_when: BetterWhen
    source: str
    description: str
    #: Where the figure comes from: one trial, a warm-up result, or a whole session.
    level: Literal["trial", "warmup", "session"]
    #: The games a trial-level figure comes from; empty for other levels.
    games: tuple[str, ...] = ()


class _CatalogFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metrics: list[CatalogMetric]


class MetricsCatalogUnavailableError(RuntimeError):
    """shared/metrics-catalog.json is missing or not valid."""


@lru_cache(maxsize=4)
def _load(path: Path) -> tuple[CatalogMetric, ...]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise MetricsCatalogUnavailableError(
            f"Cannot read the metrics catalog at {path}: {error}"
        ) from error
    metrics = tuple(_CatalogFile.model_validate(data).metrics)
    ids = [metric.id for metric in metrics]
    if len(set(ids)) != len(ids):
        raise MetricsCatalogUnavailableError(f"Repeated metric ids in {path}")
    return metrics


def load_catalog() -> tuple[CatalogMetric, ...]:
    """Every metric, in the file's order. Read once and kept."""
    return _load(settings.metrics_catalog_path)


def get_metric(metric_id: str) -> CatalogMetric | None:
    return next((metric for metric in load_catalog() if metric.id == metric_id), None)
