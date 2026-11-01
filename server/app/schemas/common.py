from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, EmailStr, Field, StringConstraints

Role = Literal["admin", "patient"]
Side = Literal["left", "right"]
AgeBand = Literal["18-29", "30-39", "40-49", "50-59", "60-69", "70+"]
Language = Literal["en", "bn"]

# EmailStr rejects reserved domains such as .local, so use it for new input only.
# Read models use plain str because ADMIN_EMAIL may be admin@motionlab.local.
NormalizedEmail = Annotated[EmailStr, AfterValidator(str.lower)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
MonthsSinceStroke = Annotated[int, Field(ge=0)]


def _as_utc(value: datetime) -> datetime:
    # SQLite drops the timezone; every stored datetime is UTC.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]
