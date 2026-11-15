"""scripts/backup_db.py (Day 20): a consistent copy of a live SQLite database, and its restore."""

import sqlite3
from pathlib import Path

import pytest

from app.core.config import settings
from scripts import backup_db


def test_backup_and_restore_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = tmp_path / "live.db"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{database.as_posix()}")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE note (text TEXT)")
        connection.execute("INSERT INTO note VALUES ('before')")
    backup = tmp_path / "backups" / "copy.db"
    assert backup_db.main(["backup", str(backup)]) == 0
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE note SET text = 'after'")
    assert backup_db.main(["restore", str(backup)]) == 0
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT text FROM note").fetchone()[0] == "before"


def test_only_a_sqlite_file_can_be_backed_up(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "sqlite://")
    with pytest.raises(SystemExit):
        backup_db.main(["backup", str(tmp_path / "x.db")])
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://u:p@h/db")
    with pytest.raises(SystemExit):
        backup_db.main(["backup", str(tmp_path / "x.db")])
