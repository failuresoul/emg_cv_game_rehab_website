"""The language model behind the feedback reports: a local model in the Ollama app, or a mock.

"The code calculates, the rules decide, the LLM only writes." This module only sends a prompt and
a JSON schema and returns the model's JSON text with its timings; it never decides anything.

- OllamaProvider calls POST {OLLAMA_URL}/api/chat with stream off, the JSON schema as `format`
  (structured output), the sampling options and keep_alive. It sends think=false so thinking
  models answer directly; a model that does not support thinking rejects that, so the request is
  sent again without it once, and the model is remembered (per model, for the process).
- MockProvider returns canned JSON; tests always use it (LLM_PROVIDER=mock).
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.core.config import settings

NANOSECONDS_PER_MS = 1_000_000
#: Models that rejected think=false; the request is sent without it from then on.
_NO_THINK_MODELS: set[str] = set()


class LLMError(RuntimeError):
    """The model could not give an answer."""


class LLMUnavailableError(LLMError):
    """The Ollama app could not be reached."""


class LLMTimeoutError(LLMError):
    """The model did not answer in time."""


class LLMResponseError(LLMError):
    """Ollama refused the request, or the answer was not the JSON asked for."""


@dataclass(frozen=True)
class LLMResult:
    #: The model's answer: JSON text matching the schema.
    text: str
    model: str
    #: Wall-clock time of the request, as measured here.
    latency_ms: float
    prompt_tokens: int | None = None
    output_tokens: int | None = None
    #: Ollama's own timings: reading the prompt, writing the answer, and the whole request.
    prompt_eval_ms: float | None = None
    eval_ms: float | None = None
    total_ms: float | None = None

    @property
    def prompt_rate(self) -> float | None:
        """Prompt tokens read per second."""
        if self.prompt_tokens is None or not self.prompt_eval_ms:
            return None
        return self.prompt_tokens / (self.prompt_eval_ms / 1000)

    @property
    def output_rate(self) -> float | None:
        """Tokens written per second."""
        if self.output_tokens is None or not self.eval_ms:
            return None
        return self.output_tokens / (self.eval_ms / 1000)


@dataclass(frozen=True)
class Health:
    reachable: bool
    models_available: list[str] = field(default_factory=list)
    main_model_present: bool = False
    #: Why it is not reachable, if it is not.
    error: str | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    def generate(
        self, system: str, user: str, json_schema: dict[str, Any], model: str | None = None
    ) -> LLMResult:
        """The model's JSON answer to the prompt, following the schema."""
        ...

    def health(self) -> Health: ...

    def warm_up(self, model: str | None = None) -> None:
        """Loads the model, so the first real report does not wait for it."""
        ...


def _ms(nanoseconds: Any) -> float | None:
    return round(nanoseconds / NANOSECONDS_PER_MS, 1) if isinstance(nanoseconds, int | float) else None


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, int | float) else None


def _same_model(wanted: str, available: str) -> bool:
    """"phi4-mini" is "phi4-mini:latest"."""
    def full(name: str) -> str:
        return name if ":" in name else f"{name}:latest"

    return full(wanted) == full(available)


