"""Print one session's feedback report and its meta as JSON, or list the sessions to try.

    cd server
    .venv\\Scripts\\python.exe -m app.feedback.cli --list
    .venv\\Scripts\\python.exe -m app.feedback.cli 12
    .venv\\Scripts\\python.exe -m app.feedback.cli 12 --model phi4-mini --language bn

Uses LLM_PROVIDER from server/.env (ollama: the Ollama app must be running).
"""

import argparse
import json
import sys

from sqlmodel import Session, col, select

from app.core.db import engine
from app.feedback.rules import red_flags
from app.feedback.service import as_json, generate_report
from app.models import PatientProfile
from app.models import Session as SessionRecord
from app.services.session_facts import build_facts


def list_sessions(db: Session) -> list[str]:
    """One line per completed session: id, patient code, number, flags and changes. Codes only,
    never names."""
    rows = db.exec(
        select(SessionRecord, PatientProfile)
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        .where(SessionRecord.status == "completed")
        .order_by(col(PatientProfile.patient_code), col(SessionRecord.started_at))
    ).all()
    lines = [f"{'id':>5}  {'patient':8} {'no':>3}  {'date':10}  notes"]
    for record, patient in rows:
        facts = build_facts(db, record)
        statuses = [m.mdc_status for m in facts.metrics]
        notes = []
        if not facts.baseline_available:
            notes.append("first sessions (no baseline)")
        else:
            notes.append(f"{statuses.count('improved')} improved, {statuses.count('worse')} worse")
        flags = [flag.code for flag in red_flags(facts)]
        if flags:
            notes.append("RED FLAG: " + ", ".join(flags))
        lines.append(
            f"{record.id:>5}  {patient.patient_code:8} {facts.session_no:>3}  "
            f"{record.started_at:%Y-%m-%d}  {'; '.join(notes)}"
        )
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a session's feedback report.")
    parser.add_argument("session_id", type=int, nargs="?")
    parser.add_argument("--list", action="store_true", help="list completed sessions to try")
    parser.add_argument("--model", help="an Ollama model tag; default LLM_MODEL")
    parser.add_argument("--language", choices=["en", "bn"], default="en")
    args = parser.parse_args(argv)
    # Bangla on a Windows console.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if args.list:
        with Session(engine) as db:
            print("\n".join(list_sessions(db)))
        return 0
    if args.session_id is None:
        parser.error("give a session id, or --list")
    try:
        result = generate_report(args.session_id, args.language, args.model)
    except LookupError as error:
        print(error, file=sys.stderr)
        return 1
    print(json.dumps(as_json(result), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
