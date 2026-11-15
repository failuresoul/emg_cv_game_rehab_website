"""Writes docs/data-dictionary.md from the code, so it cannot drift (Day 19): every database table
and column (types, keys, indexes and the models' own #: comments), the metric catalogue
(shared/metrics-catalog.json), and the facts the feedback model reads (app/schemas/metrics.py).

    python scripts/data_dictionary.py     (from server/)
"""

from __future__ import annotations

import json
import re
import sys
import typing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import SQLModel  # noqa: E402

from app import models  # noqa: E402,F401  (registers every table)
from app.core.db import ADDED_INDEXES  # noqa: E402
from app.schemas import metrics as facts_schema  # noqa: E402

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
OUT = ROOT / "docs" / "data-dictionary.md"
CATALOG = ROOT / "shared" / "metrics-catalog.json"
FIELD = re.compile(r"^\s{4}(\w+)\s*:\s*[^=]+")


def field_comments(path: Path) -> dict[str, dict[str, str]]:
    """Class name to field name to its comment (#: lines above it, or a # comment after it)."""
    found: dict[str, dict[str, str]] = {}
    current: str | None = None
    pending: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("class "):
            current = re.split(r"[ (:]", line[6:], maxsplit=1)[0]
            found[current] = {}
            pending = []
            continue
        stripped = line.strip()
        if current and stripped.startswith("#:"):
            pending.append(stripped[2:].strip())
            continue
        match = FIELD.match(line)
        if current and match and not stripped.startswith(("def ", "@", "#")):
            comment = " ".join(pending)
            if "#" in line and not comment:
                comment = line.split("#", 1)[1].strip()
            if comment:
                found[current][match.group(1)] = comment
        if not stripped.startswith("#:"):
            pending = []
    return found


def model_comments() -> dict[str, dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for path in sorted((SERVER / "app" / "models").glob("*.py")):
        for name, fields in field_comments(path).items():
            merged.setdefault(name, {}).update(fields)
    return merged


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def tables_section() -> list[str]:
    comments = model_comments()
    classes = {mapper.class_.__tablename__: mapper.class_ for mapper in SQLModel._sa_registry.mappers}  # type: ignore[attr-defined]
    extra_indexes: dict[str, list[str]] = {}
    for name, (table, columns) in ADDED_INDEXES.items():
        extra_indexes.setdefault(table, []).append(f"`{name}` ({', '.join(columns)})")
    lines = ["## Database tables", "",
             "SQLite by default (PostgreSQL works too). Tables are created on start and new columns and indexes added by `app/core/db.py`.", ""]
    for table in sorted(SQLModel.metadata.sorted_tables, key=lambda item: item.name):
        model = classes.get(table.name)
        doc = (model.__doc__ or "").strip().split("\n\n")[0] if model is not None else ""
        lines += [f"### `{table.name}`", ""]
        if doc and not doc.startswith(("Usage docs", "A SQLModel")):
            lines += [cell(" ".join(doc.split())), ""]
        lines += ["| Column | Type | Null | Key / index | Description |", "| --- | --- | --- | --- | --- |"]
        notes = comments.get(model.__name__, {}) if model is not None else {}
        for column in table.columns:
            keys = []
            if column.primary_key:
                keys.append("PK")
            for foreign in column.foreign_keys:
                keys.append(f"FK → {foreign.target_fullname}")
            if column.unique:
                keys.append("unique")
            if column.index:
                keys.append("index")
            lines.append(f"| `{column.name}` | {cell(str(column.type))} | {'yes' if column.nullable else 'no'} | {', '.join(keys)} | {cell(notes.get(column.name, ''))} |")
        if table.name in extra_indexes:
            lines += ["", "Also indexed: " + "; ".join(extra_indexes[table.name]) + "."]
        lines.append("")
    return lines


def catalog_section() -> list[str]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    lines = ["## Metric catalogue", "", cell(catalog.get("description", "")), "",
             "The MDC of each measure is in `server/app/core/mdc.py` (measured from the validation's `mdc.json`, or provisional).", "",
             "| Id | Name | Unit | Better when | Level | Source | Description |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for metric in catalog["metrics"]:
        lines.append("| " + " | ".join(cell(str(metric.get(key, ""))) for key in ("id", "name", "unit", "better_when", "level", "source", "description")) + " |")
    return lines + [""]


def type_name(annotation: typing.Any) -> str:
    text = str(annotation).replace("typing.", "")
    return re.sub(r"<class '([\w.]+)'>", lambda m: m.group(1).split(".")[-1], text).replace("app.schemas.metrics.", "")


def facts_section() -> list[str]:
    comments = field_comments(SERVER / "app" / "schemas" / "metrics.py")
    names = ["SessionFacts", *sorted(name for name in dir(facts_schema) if name.startswith("Facts") and name != "SessionFacts")]
    lines = ["## Session facts (what the feedback model reads)", "",
             "The facts JSON of a session (`GET /api/sessions/{id}/facts`), the only input of the feedback model. "
             "No name or email; the patient is a code. See also [session-facts.md](session-facts.md).", ""]
    for name in names:
        model = getattr(facts_schema, name, None)
        if model is None or not hasattr(model, "model_fields"):
            continue
        lines += [f"### `{name}`", "", "| Field | Type | Description |", "| --- | --- | --- |"]
        for field_name, info in model.model_fields.items():
            lines.append(f"| `{field_name}` | {cell(type_name(info.annotation))} | {cell(comments.get(name, {}).get(field_name, ''))} |")
        lines.append("")
    return lines


def main() -> int:
    lines = ["# Data dictionary", "",
             "Generated by `server/scripts/data_dictionary.py` from the code; do not edit by hand (run it again after a model changes).", ""]
    lines += tables_section() + catalog_section() + facts_section()
    OUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
