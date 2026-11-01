from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app import __version__
from app.api import admin, auth, health, patient, sessions
from app.core.config import settings
from app.core.db import create_db_and_tables, engine
from app.services.users import ensure_admin


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    create_db_and_tables()
    with Session(engine) as session:
        ensure_admin(session)
    yield


app = FastAPI(title="MotionLab API", version=__version__, lifespan=lifespan)



@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, error: RequestValidationError) -> JSONResponse:
    # The default response repeats the input, which echoes rejected passwords and crashes on NaN.
    detail = [
        {"type": item["type"], "loc": item["loc"], "msg": item["msg"]} for item in error.errors()
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": detail})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(patient.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
