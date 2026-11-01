from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)  # Always stored lowercase.
    full_name: str
    role: str  # "admin" | "patient"
    hashed_password: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    last_login_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
