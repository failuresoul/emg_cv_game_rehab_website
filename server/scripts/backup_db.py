"""Back up or restore the SQLite database (Day 20), safely while the server runs: SQLite's own
backup copies a consistent snapshot, including what is still in the WAL file.

    python scripts/backup_db.py backup <file.db>    # copy the database to <file.db>
    python scripts/backup_db.py restore <file.db>   # replace the database (stop the server first)

The database is the one DATABASE_URL names (server/.env, or the environment). Used by
scripts/backup.ps1 and scripts/restore.ps1.
"""

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import make_url  # noqa: E402

from app.core.config import SERVER_DIR, settings  # noqa: E402


def database_path() -> Path:
    url = make_url(settings.DATABASE_URL)
    if url.get_backend_name() != "sqlite" or url.database in (None, "", ":memory:"):
        raise SystemExit("Only a SQLite file database can be backed up this way (use pg_dump for PostgreSQL).")
    return (SERVER_DIR / Path(url.database)).resolve()


def copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    with sqlite3.connect(target) as check:
        result = check.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"The copy failed its integrity check: {result}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("action", choices=["backup", "restore"])
    parser.add_argument("file", type=Path)
    args = parser.parse_args(argv)
    database = database_path()
    if args.action == "backup":
        if not database.exists():
            raise SystemExit(f"No database at {database}")
        copy(database, args.file)
        print(f"Backed up {database} to {args.file}")
    else:
        if not args.file.exists():
            raise SystemExit(f"No backup at {args.file}")
        copy(args.file, database)
        print(f"Restored {args.file} to {database}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
