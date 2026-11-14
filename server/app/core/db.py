from collections.abc import Generator
from pathlib import Path

from sqlalchemy import URL, Engine, inspect, make_url, text
from sqlmodel import Session, SQLModel, create_engine

from app import models  # noqa: F401  (registers the tables on SQLModel.metadata)
from app.core.config import SERVER_DIR, settings


def _resolve_database_url(database_url: str) -> URL:
    """Anchor relative SQLite paths to server/ and create their folder if missing."""
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or url.database in (None, "", ":memory:"):
        return url

    path = (SERVER_DIR / Path(url.database)).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return url.set(database=str(path))


def _create_engine(database_url: str) -> Engine:
    url = _resolve_database_url(database_url)
    connect_args = {"check_same_thread": False} if url.get_backend_name() == "sqlite" else {}
    return create_engine(url, connect_args=connect_args)


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
    # Day 17: each patient's programme, from the old profile fields where there is none yet.
    from app.services.programme import migrate_programmes

    migrate_programmes(target)
    # Day 17: the questionnaire's safety flags as Alert rows.
    from app.services.alerts import migrate_session_flags

    migrate_session_flags(target)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
