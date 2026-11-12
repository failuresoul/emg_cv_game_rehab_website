"""app/feedback/llm.py with Ollama's HTTP API mocked; no real model is ever called."""

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest

from app.core.config import settings
from app.feedback import llm
from app.feedback.llm import (
    LLMResponseError,
    LLMTimeoutError,
    LLMUnavailableError,
    MockProvider,
    OllamaProvider,
)

SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
}


def chat_reply(content: str = '{"summary": "Well done."}', **changes: Any) -> dict[str, Any]:
    return {
        "model": "qwen3.5:4b",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "prompt_eval_count": 1500,
        "prompt_eval_duration": 3_000_000_000,
        "eval_count": 350,
        "eval_duration": 17_500_000_000,
        "total_duration": 21_000_000_000,
        **changes,
    }


@pytest.fixture(autouse=True)
def fresh_cache() -> Iterator[None]:
    llm.forget_no_think_models()
    yield
    llm.forget_no_think_models()


def provider(handler: Callable[[httpx.Request], httpx.Response], **options: Any) -> OllamaProvider:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return OllamaProvider(url="http://ollama.test", model="qwen3.5:4b", client=client, **options)


def test_the_request_asks_for_structured_json_without_thinking() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat"
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=chat_reply())

    result = provider(handler, temperature=0.2, top_p=0.9, num_ctx=4096, max_tokens=700, keep_alive="30m").generate(
        "You write feedback.", '{"facts": 1}', SCHEMA
    )
    [payload] = seen
    assert payload["model"] == "qwen3.5:4b"
    assert payload["stream"] is False
    assert payload["format"] == SCHEMA
    assert payload["think"] is False
    assert payload["keep_alive"] == "30m"
    assert payload["options"] == {"temperature": 0.2, "top_p": 0.9, "num_ctx": 4096, "num_predict": 700}
    assert payload["messages"] == [
        {"role": "system", "content": "You write feedback."},
        {"role": "user", "content": '{"facts": 1}'},
    ]
    assert json.loads(result.text) == {"summary": "Well done."}


def test_the_settings_are_the_defaults() -> None:
    p = OllamaProvider(client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))))
    assert p.url == settings.OLLAMA_URL.rstrip("/")
    assert p.model == settings.LLM_MODEL
    assert (p.temperature, p.top_p, p.num_ctx, p.max_tokens) == (
        settings.LLM_TEMPERATURE,
        settings.LLM_TOP_P,
        settings.LLM_NUM_CTX,
        settings.LLM_MAX_TOKENS,
    )
    assert settings.llm_candidates == ["qwen3.5:4b", "qwen3.5:2b", "phi4-mini"]


def test_a_model_without_thinking_is_asked_again_and_remembered() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen.append(payload)
        if "think" in payload and payload["model"] == "phi4-mini":
            return httpx.Response(400, json={"error": '"phi4-mini" does not support thinking'})
        return httpx.Response(200, json=chat_reply(model=payload["model"]))

    p = provider(handler)
    first = p.generate("s", "u", SCHEMA, model="phi4-mini")
    assert [("think" in payload) for payload in seen] == [True, False]
    assert first.model == "phi4-mini"
    # Remembered: the next request leaves think out from the start.
    p.generate("s", "u", SCHEMA, model="phi4-mini")
    assert [("think" in payload) for payload in seen] == [True, False, False]
    # Other models still get think=false.
    p.generate("s", "u", SCHEMA, model="qwen3.5:2b")
    assert seen[-1]["think"] is False


def test_other_refusals_are_not_retried() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404, json={"error": 'model "nope" not found, try pulling it first'})

    with pytest.raises(LLMResponseError, match="HTTP 404.*not found"):
        provider(handler).generate("s", "u", SCHEMA, model="nope")
    assert len(calls) == 1


def test_a_timeout_is_a_clear_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(LLMTimeoutError, match=r"qwen3.5:4b did not answer within 60 s"):
        provider(handler, timeout_s=60).generate("s", "u", SCHEMA)


