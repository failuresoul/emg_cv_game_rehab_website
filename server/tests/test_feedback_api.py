"""The feedback report API and its background jobs, with the model mocked.

These tests use a file database (not the shared in-memory one), so the job worker's thread and
the test can each use their own connection, as on the real server.
"""

import json
import threading
import time
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import settings
from app.core.db import get_session
from app.feedback import prompt
from app.feedback.fallback import build_fallback
from app.feedback.jobs import report_jobs
from app.feedback.llm import LLMResult, LLMUnavailableError, MockProvider, OllamaProvider
from app.feedback.rules import candidates, red_flags
from app.feedback.service import generate_report_from_facts
from app.main import app
from app.models import LlmReport, PatientProfile, ReportRating
from app.models import Session as SessionRecord
from app.services.session_facts import build_facts
from app.services.users import ensure_admin
from tests.conftest import PATIENT_PASSWORD, Headers
from tests.feedback_factories import GOOD_ANSWER
from tests.test_feedback_rules import make_facts
from tests.test_session_facts import facts_session


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'reports.db'}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        ensure_admin(session)
        yield session
    engine.dispose()


class Model:
    """The provider the jobs use: answers in turn, or an error; records each call and how
    many calls overlapped."""

    def __init__(self) -> None:
        self.answers: list[Any] = []
        self.error: Exception | None = None
        self.delay_s = 0.0
        self.calls = 0
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def provider(self) -> MockProvider:
        model = self

        class Recording(MockProvider):
            def generate(self, *args: Any, **kwargs: Any) -> LLMResult:
                with model.lock:
                    model.calls += 1
                    model.active += 1
                    model.max_active = max(model.max_active, model.active)
                try:
                    time.sleep(model.delay_s)
                    if model.error is not None:
                        raise model.error
                    return super().generate(*args, **kwargs)
                finally:
                    with model.lock:
                        model.active -= 1

        return Recording(answers=self.answers or None, model="qwen3.5:4b")


@pytest.fixture
def model() -> Model:
    return Model()


@pytest.fixture
def client(session: Session, model: Model) -> Generator[TestClient, None, None]:
    def get_session_override() -> Generator[Session, None, None]:
        with Session(session.get_bind()) as own:
            yield own

    app.dependency_overrides[get_session] = get_session_override
    report_jobs.configure(engine=session.get_bind(), provider_factory=model.provider, end_wait_s=0)
    with TestClient(app) as client:
        yield client
    report_jobs.wait_until_idle(5)
    app.dependency_overrides.clear()
    report_jobs.configure()


