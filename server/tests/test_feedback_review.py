"""Day 14 review of the LLM feedback module: the guarantees the methods section relies on."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.feedback import cli, prompt, service
from app.feedback.fallback import build_fallback
from app.feedback.llm import MockProvider, OllamaProvider
from app.feedback.rules import candidates, red_flags
from app.feedback.validate import validate
from app.models import SessionFeedback, User
from app.schemas.metrics import SessionFacts
from tests.feedback_factories import GOOD_ANSWER
from tests.test_feedback_rules import make_facts
from tests.test_session_facts import facts_session

ROOT = Path(__file__).resolve().parents[2]
STOP_NOTICE_START = "Please stop practising for today"


# 1. The model receives only the facts: no names, emails or comments.


def test_the_model_never_sees_names_emails_or_comments(session: Session, patient_headers: Any) -> None:
    record = facts_session(session)
    feedback = session.exec(select(SessionFeedback).where(SessionFeedback.session_id == record.id)).one()
    feedback.comment = "My neighbour Karim helped me today"
    session.add(feedback)
    session.commit()
    user = session.exec(select(User).where(User.role == "patient")).one()
    assert record.id is not None

    provider = MockProvider(answers=[GOOD_ANSWER])
    service.generate_report(record.id, db=session, provider=provider)
    for call in provider.calls:
        sent = call["system"] + call["user"]
        for private in (user.full_name, user.email, "Karim", "neighbour", "P001"):
            assert private not in sent, private
        assert '"session_id"' not in sent.split("Now the real session.")[1]


# 2. The validator runs on every output.


def test_the_validator_checks_every_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    checked: list[Any] = []

    def counting(answer: Any, *args: Any, **kwargs: Any) -> list[str]:
        checked.append(answer)
        return validate(answer, *args, **kwargs)

    monkeypatch.setattr(service, "validate", counting)
    bad = GOOD_ANSWER | {"patient_summary": "You reached 37 targets."}
    provider = MockProvider(answers=[bad, bad, GOOD_ANSWER])
    result = service.generate_report_from_facts(make_facts(), provider=provider)
    assert len(checked) == len(provider.calls) == 3
    assert [json.loads(text) for text in checked] == [bad, bad, GOOD_ANSWER]
    assert not result.meta.fallback_used


# 3. The template always validates: on every case of the evaluation test set.


@pytest.mark.parametrize("language", ["en", "bn"])
def test_the_template_validates_on_the_whole_testset(language: str) -> None:
    cases = json.loads((ROOT / "analysis" / "llm" / "testset.json").read_text(encoding="utf-8"))["cases"]
    assert len(cases) == 60
    for case in cases:
        facts = SessionFacts.model_validate(case["facts"])
        seen = prompt.facts_seen(facts)
        found = candidates(facts)
        flags = red_flags(facts, language)  # type: ignore[arg-type]
        report = build_fallback(facts, seen, found, flags, language)  # type: ignore[arg-type]
        assert validate(report, seen, facts, found, flags, language) == [], case["id"]  # type: ignore[arg-type]


# 4. Safety notices are fixed text from one shared source.


def test_the_notice_wording_lives_only_in_the_shared_file() -> None:
    shared = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    assert shared["notices"]["stop"]["en"].startswith(STOP_NOTICE_START)
    copies = [
        path.relative_to(ROOT).as_posix()
        for folder in (ROOT / "server" / "app", ROOT / "web" / "src")
        for path in folder.rglob("*")
        if path.suffix in {".py", ".ts", ".tsx", ".txt", ".md", ".yaml", ".json"}
        and STOP_NOTICE_START in path.read_text(encoding="utf-8", errors="ignore")
    ]
    # Only the web app's i18n strings, which a web test checks against the shared file.
    assert sorted(copies) == ["web/src/i18n/en.ts"]


def test_the_notices_come_back_unchanged_whatever_the_model_writes() -> None:
    facts = make_facts(
        flags=make_facts().flags.model_copy(update={"safety_flags": ["pain"]}),
        safety_notice_present=True,
    )
    shared = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    for answer in (GOOD_ANSWER, {"anything": "else"}):
        result = service.generate_report_from_facts(facts, provider=MockProvider(answers=[answer]))
        assert result.safety_notices == [shared["notices"]["stop"]["en"]]


# 5. The prompt version and the model are stored with each result.


def test_every_result_records_its_model_and_prompt_version() -> None:
    result = service.generate_report_from_facts(
        make_facts(), model="qwen3.5:2b", provider=MockProvider(answers=[GOOD_ANSWER]), prompt_version="v1"
    )
    assert (result.meta.model, result.meta.prompt_version) == ("qwen3.5:2b", "v1")
    stored = service.as_json(result)["meta"]
    assert stored["model"] == "qwen3.5:2b" and stored["prompt_version"] == "v1"
    # The template result records them too.
    fallback = service.generate_report_from_facts(make_facts(), model="phi4-mini", provider=MockProvider())
    assert fallback.meta.fallback_used and fallback.meta.model == "phi4-mini"
    with pytest.raises(FileNotFoundError):
        service.generate_report_from_facts(make_facts(), provider=MockProvider(), prompt_version="v99")


# 6. The provider is mocked in every unit test.


def test_tests_use_the_mock_and_cannot_reach_a_real_model() -> None:
    assert settings.LLM_PROVIDER == "mock"
    with pytest.raises(RuntimeError, match="tried to call a real model"):
        OllamaProvider(url="http://localhost:11434").generate("s", "u", {"type": "object"})
    with pytest.raises(RuntimeError, match="tried to call a real model"):
        httpx.Client().post("http://localhost:11434/api/chat", json={})


# The session list for manual testing


def test_the_cli_lists_sessions_by_code_only(session: Session, patient_headers: Any) -> None:
    facts_session(session)
    lines = cli.list_sessions(session)
    assert lines[0].split() == ["id", "patient", "no", "date", "notes"]
    body = "\n".join(lines[1:])
    assert "P001" in body and "RED FLAG: pain" in body
    assert "first sessions (no baseline)" in body
    assert "Alice" not in body and "@" not in body