def test_ollama_not_running_is_a_clear_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(LLMUnavailableError, match="Is the Ollama app running"):
        provider(handler).generate("s", "u", SCHEMA)


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ('{"summary": "cut off', "not valid JSON"),
        ("Sure! Here is your feedback.", "not valid JSON"),
        ('["a list"]', "not an object"),
        ("", "empty answer"),
    ],
)
def test_a_malformed_answer_is_surfaced(content: str, message: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=chat_reply(content))

    with pytest.raises(LLMResponseError, match=message):
        provider(handler).generate("s", "u", SCHEMA)


def test_a_reply_that_is_not_json_is_surfaced() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>proxy error</html>")

    with pytest.raises(LLMResponseError, match="reply was not JSON"):
        provider(handler).generate("s", "u", SCHEMA)


def test_the_timings_are_read() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=chat_reply())

    result = provider(handler).generate("s", "u", SCHEMA)
    assert result.prompt_tokens == 1500
    assert result.output_tokens == 350
    assert result.prompt_eval_ms == 3000.0
    assert result.eval_ms == 17500.0
    assert result.total_ms == 21000.0
    assert result.prompt_rate == pytest.approx(500.0)
    assert result.output_rate == pytest.approx(20.0)
    assert result.latency_ms >= 0


def test_missing_timings_are_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": "m", "message": {"content": '{"summary": "x"}'}})

    result = provider(handler).generate("s", "u", SCHEMA)
    assert (result.prompt_tokens, result.eval_ms, result.prompt_rate, result.output_rate) == (
        None,
        None,
        None,
        None,
    )


def test_health_lists_the_models_and_finds_the_main_one() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/tags"
        return httpx.Response(
            200,
            json={"models": [{"name": "qwen3.5:4b"}, {"name": "qwen3.5:2b"}, {"name": "phi4-mini:latest"}]},
        )

    health = provider(handler).health()
    assert health.reachable is True
    assert health.models_available == ["qwen3.5:4b", "qwen3.5:2b", "phi4-mini:latest"]
    assert health.main_model_present is True
    # "phi4-mini" is the same model as "phi4-mini:latest".
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert OllamaProvider(url="http://ollama.test", model="phi4-mini", client=client).health().main_model_present


def test_health_when_the_main_model_is_missing_or_ollama_is_down() -> None:
    def missing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "llama3:8b"}]})

    health = provider(missing).health()
    assert health.reachable and not health.main_model_present

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    health = provider(down).health()
    assert health.reachable is False and health.error == "ConnectError"
    assert provider(lambda r: httpx.Response(500)).health().reachable is False


def test_warm_up_loads_the_model_with_an_empty_chat() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "qwen3.5:2b", "done": True})

    provider(handler, keep_alive="30m").warm_up("qwen3.5:2b")
    assert seen == [{"model": "qwen3.5:2b", "messages": [], "keep_alive": "30m"}]

    with pytest.raises(LLMResponseError, match="Could not load"):
        provider(lambda r: httpx.Response(404, json={"error": "not found"})).warm_up("missing")


def test_the_mock_returns_canned_json_and_records_calls() -> None:
    mock = MockProvider(answers=[{"summary": "first"}, '{"summary": "second"}'])
    assert json.loads(mock.generate("s", "u1", SCHEMA).text) == {"summary": "first"}
    assert json.loads(mock.generate("s", "u2", SCHEMA).text) == {"summary": "second"}
    assert json.loads(mock.generate("s", "u3", SCHEMA).text) == {"summary": "second"}
    assert [call["user"] for call in mock.calls] == ["u1", "u2", "u3"]
    assert json.loads(MockProvider().generate("s", "u", SCHEMA).text) == llm.MOCK_ANSWER
    with pytest.raises(LLMTimeoutError):
        MockProvider(fail_with=LLMTimeoutError("slow")).generate("s", "u", SCHEMA)


def test_tests_always_use_the_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    assert settings.LLM_PROVIDER == "mock"
    assert isinstance(llm.get_provider(), MockProvider)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    assert isinstance(llm.get_provider(), OllamaProvider)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "chatgpt")
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        llm.get_provider()