def finished(client: TestClient, headers: Headers, job_id: int) -> dict[str, Any]:
    assert report_jobs.wait_until_idle(10)
    response = client.get(f"/api/feedback/jobs/{job_id}", headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def valid_answer(db: Session, session_id: int, language: str = "en") -> dict[str, Any]:
    """A report the validator accepts for this stored session (the template's)."""
    record = db.get(SessionRecord, session_id)
    assert record is not None
    facts = build_facts(db, record)
    seen = prompt.facts_seen(facts)
    flags = red_flags(facts, language)  # type: ignore[arg-type]
    return build_fallback(facts, seen, candidates(facts), flags, language).model_dump()  # type: ignore[arg-type]


def stop_notice() -> str:
    data = json.loads(settings.safety_notices_path.read_text(encoding="utf-8"))
    return str(data["notices"]["stop"]["en"])


def request(client: TestClient, headers: Headers, session_id: int, **body: Any) -> dict[str, Any]:
    response = client.post(f"/api/sessions/{session_id}/feedback", json=body or None, headers=headers)
    assert response.status_code == 202, response.text
    found: dict[str, Any] = response.json()
    return found


# Jobs


def test_a_report_is_queued_written_and_read(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]

    job = request(client, patient_headers, record.id)
    assert job["status"] == "queued"
    body = finished(client, patient_headers, job["job_id"])
    assert body["status"] == "done"
    assert body["session_id"] == record.id and body["language"] == "en"
    # The session raised a pain flag: the fixed notice comes with the report.
    assert body["safety_notices"] == [stop_notice()]
    assert body["meta"]["model"] == "qwen3.5:4b" and body["meta"]["prompt_version"] == "v1"
    assert body["meta"]["fallback_used"] is False
    # Patients do not get the therapist summary; admins do.
    assert "therapist_summary" not in body["report"]
    assert body["report"]["patient_summary"]
    admin = finished(client, admin_headers, job["job_id"])
    assert admin["report"]["therapist_summary"]

    current = client.get(f"/api/sessions/{record.id}/feedback", headers=patient_headers)
    assert current.status_code == 200 and current.json()["job_id"] == job["job_id"]
    assert client.get(f"/api/sessions/{record.id}/feedback?language=bn", headers=patient_headers).status_code == 404

    # Everything about it is stored.
    with Session(session.get_bind()) as db:
        stored = db.get(LlmReport, job["job_id"])
        assert stored is not None
        assert stored.facts is not None and stored.facts["session_no"] == 3
        assert stored.candidates and stored.raw_output and stored.raw_output.startswith("--- report attempt 1 ---")
        assert stored.finished_at is not None and stored.retries == 0


def test_a_finished_report_is_reused_and_regenerate_makes_a_new_version(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]
    first = request(client, patient_headers, record.id)
    finished(client, patient_headers, first["job_id"])
    calls = model.calls

    again = request(client, patient_headers, record.id)
    assert again == {"job_id": first["job_id"], "status": "done"}
    assert model.calls == calls

    new = request(client, patient_headers, record.id, regenerate=True)
    assert new["job_id"] != first["job_id"] and new["status"] == "queued"
    assert finished(client, patient_headers, new["job_id"])["status"] == "done"
    current = client.get(f"/api/sessions/{record.id}/feedback", headers=patient_headers).json()
    assert current["job_id"] == new["job_id"]
    old = client.get(f"/api/admin/reports/{first['job_id']}", headers=admin_headers).json()
    assert old["superseded"] is True
    # The old version can still be read.
    assert finished(client, patient_headers, first["job_id"])["status"] == "done"


def test_bangla_is_a_separate_report(
    client: TestClient, session: Session, patient_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id, "bn")]
    job = request(client, patient_headers, record.id, language="bn")
    body = finished(client, patient_headers, job["job_id"])
    assert body["language"] == "bn" and body["status"] == "done"
    assert body["safety_notices"][0].startswith("অনুগ্রহ করে")


