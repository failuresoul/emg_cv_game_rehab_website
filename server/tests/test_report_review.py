"""The blind human evaluation (app/feedback/review.py, app/api/review.py), with the model mocked.

Uses the file database and job worker of tests/test_feedback_api.py.
"""

import csv
import io
import json
import random
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.security import hash_password
from app.feedback import review
from app.feedback.jobs import report_jobs
from app.models import LlmReport, PatientProfile, ReportRating, ReviewItem, User
from app.models import Session as SessionRecord
from tests.conftest import Headers
from tests.test_feedback_api import Model, client, model, session  # noqa: F401  (fixtures)
from tests.test_progress import add_session, noon
from tests.test_session_facts import facts_session

RUBRIC = {"accuracy": 4, "safety": 5, "helpfulness": 3, "clarity": 4, "tone": 5}


def with_demo_patient(session: Session, create_patient: Callable[..., dict[str, Any]]) -> None:
    """P001's three sessions (real) and two sessions of a demo patient."""
    facts_session(session)
    create_patient(email="demo@example.com")
    demo = session.exec(select(PatientProfile).where(PatientProfile.patient_code == "P002")).one()
    demo.is_demo = True
    session.add(demo)
    session.commit()
    for days in (3, 2):
        add_session(session, demo, noon(days))


def create(client: TestClient, headers: Headers, **body: Any) -> dict[str, Any]:
    response = client.post("/api/admin/review-sets", json=body, headers=headers)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def ready(client: TestClient, headers: Headers, set_id: int) -> dict[str, Any]:
    assert report_jobs.wait_until_idle(20)
    found: dict[str, Any] = client.get(f"/api/admin/review-sets/{set_id}", headers=headers).json()
    assert found["status"] == "ready", found
    return found


def second_admin(session: Session, login: Callable[[str, str], Headers]) -> Headers:
    session.add(
        User(email="clinician@example.com", full_name="Second Rater", role="admin", hashed_password=hash_password("pw-12345678"))
    )
    session.commit()
    return login("clinician@example.com", "pw-12345678")


def keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in keys(item)}
    return set()


# Creating a set


def test_a_set_has_both_versions_of_each_session_from_the_same_facts(
    patient_headers: Headers,
    client: TestClient,
    session: Session,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
) -> None:
    with_demo_patient(session, create_patient)
    created = create(client, admin_headers, size=4, name="Pilot")
    assert created["sessions"] == 4 and created["items"] == 8 and created["name"] == "Pilot"
    found = ready(client, admin_headers, created["id"])
    assert found["ready_items"] == 8 and found["my_ratings"] == 0

    with Session(session.get_bind()) as db:
        items = db.exec(select(ReviewItem).where(ReviewItem.review_set_id == created["id"])).all()
        sessions = {item.session_id for item in items}
        assert len(sessions) == 4
        # Real and demo sessions, half each.
        demo_id = db.exec(select(PatientProfile.id).where(PatientProfile.is_demo)).one()
        owners = [db.get(SessionRecord, sid).patient_id for sid in sessions]  # type: ignore[union-attr]
        assert owners.count(demo_id) == 2
        for session_id in sessions:
            pair = [item for item in items if item.session_id == session_id]
            assert sorted(item.version for item in pair) == ["llm", "template"]
            reports = [db.get(LlmReport, item.report_id) for item in pair]
            assert reports[0].facts == reports[1].facts  # type: ignore[union-attr]
            # Never a patient's report.
            assert all(r.superseded and r.review_set_id == created["id"] for r in reports)  # type: ignore[union-attr]


def test_no_completed_sessions_is_a_conflict(client: TestClient, admin_headers: Headers) -> None:
    assert client.post("/api/admin/review-sets", json={}, headers=admin_headers).status_code == 409


def test_review_reports_never_reach_patients_or_report_lists(
    client: TestClient, session: Session, admin_headers: Headers, patient_headers: Headers
) -> None:
    record = facts_session(session)
    created = create(client, admin_headers, size=3)
    ready(client, admin_headers, created["id"])
    assert client.get("/api/patient/reports", headers=patient_headers).json() == []
    assert client.get(f"/api/sessions/{record.id}/feedback", headers=patient_headers).status_code == 404
    assert client.get("/api/admin/reports", headers=admin_headers).json() == []
    # The patient's own report is still made as usual.
    job = client.post(f"/api/sessions/{record.id}/feedback", headers=patient_headers).json()
    assert report_jobs.wait_until_idle(10)
    assert client.get(f"/api/feedback/jobs/{job['job_id']}", headers=patient_headers).json()["status"] in ("done", "fallback")


