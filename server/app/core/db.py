from collections.abc import Generator
from pathlib import Path

from typing import Any

from sqlalchemy import URL, Engine, event, inspect, make_url, text
from sqlmodel import Session, SQLModel, create_engine

from app import models  # noqa: F401  (registers the tables on SQLModel.metadata)
from app.core.config import SERVER_DIR, settings


#: The database file's name before Day 20 (the internal code name); renamed to muvi.db.
LEGACY_DATABASE_NAME = "motionlab.db"
DATABASE_NAME = "muvi.db"


def migrate_legacy_database(path: Path) -> bool:
    """A muvi.db that does not exist yet, beside an old motionlab.db: rename the old file (and
    its WAL and shared-memory files), so an existing installation keeps its data. True if it
    renamed anything."""
    if path.name != DATABASE_NAME or path.exists():
        return False
    legacy = path.with_name(LEGACY_DATABASE_NAME)
    if not legacy.exists():
        return False
    for suffix in ("", "-wal", "-shm"):
        old = legacy.with_name(LEGACY_DATABASE_NAME + suffix)
        if old.exists():
            old.rename(path.with_name(DATABASE_NAME + suffix))
    return True


def _resolve_database_url(database_url: str) -> URL:
    """Anchor relative SQLite paths to server/ and create their folder if missing. Pure apart
    from the folder: it never moves a file (the migration runs only when the app opens its
    database, in _create_engine)."""
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or url.database in (None, "", ":memory:"):
        return url

    path = (SERVER_DIR / Path(url.database)).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return url.set(database=str(path))


#: How long a SQLite write waits for another to finish before "database is locked" (Day 18).
SQLITE_BUSY_TIMEOUT_S = 15


def _create_engine(database_url: str) -> Engine:
    url = _resolve_database_url(database_url)
    if url.get_backend_name() != "sqlite":
        return create_engine(url)
    if url.database not in (None, "", ":memory:"):
        # An installation from before Day 20: its motionlab.db becomes muvi.db.
        migrate_legacy_database(Path(url.database))
    created = create_engine(
        url, connect_args={"check_same_thread": False, "timeout": SQLITE_BUSY_TIMEOUT_S}
    )
    if url.database not in (None, "", ":memory:"):
        # A file database: readers do not wait for a writer (WAL), and writers wait for each
        # other for up to the busy timeout instead of failing at once.
        @event.listens_for(created, "connect")
        def _sqlite_pragmas(connection: Any, _: Any) -> None:
            cursor = connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_S * 1000}")
            cursor.close()

    return created


engine = _create_engine(settings.DATABASE_URL)


# Columns added after their table was first created. create_all() makes new tables but never
# changes existing ones, so a database from an earlier day gets these with ALTER TABLE.
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "session": {
        "flags": "JSON NOT NULL DEFAULT '[]'",
        "needs_review": "BOOLEAN NOT NULL DEFAULT 0",
        "reviewed_at": "DATETIME",
        "review_note": "VARCHAR",
        "current_step": "VARCHAR NOT NULL DEFAULT 'setup'",
        "game_queue": "JSON",
        "plan": "JSON",
        "plan_overrides": "JSON NOT NULL DEFAULT '[]'",
        "study_id": "INTEGER",
        "study_condition": "VARCHAR",
        "repeatability_visit": "INTEGER",
    },
    "gamerun": {
        "study_id": "INTEGER",
        "condition": "VARCHAR",
    },
    "patientprofile": {
        "weekly_goal": "INTEGER NOT NULL DEFAULT 5",
        "is_demo": "BOOLEAN NOT NULL DEFAULT 0",
        "engine_mode": "VARCHAR NOT NULL DEFAULT 'L1'",
        "max_difficulty": "JSON NOT NULL DEFAULT '{}'",
        "research_consent_at": "DATE",
        "repeatability_next_visit": "INTEGER",
        "bengali_digits": "BOOLEAN NOT NULL DEFAULT 0",
        "text_size": "VARCHAR NOT NULL DEFAULT 'normal'",
        "high_contrast": "BOOLEAN NOT NULL DEFAULT 0",
        "reduce_motion": "BOOLEAN NOT NULL DEFAULT 0",
        "sound_on": "BOOLEAN NOT NULL DEFAULT 1",
        "voice_on": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "trial": {
        "metrics_server": "JSON",
        "data_quality": "JSON",
        "emg": "JSON",
    },
    "adaptationlog": {
        "details": "JSON",
    },
    "llmreport": {
        "strategy": "VARCHAR",
        "review_set_id": "INTEGER",
    },
    "reportrating": {
        "review_set_id": "INTEGER",
        "unsafe": "BOOLEAN",
        "unsupported_text": "VARCHAR",
    },
}


#: Indexes added after their table was first created (Day 18, from the load test's queries):
#: a patient's sessions newest first, game runs in order, and the review items' lookups.
#: CREATE INDEX IF NOT EXISTS works the same on a new and an old database (SQLite and PostgreSQL).
ADDED_INDEXES: dict[str, tuple[str, tuple[str, ...]]] = {
    "ix_session_patient_started": ("session", ("patient_id", "started_at")),
    "ix_gamerun_session_started": ("gamerun", ("session_id", "started_at")),
    "ix_reviewitem_session_id": ("reviewitem", ("session_id",)),
    "ix_reviewitem_report_id": ("reviewitem", ("report_id",)),
}


def add_missing_indexes(target: Engine) -> None:
    tables = set(inspect(target).get_table_names())
    with target.begin() as connection:
        for name, (table, columns) in ADDED_INDEXES.items():
            if table not in tables:
                continue
            listed = ", ".join(f'"{column}"' for column in columns)
            connection.execute(text(f'CREATE INDEX IF NOT EXISTS {name} ON "{table}" ({listed})'))


def add_missing_columns(target: Engine) -> None:
    inspector = inspect(target)
    tables = set(inspector.get_table_names())
    with target.begin() as connection:
        for table, columns in ADDED_COLUMNS.items():
            if table not in tables:
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    statement = f'ALTER TABLE "{table}" ADD COLUMN {name} {definition}'
                    connection.execute(text(statement))


def create_db_and_tables(target: Engine | None = None) -> None:
    target = target or engine
    SQLModel.metadata.create_all(target)
    add_missing_columns(target)
    add_missing_indexes(target)
    # Day 17: each patient's programme, from the old profile fields where there is none yet.
    from app.services.programme import migrate_programmes

    migrate_programmes(target)
    # Day 17: the questionnaire's safety flags as Alert rows.
    from app.services.alerts import migrate_session_flags

    migrate_session_flags(target)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
