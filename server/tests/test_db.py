from pathlib import Path

from app.core.config import SERVER_DIR
from app.core.db import _resolve_database_url


def test_absolute_sqlite_path_creates_parent_folder(tmp_path: Path) -> None:
    database = tmp_path / "nested" / "folder" / "motionlab.db"

    url = _resolve_database_url(f"sqlite:///{database.as_posix()}")

    assert database.parent.is_dir()
    assert Path(url.database or "") == database


def test_relative_sqlite_path_starts_from_server_folder() -> None:
    url = _resolve_database_url("sqlite:///../data/motionlab.db")

    assert Path(url.database or "") == (SERVER_DIR.parent / "data" / "motionlab.db").resolve()


def test_in_memory_and_postgres_urls_are_unchanged() -> None:
    assert _resolve_database_url("sqlite://").database is None
    postgres = _resolve_database_url("postgresql+psycopg://user:secret@host/motionlab")
    assert postgres.database == "motionlab"