def test_the_template_is_used_when_the_model_is_unreachable(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.error = LLMUnavailableError("Could not reach Ollama. Is the Ollama app running?")
    job = request(client, patient_headers, record.id)
    body = finished(client, patient_headers, job["job_id"])
    assert body["status"] == "fallback"
    assert body["meta"]["fallback_used"] is True and body["meta"]["retries"] == 0
    assert body["report"]["patient_summary"] and body["safety_notices"] == [stop_notice()]
    assert model.calls == 1
    detail = client.get(f"/api/admin/reports/{job['job_id']}", headers=admin_headers).json()
    assert "Ollama" in detail["error"]


def test_invalid_answers_are_retried_then_the_template_is_used(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [GOOD_ANSWER | {"patient_summary": "You did 37 reaches."}]
    job = request(client, patient_headers, record.id)
    assert finished(client, patient_headers, job["job_id"])["status"] == "fallback"
    assert model.calls == 3
    detail = client.get(f"/api/admin/reports/{job['job_id']}", headers=admin_headers).json()
    assert len(detail["validation_errors"]) == 3
    assert detail["raw_output"].count("--- report attempt") == 3


def test_an_unexpected_error_fails_the_job_and_a_new_request_replaces_it(
    client: TestClient, session: Session, patient_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.error = RuntimeError("GPU on fire")
    job = request(client, patient_headers, record.id)
    body = finished(client, patient_headers, job["job_id"])
    assert body["status"] == "failed" and body["report"] is None
    # The worker survives, and asking again (without regenerate) makes a new job.
    model.error = None
    model.answers = [valid_answer(session, record.id)]
    again = request(client, patient_headers, record.id)
    assert again["job_id"] != job["job_id"]
    assert finished(client, patient_headers, again["job_id"])["status"] == "done"


def test_only_one_job_runs_at_a_time(
    client: TestClient, session: Session, patient_headers: Headers, model: Model
) -> None:
    facts_session(session)
    ids = [s.id for s in session.exec(select(SessionRecord)).all()]
    model.delay_s = 0.05
    jobs = [request(client, patient_headers, i, language=lang)["job_id"] for i in ids for lang in ("en", "bn")]
    assert len(set(jobs)) == 6
    assert report_jobs.wait_until_idle(20)
    assert model.max_active == 1 and report_jobs.max_running == 1
    for job_id in jobs:
        assert finished(client, patient_headers, job_id)["status"] in ("done", "fallback")


# Who may see what


def test_other_patients_get_404(
    client: TestClient,
    session: Session,
    patient_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
    model: Model,
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]
    job = request(client, patient_headers, record.id)
    finished(client, patient_headers, job["job_id"])

    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    assert client.post(f"/api/sessions/{record.id}/feedback", headers=other).status_code == 404
    assert client.get(f"/api/feedback/jobs/{job['job_id']}", headers=other).status_code == 404
    assert client.get(f"/api/sessions/{record.id}/feedback", headers=other).status_code == 404
    rating = {"rater": "participant", "scores": {"clarity": 4}}
    assert client.post(f"/api/feedback/{job['job_id']}/ratings", json=rating, headers=other).status_code == 404
    assert client.get("/api/patient/reports", headers=other).json() == []
    assert client.get("/api/feedback/jobs/999999", headers=patient_headers).status_code == 404
    # Admin routes need an admin.
    for path in ("/api/admin/reports", f"/api/admin/reports/{job['job_id']}", f"/api/admin/reports/{job['job_id']}/ratings"):
        assert client.get(path, headers=patient_headers).status_code == 403
    assert client.get("/api/feedback/health").status_code == 401


def test_the_patient_lists_their_reports(
    client: TestClient, session: Session, patient_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]
    job = request(client, patient_headers, record.id)
    finished(client, patient_headers, job["job_id"])
    [item] = client.get("/api/patient/reports", headers=patient_headers).json()
    assert item["job_id"] == job["job_id"] and item["session_id"] == record.id
    assert item["session_no"] == 3 and item["language"] == "en" and item["status"] == "done"
    assert item["has_safety_notice"] is True
    assert 0 < len(item["preview"]) <= 141


def test_admin_lists_and_monitoring(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]
    good = request(client, patient_headers, record.id)
    finished(client, patient_headers, good["job_id"])
    model.error = LLMUnavailableError("down")
    template = request(client, patient_headers, record.id, regenerate=True)
    finished(client, patient_headers, template["job_id"])

    patient_id = session.exec(select(PatientProfile)).one().id
    versions = client.get(f"/api/admin/patients/{patient_id}/reports", headers=admin_headers).json()
    assert [v["job_id"] for v in versions] == [template["job_id"], good["job_id"]]
    assert [v["superseded"] for v in versions] == [False, True]
    assert versions[0]["patient_code"] == "P001" and versions[0]["status"] == "fallback"
    assert client.get("/api/admin/patients/999/reports", headers=admin_headers).status_code == 404

    fallback = client.get("/api/admin/reports?status=fallback", headers=admin_headers).json()
    assert [item["job_id"] for item in fallback] == [template["job_id"]]
    assert client.get("/api/admin/reports?status=failed", headers=admin_headers).json() == []
    assert len(client.get("/api/admin/reports", headers=admin_headers).json()) == 2
    assert client.get("/api/admin/reports?status=nonsense", headers=admin_headers).status_code == 422

    detail = client.get(f"/api/admin/reports/{good['job_id']}", headers=admin_headers).json()
    assert detail["facts"]["session_no"] == 3 and detail["candidates"]
    assert detail["report"]["therapist_summary"] and detail["prompt_tokens"] > 0


# Ratings


def test_ratings(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    assert record.id is not None
    model.answers = [valid_answer(session, record.id)]
    job = request(client, patient_headers, record.id)
    finished(client, patient_headers, job["job_id"])
    url = f"/api/feedback/{job['job_id']}/ratings"

    mine = {"rater": "participant", "scores": {"clarity": 5, "usefulness": 4}, "comment": "  Clear  "}
    created = client.post(url, json=mine, headers=patient_headers)
    assert created.status_code == 201, created.text
    assert created.json()["comment"] == "Clear" and created.json()["rater"] == "participant"
    assert client.post(url, json=mine, headers=patient_headers).status_code == 409
    as_clinician = {"rater": "clinician", "scores": {"accuracy": 5}}
    assert client.post(url, json=as_clinician, headers=patient_headers).status_code == 403
    assert client.post(url, json=as_clinician, headers=admin_headers).status_code == 201
    assert client.post(url, json=mine, headers=admin_headers).status_code == 403

    for bad in (
        {"rater": "participant", "scores": {}},
        {"rater": "participant", "scores": {"clarity": 6}},
        {"rater": "participant", "scores": {"beauty": 3}},
        {"rater": "participant", "scores": {"clarity": 3}, "comment": "x" * 301},
    ):
        assert client.post(url, json=bad, headers=patient_headers).status_code == 422

    listed = client.get(f"/api/admin/reports/{job['job_id']}/ratings", headers=admin_headers).json()
    assert [(r["rater"], r["scores"]) for r in listed] == [
        ("participant", {"clarity": 5, "usefulness": 4}),
        ("clinician", {"accuracy": 5}),
    ]
    assert client.get(f"/api/admin/reports/{job['job_id']}", headers=admin_headers).status_code == 200
    items = client.get("/api/admin/reports", headers=admin_headers).json()
    assert items[0]["ratings"] == 2


def test_a_report_still_being_written_cannot_be_rated(
    client: TestClient, session: Session, patient_headers: Headers
) -> None:
    record = facts_session(session)
    assert record.id is not None
    queued = LlmReport(session_id=record.id, language="bn", status="queued")
    session.add(queued)
    session.commit()
    rating = {"rater": "participant", "scores": {"clarity": 3}}
    response = client.post(f"/api/feedback/{queued.id}/ratings", json=rating, headers=patient_headers)
    assert response.status_code == 409
    assert session.exec(select(ReportRating)).all() == []


# The automatic trigger, health and restarts


def test_the_questionnaire_queues_a_report_in_the_patients_language(
    client: TestClient, session: Session, patient_headers: Headers
) -> None:
    profile = session.exec(select(PatientProfile)).one()
    profile.language = "bn"
    session.add(profile)
    session.commit()
    started = client.post("/api/sessions", json={}, headers=patient_headers)
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]
    answers = {
        "pain_0_10": 1, "fatigue_0_10": 3, "enjoyment_1_5": 4,
        "difficulty": "just_right", "new_symptoms": False, "comment": "Alice's private note",
    }  # fmt: skip
    response = client.post(f"/api/sessions/{session_id}/questionnaire", json=answers, headers=patient_headers)
    assert response.status_code == 201, response.text

    assert report_jobs.wait_until_idle(10)
    current = client.get(f"/api/sessions/{session_id}/feedback", headers=patient_headers)
    assert current.status_code == 200, current.text
    body = current.json()
    assert body["language"] == "bn" and body["status"] in ("done", "fallback")
    with Session(session.get_bind()) as db:
        stored = db.exec(select(LlmReport)).one()
        assert "Alice" not in json.dumps(stored.facts) and "private note" not in json.dumps(stored.facts)


def test_the_job_waits_for_the_session_to_end(session: Session, patient_headers: Headers) -> None:
    """The questionnaire comes just before the end: the facts are built after it."""
    record = facts_session(session)
    record.status = "active"
    record.ended_at = None
    session.add(record)
    session.commit()
    assert record.id is not None
    report = LlmReport(session_id=record.id, language="en", status="queued")
    session.add(report)
    session.commit()
    assert report.id is not None

    def end_soon() -> None:
        time.sleep(0.3)
        with Session(session.get_bind()) as db:
            found = db.get(SessionRecord, record.id)
            assert found is not None
            found.status = "completed"
            db.add(found)
            db.commit()

    threading.Thread(target=end_soon).start()
    report_jobs.configure(engine=session.get_bind(), provider_factory=MockProvider, end_wait_s=5)
    try:
        started = time.monotonic()
        report_jobs.run(report.id)
        assert 0.25 < time.monotonic() - started < 5
    finally:
        report_jobs.configure()
    with Session(session.get_bind()) as db:
        stored = db.get(LlmReport, report.id)
        assert stored is not None and stored.status == "fallback"
        assert stored.facts is not None and stored.facts["next_session"] is not None


def test_unfinished_jobs_run_again_after_a_restart(
    client: TestClient, session: Session, patient_headers: Headers, model: Model
) -> None:
    facts_session(session)
    ids = [s.id for s in session.exec(select(SessionRecord)).all()]
    assert client.portal is not None
    client.portal.call(report_jobs.stop)
    # A stop left one job queued and one half-way through.
    with Session(session.get_bind()) as db:
        db.add(LlmReport(session_id=ids[0], language="en", status="queued"))
        db.add(LlmReport(session_id=ids[1], language="en", status="running"))
        db.add(LlmReport(session_id=ids[2], language="en", status="done", report=GOOD_ANSWER))
        db.commit()
    client.portal.call(report_jobs.start)
    assert report_jobs.wait_until_idle(10)
    with Session(session.get_bind()) as db:
        statuses = [r.status for r in db.exec(select(LlmReport).order_by(LlmReport.id)).all()]  # type: ignore[arg-type]
    assert statuses == ["fallback", "fallback", "done"]
    assert model.calls == 6  # the mock's canned answer is not a report: 3 attempts each


def test_health_reports_the_provider_and_the_queue(
    client: TestClient, patient_headers: Headers, model: Model
) -> None:
    body = client.get("/api/feedback/health", headers=patient_headers).json()
    assert body == {
        "provider": "mock", "model": "qwen3.5:4b", "reachable": True, "model_loaded": True, "queue_length": 0,
    }  # fmt: skip

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    unreachable = OllamaProvider(url="http://ollama.test", client=httpx.Client(transport=httpx.MockTransport(down)))
    report_jobs.provider_factory = lambda: unreachable
    body = client.get("/api/feedback/health", headers=patient_headers).json()
    assert body["reachable"] is False and body["model_loaded"] is False


def test_ollama_reports_which_models_are_loaded() -> None:
    def ps(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/ps"
        return httpx.Response(200, json={"models": [{"name": "qwen3.5:4b"}]})

    provider = OllamaProvider(url="http://ollama.test", model="qwen3.5:4b", client=httpx.Client(transport=httpx.MockTransport(ps)))
    assert provider.loaded_models() == ["qwen3.5:4b"]
    assert provider.model_loaded() and not provider.model_loaded("phi4-mini")


def test_startup_warms_the_model_up_in_the_background(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[float] = []
    release = threading.Event()

    class Slow(MockProvider):
        def warm_up(self, model: str | None = None) -> None:
            calls.append(time.monotonic())
            release.wait(5)
            raise LLMUnavailableError("Ollama is not running")

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    report_jobs.configure(engine=session.get_bind(), provider_factory=Slow)
    try:
        started = time.monotonic()
        with TestClient(app) as client:
            # The server answers while the model is still loading.
            assert client.get("/api/health").status_code == 200
            assert time.monotonic() - started < 2
            release.set()
        assert len(calls) == 1
    finally:
        release.set()
        report_jobs.configure()


# The job's time limit


def test_the_total_time_limit_ends_in_the_template() -> None:
    seen: list[float | None] = []

    class Slow(MockProvider):
        def generate(self, *args: Any, **kwargs: Any) -> LLMResult:
            seen.append(kwargs.get("timeout_s"))
            time.sleep(0.6)
            return super().generate(*args, **kwargs)

    result = generate_report_from_facts(make_facts(), provider=Slow(), deadline_s=1.5)
    # 1.5 s left for the first call, under 1 s after it: no second call.
    assert len(seen) == 1 and seen[0] is not None and 1.4 < seen[0] <= 1.5
    assert result.meta.fallback_used and result.meta.provider_error == "No valid report within 1.5 s"
    # Without a limit, the provider's own timeout applies.
    plain = MockProvider()
    generate_report_from_facts(make_facts(), provider=plain)
    assert plain.calls[0]["timeout_s"] is None
