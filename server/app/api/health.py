from fastapi import APIRouter

from app import __version__
from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.APP_NAME, "version": __version__}