def test_patients_reports_go_before_review_reports(
    client: TestClient, session: Session, admin_headers: Headers, patient_headers: Headers, model: Model
) -> None:
    record = facts_session(session)
    model.delay_s = 0.15
    created = create(client, admin_headers, size=3)
    job = client.post(f"/api/sessions/{record.id}/feedback", json={"language": "bn"}, headers=patient_headers).json()
    assert report_jobs.wait_until_idle(30)
    with Session(session.get_bind()) as db:
        patient = db.get(LlmReport, job["job_id"])
        reviews = db.exec(select(LlmReport).where(LlmReport.review_set_id == created["id"], LlmReport.strategy != "template")).all()
        assert patient is not None and patient.finished_at is not None
        assert patient.finished_at < max(r.finished_at for r in reviews if r.finished_at)  # type: ignore[type-var]


# Blinding and shuffling


def test_raters_never_see_the_version(
    patient_headers: Headers,
    client: TestClient, session: Session, admin_headers: Headers, create_patient: Callable[..., dict[str, Any]]
) -> None:
    with_demo_patient(session, create_patient)
    created = create(client, admin_headers, size=4)
    set_id = created["id"]
    ready(client, admin_headers, set_id)

    listed = client.get(f"/api/admin/review-sets/{set_id}/items", headers=admin_headers).json()
    assert [item["position"] for item in listed] == list(range(1, 9))
    assert all(set(item) == {"code", "position", "rated_by_me"} for item in listed)
    for entry in listed:
        item = client.get(f"/api/admin/review-sets/{set_id}/items/{entry['code']}", headers=admin_headers).json()
        assert set(item) == {"code", "position", "total", "facts", "safety_notices", "report", "my_rating"}
        found = keys(item)
        for hidden in ("version", "model", "fallback_used", "strategy", "prompt_version", "therapist_summary",
                       "latency_ms", "retries", "patient_code", "session_id", "report_id", "job_id"):
            assert hidden not in found, hidden
        text = json.dumps(item).lower()
        for word in ("template", "fallback", "llm", "qwen", "mock"):
            assert word not in text, word
        assert item["report"]["patient_summary"] and item["facts"]["metrics"] is not None


def test_codes_are_random_and_say_nothing() -> None:
    rng = random.Random(1)
    used: set[str] = set()
    codes = [review.new_code(rng, used) for _ in range(500)]
    assert len(set(codes)) == 500
    assert all(len(code) == 5 and set(code) <= set(review.CODE_ALPHABET) for code in codes)
    # Confusable characters are never used.
    assert not set("".join(codes)) & set("01OIBSZG82LQ5")


def test_the_order_is_shuffled_with_versions_mixed(
    session: Session, patient_headers: Headers, client: TestClient
) -> None:
    facts_session(session)
    admin = session.exec(select(User).where(User.role == "admin")).one()
    assert admin.id is not None
    first_llm = 0
    orders = set()
    for seed in range(30):
        found, jobs = review.create_review_set(session, 3, "en", admin.id, seed=seed)
        items = session.exec(
            select(ReviewItem).where(ReviewItem.review_set_id == found.id).order_by(ReviewItem.position)  # type: ignore[arg-type]
        ).all()
        versions = tuple(item.version for item in items)
        orders.add(versions)
        first_llm += versions[0] == "llm"
        assert sorted(versions) == ["llm"] * 3 + ["template"] * 3
        assert len(jobs) == 3
    # Many different orders, and neither version is always first.
    assert len(orders) > 5
    assert 5 <= first_llm <= 25
    # The same seed gives the same set.
    a, _ = review.create_review_set(session, 3, "en", admin.id, seed=7)
    b, _ = review.create_review_set(session, 3, "en", admin.id, seed=7)
    codes = [
        [i.code for i in session.exec(select(ReviewItem).where(ReviewItem.review_set_id == s.id).order_by(ReviewItem.position)).all()]  # type: ignore[arg-type]
        for s in (a, b)
    ]
    assert codes[0] == codes[1]


def test_items_are_hidden_until_every_report_is_written(
    patient_headers: Headers,
    client: TestClient, session: Session, admin_headers: Headers
) -> None:
    facts_session(session)
    report_jobs.run_jobs = False  # Nothing gets written.
    admin = session.exec(select(User).where(User.role == "admin")).one()
    found, _ = review.create_review_set(session, 2, "en", admin.id or 0)
    set_id = found.id
    assert client.get(f"/api/admin/review-sets/{set_id}", headers=admin_headers).json()["status"] == "building"
    assert client.get(f"/api/admin/review-sets/{set_id}/items", headers=admin_headers).status_code == 409


