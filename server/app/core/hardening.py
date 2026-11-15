"""Day 18 security and robustness: request limits, safe error answers and security headers.

- BodyGuard (ASGI middleware): a JSON body over MAX_BODY_BYTES is refused with 413, and one
  nested deeper than MAX_JSON_DEPTH with 422, before it is parsed (Python's parser fails with a
  RecursionError on very deep input, which would be a 500). The largest real body, 50 trials
  of 2,000 trajectory points, is about 3 MB and 6 levels deep.
- security_headers: nosniff, no referrer, no framing, and no caching of API answers.
- Error handlers: a database that stays locked answers 503 with Retry-After (the app's
  requests retry); any other unexpected error answers 500 with a fixed message, never a stack
  trace. The details go to the server log.
"""

import logging
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import OperationalError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.errors")

MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_JSON_DEPTH = 32
LOCKED_RETRY_AFTER_S = 1

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
}


def json_depth(body: bytes) -> int:
    """The deepest nesting of [ and { in a JSON text, outside strings (without parsing it)."""
    depth = deepest = 0
    in_string = escaped = False
    for byte in body:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:  # backslash
                escaped = True
            elif byte == 0x22:  # quote
                in_string = False
        elif byte == 0x22:
            in_string = True
        elif byte in (0x5B, 0x7B):  # [ {
            depth += 1
            deepest = max(deepest, depth)
        elif byte in (0x5D, 0x7D):  # ] }
            depth -= 1
    return deepest


async def _reply(send: Send, status: int, detail: str) -> None:
    response = JSONResponse({"detail": detail}, status_code=status, headers=SECURITY_HEADERS)
    await send({"type": "http.response.start", "status": status, "headers": response.raw_headers})
    await send({"type": "http.response.body", "body": response.body})


class BodyGuard:
    """Reads a JSON request's body (at most MAX_BODY_BYTES), checks its depth, then hands the
    same body on to the app."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            await _reply(send, 413, "The request is too large")
            return
        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > MAX_BODY_BYTES:
                await _reply(send, 413, "The request is too large")
                return
            chunks.append(chunk)
            more = message.get("more_body", False)
        body = b"".join(chunks)
        is_json = headers.get(b"content-type", b"").startswith(b"application/json")
        if is_json and json_depth(body) > MAX_JSON_DEPTH:
            await _reply(send, 422, f"The JSON is nested more than {MAX_JSON_DEPTH} levels deep")
            return

        sent = False

        async def replay() -> Message:
            nonlocal sent
            if sent:
                return await receive()
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)


def install(app: FastAPI) -> None:
    """Adds the guard, the headers and the error handlers to the app."""

    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(OperationalError)
    async def database_error(request: Request, error: OperationalError) -> JSONResponse:
        if "database is locked" in str(error).lower():
            logger.warning("Database locked: %s %s", request.method, request.url.path)
            return JSONResponse(
                {"detail": "The server is busy. Please try again."},
                status_code=503,
                headers={"Retry-After": str(LOCKED_RETRY_AFTER_S)},
            )
        logger.exception("Database error: %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
        logger.exception("Unexpected error: %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    app.add_middleware(BodyGuard)
