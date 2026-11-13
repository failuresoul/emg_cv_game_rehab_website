"""Day 15 review: the guarantees of the report API, jobs, Bangla and the blind review."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.feedback import review, store
from app.feedback.jobs import report_jobs
from app.feedback.llm import MockProvider, OllamaProvider
from app.feedback.service import generate_report, generate_report_from_facts
from app.models import LlmReport, SessionFeedback, User
from tests.conftest import Headers
from tests.feedback_factories import GOOD_ANSWER
from tests.test_feedback_api import client, model, session  # noqa: F401  (fixtures)
from tests.test_feedback_rules import make_facts
from tests.test_session_facts import facts_session

ROOT = Path(__file__).resolve().parents[2]


def test_the_template_is_used_at_once_when_ollama_is_closed() -> None:
    """A real OllamaProvider whose connection is refused, as with the Ollama app closed."""
    calls: list[str] = []

    def refused(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        raise httpx.ConnectError("connection refused", request=request)

    closed = OllamaProvider(
        url="http://localhost:11434", client=httpx.Client(transport=httpx.MockTransport(refused))
    )
    for language, strategy in (("en", None), ("bn", "direct"), ("bn", "translate")):
        calls.clear()
        result = generate_report_from_facts(
            make_facts(), language, provider=closed, bn_strategy=strategy  # type: ignore[arg-type]
        )
        assert result.meta.fallback_used and result.meta.retries == 0
        assert "Is the Ollama app running?" in (result.meta.provider_error or "")
        assert calls == ["/api/chat"]
        assert result.report.language == language and result.report.patient_summary
    assert closed.health().reachable is False


def test_no_names_emails_or_comments_in_any_prompt_bangla_included(
    session: Session, patient_headers: Headers
) -> None:
    record = facts_session(session)
    feedback = session.exec(select(SessionFeedback)).one()
    feedback.comment = "Private note from Karim"
    session.add(feedback)
    session.commit()
    user = session.exec(select(User).where(User.role == "patient")).one()
    assert record.id is not None

    for language, strategy in (("en", "direct"), ("bn", "direct"), ("bn", "translate")):
        provider = MockProvider(answers=[GOOD_ANSWER])
        original = settings.LLM_BN_STRATEGY
        settings.LLM_BN_STRATEGY = strategy
        try:
            generate_report(record.id, language, db=session, provider=provider)  # type: ignore[arg-type]
        finally:
            settings.LLM_BN_STRATEGY = original
        assert provider.calls
        for call in provider.calls:
            sent = call["system"] + call["user"]
            for private in (user.full_name, user.email, "Karim", "Private note", "P001"):
                assert private not in sent, (language, strategy, private)


def test_every_finished_report_stores_its_facts_snapshot(
    client: TestClient, session: Session, patient_headers: Headers, model: Any
) -> None:
    record = facts_session(session)
    for language in ("en", "bn"):
        job = client.post(f"/api/sessions/{record.id}/feedback", json={"language": language}, headers=patient_headers).json()
        assert job["status"] == "queued"
    assert report_jobs.wait_until_idle(10)
    with Session(session.get_bind()) as db:
        reports = db.exec(select(LlmReport)).all()
        assert len(reports) == 2
        for report in reports:
            assert report.status in ("done", "fallback")
            assert report.facts and report.facts["session_no"] == 3 and report.candidates is not None
            assert report.prompt_version == "v1" and report.strategy


def test_patients_never_reach_review_reports(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers
) -> None:
    facts_session(session)
    created = client.post("/api/admin/review-sets", json={"size": 1}, headers=admin_headers).json()
    assert report_jobs.wait_until_idle(10)
    with Session(session.get_bind()) as db:
        ids = [r.id for r in db.exec(select(LlmReport).where(LlmReport.review_set_id == created["id"])).all()]
    assert len(ids) == 2
    for report_id in ids:
        # The session is the patient's own, but a review report is not theirs to read or rate.
        assert client.get(f"/api/feedback/jobs/{report_id}", headers=patient_headers).status_code == 404
        rating = {"rater": "participant", "scores": {"clarity": 3}}
        assert client.post(f"/api/feedback/{report_id}/ratings", json=rating, headers=patient_headers).status_code == 404
        assert client.get(f"/api/feedback/jobs/{report_id}", headers=admin_headers).status_code == 200
    assert review.results(session, created["id"])["raters"] == []


def test_every_bangla_content_file_is_marked_for_review() -> None:
    feedback = ROOT / "server" / "app" / "feedback"
    files = [*feedback.glob("kb/bn/*.md"), feedback / "banned_bn.txt", feedback / "templates" / "bn.yaml"]
    assert len(files) == 15
    for path in files:
        assert "Needs review by a native speaker" in path.read_text(encoding="utf-8").splitlines()[0]
    shared = json.loads((ROOT / "shared" / "safety-notices.json").read_text(encoding="utf-8"))
    assert "Needs review by a native speaker" in shared["_review"]


def test_a_report_being_written_is_never_queued_twice(session: Session, patient_headers: Headers) -> None:
    record = facts_session(session)
    assert record.id is not None
    first, created = store.request_report(session, record.id, "en")
    assert created and first.status == "queued"
    # Asked again, even with regenerate, while it is queued or running: the same job.
    for status in ("queued", "running"):
        first.status = status
        session.add(first)
        session.commit()
        again, created = store.request_report(session, record.id, "en", regenerate=True)
        assert (again.id, created) == (first.id, False)


def test_two_requests_at_once_share_one_report(
    session: Session, patient_headers: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    record = facts_session(session)
    assert record.id is not None
    winner, _ = store.request_report(session, record.id, "en")
    real_current = store.current
    seen: list[int] = []

    def racing(db: Session, session_id: int, language: str) -> LlmReport | None:
        # The second request looked before the first had committed.
        seen.append(1)
        return None if len(seen) == 1 else real_current(db, session_id, language)

    monkeypatch.setattr(store, "current", racing)
    found, created = store.request_report(session, record.id, "en")
    assert (found.id, created) == (winner.id, False)
    assert len(session.exec(select(LlmReport)).all()) == 1


def test_a_job_that_is_not_queued_is_left_alone(session: Session, patient_headers: Headers) -> None:
    record = facts_session(session)
    assert record.id is not None
    provider = MockProvider()
    done = LlmReport(session_id=record.id, language="en", status="done", report=GOOD_ANSWER)
    old = LlmReport(session_id=record.id, language="bn", status="queued", superseded=True)
    session.add(done)
    session.add(old)
    session.commit()
    for report in (done, old):
        assert report.id is not None
        store.run_report(session, report.id, provider, end_wait_s=0, deadline_s=10)
        session.refresh(report)
    assert (done.status, old.status) == ("done", "queued") and provider.calls == []
    store.run_report(session, 999_999, provider, end_wait_s=0, deadline_s=10)