def _rejects_thinking(response: httpx.Response) -> bool:
    """Ollama answers 400 with, for example, '"phi4-mini" does not support thinking'."""
    if response.status_code != 400:
        return False
    return "think" in response.text.lower()


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        url: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        num_ctx: int | None = None,
        max_tokens: int | None = None,
        timeout_s: float | None = None,
        keep_alive: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.url = (url or settings.OLLAMA_URL).rstrip("/")
        self.model = model or settings.LLM_MODEL
        self.temperature = settings.LLM_TEMPERATURE if temperature is None else temperature
        self.top_p = settings.LLM_TOP_P if top_p is None else top_p
        self.num_ctx = num_ctx or settings.LLM_NUM_CTX
        self.max_tokens = max_tokens or settings.LLM_MAX_TOKENS
        self.timeout_s = timeout_s or settings.LLM_TIMEOUT_S
        self.keep_alive = keep_alive or settings.LLM_KEEP_ALIVE
        self._client = client

    def _post(self, path: str, payload: dict[str, Any], timeout: float) -> httpx.Response:
        try:
            if self._client is not None:
                return self._client.post(f"{self.url}{path}", json=payload, timeout=timeout)
            return httpx.post(f"{self.url}{path}", json=payload, timeout=timeout)
        except httpx.TimeoutException as error:
            raise LLMTimeoutError(
                f"The model {payload.get('model')} did not answer within {timeout:g} s"
            ) from error
        except httpx.HTTPError as error:
            raise LLMUnavailableError(
                f"Could not reach Ollama at {self.url} ({type(error).__name__}). "
                "Is the Ollama app running?"
            ) from error

    def chat_payload(
        self, system: str, user: str, json_schema: dict[str, Any], model: str
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "format": json_schema,
            "options": {
                "temperature": self.temperature,
                "top_p": self.top_p,
                "num_ctx": self.num_ctx,
                "num_predict": self.max_tokens,
            },
            "keep_alive": self.keep_alive,
        }
        if model not in _NO_THINK_MODELS:
            payload["think"] = False
        return payload

    def generate(
        self, system: str, user: str, json_schema: dict[str, Any], model: str | None = None
    ) -> LLMResult:
        model = model or self.model
        payload = self.chat_payload(system, user, json_schema, model)
        started = time.perf_counter()
        response = self._post("/api/chat", payload, self.timeout_s)
        if "think" in payload and _rejects_thinking(response):
            # A model without a thinking mode: ask again without the field, and remember it.
            _NO_THINK_MODELS.add(model)
            payload.pop("think")
            response = self._post("/api/chat", payload, self.timeout_s)
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        if response.status_code != 200:
            raise LLMResponseError(
                f"Ollama refused the request for {model} (HTTP {response.status_code}): "
                f"{response.text[:300]}"
            )
        try:
            body = response.json()
        except ValueError as error:
            raise LLMResponseError("Ollama's reply was not JSON") from error
        content = (body.get("message") or {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise LLMResponseError(f"{model} gave an empty answer")
        try:
            parsed = json.loads(content)
        except ValueError as error:
            raise LLMResponseError(
                f"{model}'s answer was not valid JSON: {content[:200]!r}"
            ) from error
        if not isinstance(parsed, dict):
            raise LLMResponseError(f"{model}'s answer was JSON but not an object")
        return LLMResult(
            text=content,
            model=str(body.get("model") or model),
            latency_ms=latency_ms,
            prompt_tokens=_int(body.get("prompt_eval_count")),
            output_tokens=_int(body.get("eval_count")),
            prompt_eval_ms=_ms(body.get("prompt_eval_duration")),
            eval_ms=_ms(body.get("eval_duration")),
            total_ms=_ms(body.get("total_duration")),
        )

    def health(self) -> Health:
        try:
            if self._client is not None:
                response = self._client.get(f"{self.url}/api/tags", timeout=5)
            else:
                response = httpx.get(f"{self.url}/api/tags", timeout=5)
        except httpx.HTTPError as error:
            return Health(reachable=False, error=type(error).__name__)
        if response.status_code != 200:
            return Health(reachable=False, error=f"HTTP {response.status_code}")
        try:
            models = [str(item.get("name")) for item in response.json().get("models", [])]
        except (ValueError, AttributeError):
            return Health(reachable=False, error="Unexpected reply from /api/tags")
        return Health(
            reachable=True,
            models_available=models,
            main_model_present=any(_same_model(self.model, name) for name in models),
        )

    def warm_up(self, model: str | None = None) -> None:
        """An empty chat loads the model into memory without generating anything."""
        model = model or self.model
        payload = {"model": model, "messages": [], "keep_alive": self.keep_alive}
        # Loading a 4B model from disk can take longer than a normal answer.
        response = self._post("/api/chat", payload, max(self.timeout_s, 120))
        if response.status_code != 200:
            raise LLMResponseError(
                f"Could not load {model} (HTTP {response.status_code}): {response.text[:300]}"
            )


#: A valid answer for the default feedback schema, used by MockProvider.
MOCK_ANSWER: dict[str, Any] = {
    "summary": "You completed today's session.",
    "highlights": ["You kept going through every game."],
    "next_focus": "Next time we will keep practising the same movements.",
    "encouragement": "Well done for practising today.",
}


class MockProvider:
    """Returns canned JSON without any model; records every call. `answers` (texts or objects)
    are returned in turn, the last one repeating; `fail_with` raises instead."""

    name = "mock"

    def __init__(
        self,
        answers: Sequence[str | dict[str, Any]] | None = None,
        model: str = "mock",
        fail_with: LLMError | None = None,
        on_call: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.model = model
        self.answers = list(answers) if answers else [MOCK_ANSWER]
        self.fail_with = fail_with
        self.on_call = on_call
        self.calls: list[dict[str, Any]] = []

    def generate(
        self, system: str, user: str, json_schema: dict[str, Any], model: str | None = None
    ) -> LLMResult:
        call = {"system": system, "user": user, "json_schema": json_schema, "model": model or self.model}
        self.calls.append(call)
        if self.on_call:
            self.on_call(call)
        if self.fail_with is not None:
            raise self.fail_with
        answer = self.answers[min(len(self.calls) - 1, len(self.answers) - 1)]
        text = answer if isinstance(answer, str) else json.dumps(answer)
        return LLMResult(
            text=text,
            model=model or self.model,
            latency_ms=0.0,
            prompt_tokens=len(system.split()) + len(user.split()),
            output_tokens=len(text.split()),
            prompt_eval_ms=0.0,
            eval_ms=0.0,
            total_ms=0.0,
        )

    def health(self) -> Health:
        return Health(reachable=True, models_available=[self.model], main_model_present=True)

    def warm_up(self, model: str | None = None) -> None:
        return None


def get_provider() -> LLMProvider:
    """The provider the settings choose: LLM_PROVIDER "ollama" or "mock"."""
    if settings.LLM_PROVIDER == "ollama":
        return OllamaProvider()
    if settings.LLM_PROVIDER == "mock":
        return MockProvider()
    raise ValueError(f"Unknown LLM_PROVIDER {settings.LLM_PROVIDER!r}: use 'ollama' or 'mock'")


def forget_no_think_models() -> None:
    """For tests: forget which models rejected think=false."""
    _NO_THINK_MODELS.clear()