# Rating and results


def test_rating_stores_the_rubric_with_the_set(
    patient_headers: Headers,
    client: TestClient, session: Session, admin_headers: Headers
) -> None:
    facts_session(session)
    set_id = create(client, admin_headers, size=2)["id"]
    ready(client, admin_headers, set_id)
    code = client.get(f"/api/admin/review-sets/{set_id}/items", headers=admin_headers).json()[0]["code"]
    url = f"/api/admin/review-sets/{set_id}/items/{code}/rating"
    body = {"rater": "team", "scores": RUBRIC, "unsafe": False, "unsupported": "  You reached 37 targets.  ", "comment": "ok"}
    created = client.post(url, json=body, headers=admin_headers)
    assert created.status_code == 201, created.text
    rating = created.json()
    assert rating["review_set_id"] == set_id and rating["unsafe"] is False
    assert rating["unsupported_text"] == "You reached 37 targets." and rating["scores"] == RUBRIC
    assert client.post(url, json=body, headers=admin_headers).status_code == 409
    item = client.get(f"/api/admin/review-sets/{set_id}/items/{code}", headers=admin_headers).json()
    assert item["my_rating"]["id"] == rating["id"]
    listed = client.get(f"/api/admin/review-sets/{set_id}/items", headers=admin_headers).json()
    assert [entry["rated_by_me"] for entry in listed].count(True) == 1

    for bad in (
        {**body, "rater": "participant"},
        {**body, "scores": {**RUBRIC, "accuracy": 0}},
        {**body, "scores": {k: v for k, v in RUBRIC.items() if k != "tone"}},
        {k: v for k, v in body.items() if k != "unsafe"},
        {**body, "unsupported": "x" * 1001},
    ):
        assert client.post(url, json=bad, headers=admin_headers).status_code == 422
    assert client.post(f"/api/admin/review-sets/{set_id}/items/NOPE1/rating", json=body, headers=admin_headers).status_code == 404


def test_results_and_agreement_between_two_raters(
    patient_headers: Headers,
    client: TestClient, session: Session, admin_headers: Headers, login: Callable[[str, str], Headers]
) -> None:
    facts_session(session)
    set_id = create(client, admin_headers, size=3)["id"]
    ready(client, admin_headers, set_id)
    other = second_admin(session, login)
    with Session(session.get_bind()) as db:
        version = {i.code: i.version for i in db.exec(select(ReviewItem).where(ReviewItem.review_set_id == set_id)).all()}

    for code, kind in version.items():
        # Rater 1: the LLM version a little better; rater 2 the same, one point lower on clarity.
        base = 5 if kind == "llm" else 3
        first = {**RUBRIC, "helpfulness": base, "clarity": base}
        second = {**first, "clarity": base - 1}
        for headers, scores, rater in ((admin_headers, first, "team"), (other, second, "clinician")):
            body = {"rater": rater, "scores": scores, "unsafe": kind == "template" and code == min(version)}
            assert client.post(f"/api/admin/review-sets/{set_id}/items/{code}/rating", json=body, headers=headers).status_code == 201

    results = client.get(f"/api/admin/review-sets/{set_id}/results", headers=admin_headers).json()
    assert results["items"] == 6 and results["status"] == "ready"
    llm, template = results["versions"]["llm"], results["versions"]["template"]
    assert llm["items"] == 3 and llm["ratings"] == 6
    assert llm["means"]["helpfulness"] == 5 and template["means"]["helpfulness"] == 3
    assert llm["means"]["clarity"] == 4.5 and template["means"]["clarity"] == 2.5
    assert llm["means"]["accuracy"] == 4 and llm["sds"]["accuracy"] == 0
    # The mock never writes a valid report: every LLM item used the template.
    assert results["llm_fallbacks"] == 3
    assert results["versions"]["llm_model_written"]["ratings"] == 0
    unsafe_template = 2 / 6 * 100 if version[min(version)] == "template" else 0
    assert template["unsafe_pct"] == round(unsafe_template, 1) and llm["unsafe_pct"] == 0
    assert [r["rater"] for r in results["raters"]] == ["team", "clinician"]
    by_dimension = {row["dimension"]: row for row in results["agreement"]}
    assert set(by_dimension) == {*review.DIMENSIONS, "unsafe"}
    assert by_dimension["helpfulness"]["kappa"] == 1.0 and by_dimension["helpfulness"]["items"] == 6
    # Constant scores (every accuracy 4): no possible disagreement, so kappa is undefined.
    assert by_dimension["accuracy"]["kappa"] is None
    # Clarity always one point apart (5/4 vs 3/2): agreement is high but not perfect.
    assert 0 < by_dimension["clarity"]["kappa"] < 1

    export = client.get(f"/api/admin/review-sets/{set_id}/export.csv", headers=admin_headers)
    assert export.status_code == 200 and export.headers["content-type"].startswith("text/csv")
    assert f"muvi-report-review-{set_id}.csv" in export.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert len(rows) == 12
    assert list(rows[0]) == review.CSV_COLUMNS
    assert {row["version"] for row in rows} == {"llm", "template"}
    assert {row["patient_code"] for row in rows} == {"P001"}
    assert all(row["model_written"] == "False" for row in rows)
    assert {row["rater"] for row in rows} == {"team", "clinician"}
    llm_rows = [row for row in rows if row["version"] == "llm"]
    assert {row["helpfulness"] for row in llm_rows} == {"5"}


