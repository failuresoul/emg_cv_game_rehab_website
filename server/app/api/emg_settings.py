from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import CurrentUser, SessionDep, require_admin
from app.models import EmgSettingsRecord, User
from app.schemas.emg_settings import EmgSettingsRead, EmgSettingsUpdate
from app.services import emg_settings

router = APIRouter(tags=["emg-settings"])


def _read(record: EmgSettingsRecord | None) -> EmgSettingsRead:
    if record is None:
        return EmgSettingsRead(overrides={}, updated_at=None)
    return EmgSettingsRead(overrides=record.overrides, updated_at=record.updated_at)


@router.get("/emg-settings", response_model=EmgSettingsRead)
def read_emg_settings(_user: CurrentUser, session: SessionDep) -> EmgSettingsRead:
    """The EMG thresholds the admin changed; every signed-in browser applies them."""
    return _read(emg_settings.get(session))


@router.put("/admin/emg-settings", response_model=EmgSettingsRead)
def update_emg_settings(
    body: EmgSettingsUpdate,
    session: SessionDep,
    admin: Annotated[User, Depends(require_admin)],
) -> EmgSettingsRead:
    try:
        record = emg_settings.save(session, body.overrides, admin)
    except emg_settings.InvalidEmgSettings as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=error.problems
        ) from error
    return _read(record)


@router.delete("/admin/emg-settings", response_model=EmgSettingsRead)
def reset_emg_settings(
    session: SessionDep, admin: Annotated[User, Depends(require_admin)]
) -> EmgSettingsRead:
    """Every threshold back to its default."""
    return _read(emg_settings.reset(session, admin))
