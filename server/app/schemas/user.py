from pydantic import BaseModel, ConfigDict

from app.schemas.common import Role, UtcDatetime
from app.schemas.patient import PatientProfileRead


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: Role
    is_active: bool
    created_at: UtcDatetime
    last_login_at: UtcDatetime | None


class MeRead(UserRead):
    patient_profile: PatientProfileRead | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
