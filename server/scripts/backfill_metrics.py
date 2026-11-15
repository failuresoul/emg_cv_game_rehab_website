"""Compute the server's measures for sessions saved before they existed.

Run from server/ with the virtual environment active:

    python scripts/backfill_metrics.py                 # every completed session
    python scripts/backfill_metrics.py --session-id 12 # one session, whatever its status

For each session it recomputes every trial's server measures from the RAW data
(Trial.metrics_server and data_quality), then the session's catalogue measures (SessionMetric),
replacing any computed before. Running it again gives the same result. It prints a short report.

Then it recomputes every patient's metric statuses (improved, no detectable change, worse)
against the current MDCs (app/core/mdc.py: measured from the validation's mdc.json, or
provisional) and reports them, with each MDC's source. Statuses are not stored: the admin's
Metrics page and the reports compute them on reading, so this shows what they now say.
"""

import argparse
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, col, select

from app.core.db import create_db_and_tables, engine
from app.models import Session as SessionRecord
from app.services import session_metrics, trial_metrics


@dataclass
class BackfillReport:
    sessions: int = 0
    trials: int = 0
    #: Trials where a server measure differs from the browser's by more than 10%.
    mismatched_trials: int = 0
    metric_rows: int = 0
    #: How many sessions have each catalogue measure.
    metrics: Counter[str] = field(default_factory=Counter)
    #: Sessions that could not be computed, with why.
    failed: list[tuple[int, str]] = field(default_factory=list)

    def lines(self) -> list[str]:
        counts = sorted(self.metrics.items())
        found = ", ".join(f"{metric_id} {count}" for metric_id, count in counts)
        lines = [
            f"Sessions computed: {self.sessions}",
            f"Trials recomputed: {self.trials} ({self.mismatched_trials} with a mismatch over 10%)",
            f"Session metric rows saved: {self.metric_rows}",
            f"Sessions per measure: {found or 'none'}",
        ]
        lines += [f"FAILED session {session_id}: {reason}" for session_id, reason in self.failed]
        return lines


def completed_session_ids(session: Session) -> list[int]:
    statement = (
        select(SessionRecord.id)
        .where(SessionRecord.status == "completed")
        .order_by(col(SessionRecord.id))
    )
    return [found for found in session.exec(statement).all() if found is not None]


def backfill(session: Session, session_ids: Sequence[int] | None = None) -> BackfillReport:
    """Every completed session, or the sessions given. One failing session is reported and the
    others still computed."""
    report = BackfillReport()
    for session_id in completed_session_ids(session) if session_ids is None else session_ids:
        try:
            trials = trial_metrics.recompute(session, session_id)
            rows = session_metrics.compute_session_metrics(session, session_id)
        except Exception as error:  # noqa: BLE001 - reported, and the rest carry on
            session.rollback()
            report.failed.append((session_id, f"{type(error).__name__}: {error}"))
            continue
        report.sessions += 1
        report.trials += trials.trials
        report.mismatched_trials += trials.mismatched_trials
        report.metric_rows += len(rows)
        report.metrics.update({row.metric_id for row in rows})
    return report


def status_report(session: Session) -> list[str]:
    """Each MDC's source, any measured value refused and why, and every patient's statuses."""
    from app.core import mdc
    from app.models import PatientProfile
    from app.services.progress import patient_metrics

    measured = mdc.table()
    lines = [f"MDC file: {measured.path} ({len(measured.measured)} measured)"]
    for metric_id in sorted(mdc.PROVISIONAL_MDC):
        info = mdc.mdc_info(metric_id)
        assert info is not None
        detail = f"measured (n={info.participants}, {info.visits} visits)" if info.source == "measured" else "provisional"
        lines.append(f"  {metric_id}: {info.value:g} {detail}")
    for metric_id, reason in sorted(measured.rejected.items()):
        lines.append(f"  not used {metric_id}: {reason}")
    counts: Counter[str] = Counter()
    for profile in session.exec(select(PatientProfile)).all():
        assert profile.id is not None
        for change in patient_metrics(session, profile.id).metrics:
            counts[change.status] += 1
    lines.append("Statuses now: " + (", ".join(f"{status} {n}" for status, n in sorted(counts.items())) or "none"))
    return lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--session-id", type=int, help="only this session, whatever its status")
    args = parser.parse_args(argv)

    create_db_and_tables()
    with Session(engine) as session:
        ids = None if args.session_id is None else [args.session_id]
        report = backfill(session, ids)
        statuses = status_report(session)
    for line in [*report.lines(), *statuses]:
        print(line)
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
