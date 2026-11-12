"""analysis/llm/speed_test.py runs end to end against a fake Ollama (no real model)."""

import csv
import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx
import pytest

from app.feedback import llm

ROOT = Path(__file__).resolve().parents[2]


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("speed_test", ROOT / "analysis" / "llm" / "speed_test.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_ollama(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/tags":
        return httpx.Response(200, json={"models": [{"name": "qwen3.5:4b"}, {"name": "phi4-mini:latest"}]})
    payload: dict[str, Any] = json.loads(request.content)
    if not payload.get("messages"):
        return httpx.Response(200, json={"model": payload["model"], "done": True})
    if payload["model"] == "phi4-mini" and "think" in payload:
        return httpx.Response(400, json={"error": '"phi4-mini" does not support thinking'})
    long = "summary" in json.dumps(payload["format"])
    content = (
        json.dumps({"summary": "s", "highlights": ["a", "b"], "next_focus": "n", "encouragement": "e"})
        if long
        else '{"ok": true, "word": "great"}'
    )
    return httpx.Response(
        200,
        json={
            "model": payload["model"],
            "message": {"content": content},
            "prompt_eval_count": 1500 if long else 30,
            "prompt_eval_duration": 3_000_000_000,
            "eval_count": 350 if long else 10,
            "eval_duration": 17_500_000_000,
            "total_duration": 21_000_000_000,
        },
    )


def test_the_speed_test_writes_its_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    script = load_script()
    client = httpx.Client(transport=httpx.MockTransport(fake_ollama))
    real_init = llm.OllamaProvider.__init__

    def with_fake_client(self: llm.OllamaProvider, *args: Any, **kwargs: Any) -> None:
        real_init(self, *args, **{**kwargs, "client": client})

    monkeypatch.setattr(script.OllamaProvider, "__init__", with_fake_client)
    llm.forget_no_think_models()
    out = tmp_path / "speed.csv"
    assert script.main(["--models", "qwen3.5:4b,phi4-mini,qwen3.5:2b", "--runs", "2", "--out", str(out)]) == 0

    rows = list(csv.DictReader(out.open(encoding="utf-8")))
    assert len(rows) == 2 * 2 * 2  # two installed models x short/long x 2 runs
    assert {row["model"] for row in rows} == {"qwen3.5:4b", "phi4-mini"}
    assert all(row["json_ok"] == "True" for row in rows)
    long = [row for row in rows if row["kind"] == "long"]
    assert all(float(row["gen_rate_tps"]) == 20.0 for row in long)
    printed = capsys.readouterr().out
    assert "ollama ps" in printed
    assert "qwen3.5:2b: not installed" in printed
    assert "Long prompt (median of the runs)" in printed


def test_the_long_prompt_is_about_1500_tokens() -> None:
    script = load_script()
    characters = len(script.LONG_SYSTEM) + len(script.long_user())
    # About four characters per token for English text and JSON.
    assert 1200 <= characters / 4 <= 2000
