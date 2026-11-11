"""CSV exports for research, admin only.

Pseudonymous: patients appear only by their code (P001, ...), never by name or email. Columns
are plain values; JSON objects (a trial's params, target and timings) are written as JSON text
in one column so every trial fits one row whatever its game.
"""

import csv
import io
import json
import math
from collections.abc import Iterable, Sequence
from typing import Any

from sqlmodel import Session, col, select

from app.models import GameRun, PatientProfile, SessionMetric, Trial
from app.models import Session as SessionRecord
from app.schemas.common import as_utc
from app.services.metrics_catalog import get_metric

METRIC_COLUMNS = (
    "patient_code",
    "session_id",
    "session_started_at",
    "session_status",
    "metric_id",
    "metric_name",
    "game_id",
    "value",
    "unit",
    "n",
    "computed_at",
)
TRIAL_COLUMNS = (
    "patient_code",
    "is_demo",
    "session_id",
    "session_started_at",
    "run_id",
    "game_id",
    "engine",
    "input_source",
    "trial_no",
    "outcome",
    "compensated",
    "params",
    "target",
    "timings",
    "n_points",
    "sampling_hz",
    "gaps_over_200ms",
    "mismatches",
)
#: Server measures become columns named server_<measure>.
SERVER_PREFIX = "server_"


def _cell(value: Any) -> str | int | float:
    """One CSV cell: numbers and text as they are, nothing as empty, objects as JSON."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else ""
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _write(columns: Sequence[str], rows: Iterable[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(columns), lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({name: _cell(row.get(name)) for name in columns})
    return buffer.getvalue()


def _iso(moment: Any) -> str:
    return as_utc(moment).isoformat() if moment is not None else ""


def patient_metrics_csv(session: Session, profile: PatientProfile) -> str:
    """Every stored session measure of one patient, one row each (long format), oldest first."""
    statement = (
        select(SessionMetric, SessionRecord)
        .join(SessionRecord, col(SessionRecord.id) == col(SessionMetric.session_id))
        .where(SessionRecord.patient_id == profile.id)
        .order_by(
            col(SessionRecord.started_at),
            col(SessionRecord.id),
            col(SessionMetric.metric_id),
            col(SessionMetric.game_id),
        )
    )
    rows = []
    for metric, record in session.exec(statement).all():
        found = get_metric(metric.metric_id)
        rows.append(
            {
                "patient_code": profile.patient_code,
                "session_id": record.id,
                "session_started_at": _iso(record.started_at),
                "session_status": record.status,
                "metric_id": metric.metric_id,
                "metric_name": found.name if found else "",
                "game_id": metric.game_id,
                "value": metric.value,
                "unit": metric.unit,
                "n": metric.n,
                "computed_at": _iso(metric.computed_at),
            }
        )
    return _write(METRIC_COLUMNS, rows)


def trials_csv(session: Session) -> str:
    """Every trial of every patient, one row each, by patient code, session and trial number.

    The server's measures (Trial.metrics_server) are spread into server_<measure> columns, one
    for each measure any trial has, so the file can be opened straight in a spreadsheet.
    """
    statement = (
        select(Trial, GameRun, SessionRecord, PatientProfile)
        .join(GameRun, col(GameRun.id) == col(Trial.game_run_id))
        .join(SessionRecord, col(SessionRecord.id) == col(GameRun.session_id))
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        .order_by(
            col(PatientProfile.patient_code),
            col(SessionRecord.started_at),
            col(GameRun.id),
            col(Trial.trial_no),
        )
    )
    rows: list[dict[str, Any]] = []
    measures: set[str] = set()
    for trial, run, record, profile in session.exec(statement).all():
        quality = trial.data_quality or {}
        server = trial.metrics_server or {}
        measures.update(server)
        rows.append(
            {
                "patient_code": profile.patient_code,
                "is_demo": profile.is_demo,
                "session_id": record.id,
                "session_started_at": _iso(record.started_at),
                "run_id": run.id,
                "game_id": run.game_id,
                "engine": run.engine,
                "input_source": run.input_source,
                "trial_no": trial.trial_no,
                "outcome": trial.outcome,
                "compensated": bool((trial.compensation or {}).get("flagged")),
                "params": trial.params or {},
                "target": trial.target,
                "timings": trial.timings or {},
                "n_points": quality.get("n_points"),
                "sampling_hz": quality.get("sampling_hz"),
                "gaps_over_200ms": quality.get("gaps_over_200ms"),
                "mismatches": ",".join(sorted(quality.get("mismatches") or {})),
                **{SERVER_PREFIX + key: value for key, value in server.items()},
            }
        )
    columns = [*TRIAL_COLUMNS, *(SERVER_PREFIX + key for key in sorted(measures))]
    return _write(columns, rows)
