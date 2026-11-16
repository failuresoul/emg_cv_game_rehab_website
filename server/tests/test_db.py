from pathlib import Path

from app.core.config import SERVER_DIR
from app.core.db import _resolve_database_url


def test_absolute_sqlite_path_creates_parent_folder(tmp_path: Path) -> None:
    database = tmp_path / "nested" / "folder" / "muvi.db"

    url = _resolve_database_url(f"sqlite:///{database.as_posix()}")

    assert database.parent.is_dir()
    assert Path(url.database or "") == database


def test_relative_sqlite_path_starts_from_server_folder() -> None:
    url = _resolve_database_url("sqlite:///../data/muvi.db")

    assert Path(url.database or "") == (SERVER_DIR.parent / "data" / "muvi.db").resolve()


def test_in_memory_and_postgres_urls_are_unchanged() -> None:
    assert _resolve_database_url("sqlite://").database is None
    postgres = _resolve_database_url("postgresql+psycopg://user:secret@host/muvi")
    assert postgres.database == "muvi"


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


def test_an_old_motionlab_db_is_renamed_to_muvi_db(tmp_path: Path) -> None:
    """Day 20: the database file's old name (the code name) moves to muvi.db, with its WAL and
    shared-memory files, so an existing installation keeps its data."""
    from app.core.db import migrate_legacy_database

    for suffix, text in (("", "data"), ("-wal", "wal"), ("-shm", "shm")):
        (tmp_path / f"motionlab.db{suffix}").write_text(text)
    target = tmp_path / "muvi.db"
    assert migrate_legacy_database(target) is True
    assert target.read_text() == "data"
    assert (tmp_path / "muvi.db-wal").read_text() == "wal"
    assert (tmp_path / "muvi.db-shm").read_text() == "shm"
    assert not (tmp_path / "motionlab.db").exists()


def test_the_migration_never_overwrites_or_touches_other_files(tmp_path: Path) -> None:
    from app.core.db import migrate_legacy_database

    (tmp_path / "motionlab.db").write_text("old")
    (tmp_path / "muvi.db").write_text("new")
    assert migrate_legacy_database(tmp_path / "muvi.db") is False
    assert (tmp_path / "muvi.db").read_text() == "new"
    assert (tmp_path / "motionlab.db").read_text() == "old"
    # Another name (a test database, an e2e database) is never migrated.
    assert migrate_legacy_database(tmp_path / "e2e-test.db") is False
    # Nothing to migrate.
    assert migrate_legacy_database(tmp_path / "empty" / "muvi.db") is False
