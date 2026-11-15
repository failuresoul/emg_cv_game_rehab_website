from fastapi import APIRouter

from app import __version__
from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.APP_NAME, "version": __version__}


@router.get("/version")
def version() -> dict[str, str]:
    """The release (Day 20): the footer and the admin's System page show it too."""
    return {"app": settings.APP_NAME, "version": __version__, "environment": settings.APP_ENV}
