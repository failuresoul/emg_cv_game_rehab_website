from collections.abc import Generator
from pathlib import Path

from sqlalchemy import URL, Engine, make_url
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


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
