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


def test_the_added_indexes_exist_and_creating_twice_is_safe() -> None:
    from sqlalchemy import create_engine, inspect

    from app.core.db import ADDED_INDEXES, create_db_and_tables

    target = create_engine("sqlite://")
    create_db_and_tables(target)
    create_db_and_tables(target)  # an existing database: nothing fails, nothing doubles
    inspector = inspect(target)
    for name, (table, columns) in ADDED_INDEXES.items():
        found = {index["name"]: index["column_names"] for index in inspector.get_indexes(table)}
        assert found.get(name) == list(columns), (name, found)