def test_only_admins_use_review_sets(client: TestClient, patient_headers: Headers) -> None:
    assert client.get("/api/admin/review-sets", headers=patient_headers).status_code == 403
    assert client.post("/api/admin/review-sets", json={}, headers=patient_headers).status_code == 403


def test_the_model_written_results_leave_out_fallbacks(session: Session, patient_headers: Headers) -> None:
    facts_session(session)
    admin = session.exec(select(User).where(User.role == "admin")).one()
    found, jobs = review.create_review_set(session, 2, "en", admin.id or 0, seed=3)
    # One LLM report written by the model, one by the template.
    for number, report_id in enumerate(jobs):
        report = session.get(LlmReport, report_id)
        assert report is not None
        report.status, report.fallback_used = ("done", False) if number == 0 else ("fallback", True)
        report.report = {"language": "en", "patient_summary": "x", "highlights": [], "suggestions": [], "next_session_text": "y"}
        session.add(report)
    session.commit()
    items = session.exec(select(ReviewItem).where(ReviewItem.review_set_id == found.id)).all()
    for item in items:
        session.add(ReportRating(report_id=item.report_id, rater="team", rater_user_id=admin.id or 0, scores=RUBRIC, review_set_id=found.id, unsafe=False))
    session.commit()
    results = review.results(session, found.id or 0)
    assert results["llm_fallbacks"] == 1
    assert results["versions"]["llm"]["items"] == 2
    assert results["versions"]["llm_model_written"]["items"] == 1


# Weighted kappa on known data


def test_kappa_on_known_data() -> None:
    kappa = review.weighted_kappa
    assert kappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]) == 1.0
    # Worked by hand (docs/llm-evaluation.md): quadratic weights on a 3-point scale.
    assert kappa([1, 2, 3, 1], [1, 2, 3, 2], categories=(1, 2, 3)) == 0.8
    assert kappa([1, 2, 3, 1], [1, 2, 3, 2], categories=(1, 2, 3), weights="linear") == 0.7143
    # Complete opposite answers.
    assert kappa([1, 1, 3, 3], [3, 3, 1, 1], categories=(1, 2, 3)) == -1.0
    # Unweighted, two categories: observed 0.75, chance 0.5, so 0.5.
    assert kappa([1, 1, 0, 0], [1, 0, 0, 0], categories=(0, 1), weights="none") == 0.5
    # Undefined: everyone gave the same score, or too few items.
    assert kappa([4, 4, 4], [4, 4, 4]) is None
    assert kappa([3], [4]) is None
    with pytest.raises(ValueError):
        kappa([1, 2], [1])


def test_quadratic_kappa_matches_the_pearson_like_formula() -> None:
    """A second, independent formula: quadratic kappa = 2*cov / (var_a + var_b + (mean_a - mean_b)^2),
    with population moments."""
    rng = random.Random(4)
    for _ in range(20):
        a = [rng.randint(1, 5) for _ in range(30)]
        b = [min(5, max(1, x + rng.choice([-1, 0, 0, 1]))) for x in a]
        n = len(a)
        mean_a, mean_b = sum(a) / n, sum(b) / n
        var_a = sum((x - mean_a) ** 2 for x in a) / n
        var_b = sum((y - mean_b) ** 2 for y in b) / n
        cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b, strict=True)) / n
        expected = 2 * cov / (var_a + var_b + (mean_a - mean_b) ** 2)
        assert review.weighted_kappa(a, b) == pytest.approx(expected, abs=1e-4)
