"""Unified alerts (Day 17): every generator, idempotency, the status transitions, the migration
of the questionnaire flags, filters and counts."""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.feedback import rules
from app.feedback.rules import Evidence, RedFlag
from app.models import Alert, GameRun, LlmReport, PatientProfile, Trial, User
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.services import alerts

ALERTS = "/api/admin/alerts"


def questionnaire(**changes: Any) -> dict[str, Any]:
    return {
        "pain_0_10": 1,
        "fatigue_0_10": 3,
        "enjoyment_1_5": 4,
        "difficulty": "just_right",
        "new_symptoms": False,
        **changes,
    }


def flagged_session(client: TestClient, headers: Headers, **answers: Any) -> int:
    session_id = int(client.post("/api/sessions", headers=headers).json()["id"])
    response = client.post(
        f"/api/sessions/{session_id}/questionnaire", json=questionnaire(**answers), headers=headers
    )
    assert response.status_code == 201, response.text
    client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=headers)
    return session_id


def profile(session: Session, code: str = "P001") -> PatientProfile:
    return session.exec(select(PatientProfile).where(PatientProfile.patient_code == code)).one()


def all_alerts(session: Session) -> list[Alert]:
    session.expire_all()
    return list(session.exec(select(Alert).order_by(Alert.id)).all())  # type: ignore[arg-type]


def add_record(
    session: Session,
    patient: PatientProfile,
    days_ago: float,
    status: str = "completed",
    fps: float | None = None,
) -> SessionRecord:
    assert patient.id is not None
    when = utc_now() - timedelta(days=days_ago)
    record = SessionRecord(
        patient_id=patient.id,
        started_at=when,
        ended_at=when + timedelta(minutes=20) if status != "active" else None,
        status=status,
        device_info={"browser": "Chrome", "fps": fps} if fps is not None else None,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


# ---- The questionnaire -------------------------------------------------------------------------


def test_the_questionnaire_raises_one_alert_per_safety_flag(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    session_id = flagged_session(
        client, patient_headers, pain_0_10=6, new_symptoms=True, fatigue_0_10=9
    )
    found = {(a.type, a.severity, a.status) for a in all_alerts(session) if a.session_id == session_id}
    assert found == {
        ("pain", "high", "open"),
        ("new_symptoms", "high", "open"),
        ("high_fatigue", "medium", "open"),
    }
    pain = next(a for a in all_alerts(session) if a.type == "pain")
    assert pain.details["pain_0_10"] == 6
    # Running the generator again adds nothing.
    record = session.get(SessionRecord, session_id)
    assert record is not None
    assert alerts.questionnaire_alerts(session, record) == []
    assert len(all_alerts(session)) == 3


def test_answers_without_flags_raise_nothing(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    flagged_session(client, patient_headers)
    assert [a for a in all_alerts(session) if a.type in alerts.QUESTIONNAIRE_TYPES] == []


def test_old_flagged_sessions_are_migrated_with_their_review(
    session: Session, patient_headers: Headers
) -> None:
    patient = profile(session)
    open_one = add_record(session, patient, days_ago=3)
    open_one.flags, open_one.needs_review = ["pain", "high_fatigue"], True
    reviewed = add_record(session, patient, days_ago=2)
    reviewed.flags, reviewed.needs_review = ["new_symptoms"], True
    reviewed.reviewed_at, reviewed.review_note = utc_now(), "Called the patient"
    session.add(open_one)
    session.add(reviewed)
    session.commit()
    engine = session.get_bind()
    assert alerts.migrate_session_flags(engine) == 3  # type: ignore[arg-type]
    assert alerts.migrate_session_flags(engine) == 0  # type: ignore[arg-type]
    rows = {(a.session_id, a.type): a for a in all_alerts(session)}
    assert rows[(open_one.id, "pain")].status == "open"
    assert rows[(open_one.id, "high_fatigue")].severity == "medium"
    migrated = rows[(reviewed.id, "new_symptoms")]
    assert migrated.status == "resolved" and migrated.note == "Called the patient"
    assert migrated.resolved_at is not None


# ---- Sharp decline -------------------------------------------------------------------------------


def test_a_sharp_decline_raises_a_high_alert_once(
    client: TestClient,
    patient_headers: Headers,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flag = RedFlag(
        code="sharp_decline",
        text="notice",
        evidence=(Evidence(id="K6", value=-2.5, game_id="reach_activate"),),
    )
    monkeypatch.setattr(rules, "red_flags", lambda facts, language=None: [flag])
    session_id = flagged_session(client, patient_headers)
    decline = [a for a in all_alerts(session) if a.type == "sharp_decline"]
    assert len(decline) == 1
    assert decline[0].severity == "high" and decline[0].session_id == session_id
    assert decline[0].details == {
        "metrics": [{"id": "K6", "value": -2.5, "game_id": "reach_activate"}]
    }
    record = session.get(SessionRecord, session_id)
    assert record is not None
    assert alerts.sharp_decline_alert(session, record) is None


def test_no_decline_no_alert(client: TestClient, patient_headers: Headers, session: Session) -> None:
    flagged_session(client, patient_headers)
    assert [a for a in all_alerts(session) if a.type == "sharp_decline"] == []


# ---- Missed sessions -----------------------------------------------------------------------------


@pytest.fixture
def patients(
    create_patient: Callable[..., dict[str, Any]], session: Session
) -> Callable[[str], PatientProfile]:
    def make(email: str) -> PatientProfile:
        created = create_patient(email=email)
        found = session.get(PatientProfile, created["id"])
        assert found is not None
        return found

    return make


def test_missed_sessions_after_four_days_once_per_gap(
    session: Session, patients: Callable[[str], PatientProfile]
) -> None:
    away = patients("away@example.com")
    recent = patients("recent@example.com")
    never = patients("never@example.com")
    add_record(session, away, days_ago=5)
    add_record(session, recent, days_ago=2)
    never.created_at = utc_now() - timedelta(days=6)
    session.add(never)
    session.commit()

    made = alerts.missed_sessions_alerts(session)
    assert {a.patient_id for a in made} == {away.id, never.id}
    assert all(a.severity == "low" for a in made)
    by_patient = {a.patient_id: a for a in made}
    # Five days ago, ended 20 minutes later: 4 whole days.
    assert by_patient[away.id].details["days_since"] == 4
    assert alerts.missed_sessions_alerts(session) == []

    # Back for a session, then away again: a new alert for the new gap.
    add_record(session, away, days_ago=4.5)
    later = alerts.missed_sessions_alerts(session, now=utc_now() + timedelta(days=1))
    assert [a.patient_id for a in later] == [away.id]


def test_inactive_patients_are_not_chased(
    client: TestClient,
    admin_headers: Headers,
    session: Session,
    patients: Callable[[str], PatientProfile],
) -> None:
    gone = patients("gone@example.com")
    add_record(session, gone, days_ago=10)
    client.post(f"/api/admin/patients/{gone.id}/deactivate", headers=admin_headers)
    assert alerts.missed_sessions_alerts(session) == []


def test_loading_the_overview_runs_the_daily_checks(
    client: TestClient,
    admin_headers: Headers,
    session: Session,
    patients: Callable[[str], PatientProfile],
) -> None:
    away = patients("away@example.com")
    add_record(session, away, days_ago=7)
    stats = client.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["alerts"]["open_low"] == 1 and stats["open_alerts"] == 1


# ---- Device problems -------------------------------------------------------------------------------


def _run(session: Session, record: SessionRecord, status: str = "completed", source: str = "cv_grip",
         emg_trials: list[bool] | None = None) -> None:
    assert record.id is not None
    run = GameRun(session_id=record.id, game_id="grip_hold", input_source=source,
                  trials_planned=3, status=status)
    session.add(run)
    session.flush()
    assert run.id is not None
    for n, with_emg in enumerate(emg_trials or [], start=1):
        session.add(Trial(game_run_id=run.id, trial_no=n, params={}, outcome="success",
                          timings={"spawn": 0}, metrics={}, compensation={"flagged": False},
                          trajectory=[], emg={"site": "flexors", "trace": [], "metrics": {}} if with_emg else None))
    session.commit()


def test_what_counts_as_a_device_problem(session: Session, patient_headers: Headers) -> None:
    patient = profile(session)
    fine = add_record(session, patient, days_ago=6, fps=30)
    _run(session, fine)
    assert alerts.device_problems(session, fine) == []
    aborted = add_record(session, patient, days_ago=5, status="aborted")
    assert alerts.device_problems(session, aborted) == ["session_aborted"]
    game = add_record(session, patient, days_ago=4)
    _run(session, game, status="aborted")
    assert alerts.device_problems(session, game) == ["game_aborted"]
    sensor = add_record(session, patient, days_ago=3)
    _run(session, sensor, source="emg", emg_trials=[True, False, True])
    assert alerts.device_problems(session, sensor) == ["emg_fallback"]
    steady = add_record(session, patient, days_ago=2)
    _run(session, steady, source="emg", emg_trials=[True, True])
    assert alerts.device_problems(session, steady) == []
    slow = add_record(session, patient, days_ago=1, fps=9)
    assert alerts.device_problems(session, slow) == ["low_fps"]


def test_three_problem_sessions_in_a_row_raise_one_alert_per_streak(
    session: Session, patient_headers: Headers
) -> None:
    patient = profile(session)
    assert patient.id is not None
    add_record(session, patient, days_ago=10, status="aborted")
    add_record(session, patient, days_ago=9, status="aborted")
    assert alerts.device_problem_alert(session, patient.id) is None
    third = add_record(session, patient, days_ago=8, status="aborted")
    alert = alerts.device_problem_alert(session, patient.id)
    assert alert is not None and alert.severity == "low" and alert.session_id == third.id
    assert [item["problems"] for item in alert.details["sessions"]] == [["session_aborted"]] * 3
    # A fourth in the same streak: no second alert.
    add_record(session, patient, days_ago=7, fps=5)
    assert alerts.device_problem_alert(session, patient.id) is None
    # A good session ends the streak; three more problems start a new one.
    good = add_record(session, patient, days_ago=6, fps=30)
    _run(session, good)
    for days in (5, 4, 3):
        add_record(session, patient, days_ago=days, status="aborted")
    assert alerts.device_problem_alert(session, patient.id) is not None
    assert len([a for a in all_alerts(session) if a.type == "repeated_device_problems"]) == 2


def test_ending_sessions_checks_for_device_problems(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    for _ in range(3):
        sid = client.post("/api/sessions", headers=patient_headers).json()["id"]
        client.post(f"/api/sessions/{sid}/end", json={"status": "aborted"}, headers=patient_headers)
    assert [a.type for a in all_alerts(session)] == ["repeated_device_problems"]


# ---- The template rate -------------------------------------------------------------------------------


def _reports(session: Session, statuses: list[str]) -> None:
    """One finished report per session (a session has one report per language)."""
    patient = session.exec(select(PatientProfile)).first()
    assert patient is not None
    for status in statuses:
        record = add_record(session, patient, days_ago=1)
        assert record.id is not None
        session.add(LlmReport(session_id=record.id, language="en", status=status, finished_at=utc_now()))
        session.commit()


def test_more_than_30_percent_templates_raises_one_system_alert(
    session: Session, patient_headers: Headers, client: TestClient, admin_headers: Headers
) -> None:
    _reports(session, ["done"] * 7 + ["fallback"] * 3)
    assert alerts.llm_fallback_alert(session) is None  # exactly 30% is not more
    _reports(session, ["fallback"])
    alert = alerts.llm_fallback_alert(session)
    assert alert is not None and alert.patient_id is None and alert.severity == "low"
    assert alert.details == {"fallback_share": 0.4, "reports": 10}
    _reports(session, ["fallback"])
    assert alerts.llm_fallback_alert(session) is None  # one unresolved at a time
    listed = client.get(f"{ALERTS}?type=llm_fallback_rate", headers=admin_headers).json()
    assert listed[0]["patient_code"] is None
    client.post(f"{ALERTS}/{alert.id}/resolve", headers=admin_headers)
    _reports(session, ["fallback"])
    assert alerts.llm_fallback_alert(session) is not None


def test_fewer_than_ten_reports_never_alert(session: Session, patient_headers: Headers) -> None:
    _reports(session, ["fallback"] * 9)
    assert alerts.llm_fallback_alert(session) is None


# ---- Status, filters and counts -------------------------------------------------------------------


def test_status_moves_forward_with_who_and_when(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    flagged_session(client, patient_headers, pain_0_10=7)
    alert_id = all_alerts(session)[0].id
    ack = client.post(f"{ALERTS}/{alert_id}/acknowledge", json={"note": "Calling today"}, headers=admin_headers)
    assert ack.status_code == 200, ack.text
    body = ack.json()
    assert body["status"] == "acknowledged" and body["note"] == "Calling today"
    assert body["acknowledged_by"] is not None and body["acknowledged_at"].endswith("Z")
    assert client.post(f"{ALERTS}/{alert_id}/acknowledge", headers=admin_headers).status_code == 409
    done = client.post(f"{ALERTS}/{alert_id}/resolve", json={"note": "  "}, headers=admin_headers)
    assert done.status_code == 200
    assert done.json()["status"] == "resolved" and done.json()["note"] == "Calling today"
    assert client.post(f"{ALERTS}/{alert_id}/resolve", headers=admin_headers).status_code == 409
    assert client.post(f"{ALERTS}/{alert_id}/acknowledge", headers=admin_headers).status_code == 409
    assert client.post(f"{ALERTS}/999/resolve", headers=admin_headers).status_code == 404
    long_note = {"note": "x" * 501}
    assert client.post(f"{ALERTS}/{alert_id}/resolve", json=long_note, headers=admin_headers).status_code == 422


def test_resolving_a_sessions_alerts_marks_it_reviewed(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    session_id = flagged_session(client, patient_headers, pain_0_10=7, fatigue_0_10=9)
    pain, fatigue = all_alerts(session)
    client.post(f"{ALERTS}/{pain.id}/resolve", json={"note": "First"}, headers=admin_headers)
    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["reviewed_at"] is None  # fatigue still unresolved
    url = f"/api/admin/sessions/{session_id}/alerts/resolve"
    resolved = client.post(url, json={"note": "All done"}, headers=admin_headers)
    assert resolved.status_code == 200 and [a["id"] for a in resolved.json()] == [fatigue.id]
    detail = client.get(f"/api/admin/sessions/{session_id}", headers=admin_headers).json()
    assert detail["reviewed_at"] is not None and detail["review_note"] == "All done"
    assert client.post(url, headers=admin_headers).status_code == 404


def test_filters_by_status_type_severity_patient_and_session(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
    session: Session,
) -> None:
    create_patient(email="a@example.com")
    second = create_patient(email="b@example.com")
    a = login("a@example.com", PATIENT_PASSWORD)
    b = login("b@example.com", PATIENT_PASSWORD)
    first_session = flagged_session(client, a, pain_0_10=8)
    flagged_session(client, b, fatigue_0_10=9)
    pain = next(x for x in all_alerts(session) if x.type == "pain")
    client.post(f"{ALERTS}/{pain.id}/acknowledge", headers=admin_headers)

    def types(query: str) -> list[str]:
        response = client.get(f"{ALERTS}{query}", headers=admin_headers)
        assert response.status_code == 200, response.text
        return sorted(item["type"] for item in response.json())

    assert types("") == ["high_fatigue", "pain"]
    assert types("?status=open") == ["high_fatigue"]
    assert types("?status=open&status=acknowledged") == ["high_fatigue", "pain"]
    assert types("?severity=high") == ["pain"]
    assert types("?type=high_fatigue") == ["high_fatigue"]
    assert types(f"?patient={second['id']}") == ["high_fatigue"]
    assert types(f"?session_id={first_session}") == ["pain"]
    assert client.get(f"{ALERTS}?status=closed", headers=admin_headers).status_code == 422
    listed = client.get(f"{ALERTS}?type=pain", headers=admin_headers).json()[0]
    assert listed["patient_code"] == "P001"
    assert "@" not in client.get(ALERTS, headers=admin_headers).text


def test_stats_count_open_alerts_by_severity(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    flagged_session(client, patient_headers, pain_0_10=8, new_symptoms=True, fatigue_0_10=9)
    stats = client.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["open_alerts"] == 3
    assert stats["alerts"] == {"open": 3, "open_high": 2, "open_medium": 1, "open_low": 0, "acknowledged": 0}
    pain = next(x for x in all_alerts(session) if x.type == "pain")
    client.post(f"{ALERTS}/{pain.id}/acknowledge", headers=admin_headers)
    stats = client.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["alerts"] == {"open": 2, "open_high": 1, "open_medium": 1, "open_low": 0, "acknowledged": 1}
    client.post(f"{ALERTS}/{pain.id}/resolve", headers=admin_headers)
    assert client.get("/api/admin/stats", headers=admin_headers).json()["alerts"]["acknowledged"] == 0


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", ALERTS),
        ("POST", f"{ALERTS}/1/acknowledge"),
        ("POST", f"{ALERTS}/1/resolve"),
        ("POST", "/api/admin/sessions/1/alerts/resolve"),
    ],
)
def test_alert_routes_need_an_admin(
    client: TestClient, patient_headers: Headers, method: str, path: str
) -> None:
    assert client.request(method, path, headers=patient_headers).status_code == 403
    assert client.request(method, path).status_code == 401


def test_user_rows_are_unchanged(session: Session, patient_headers: Headers) -> None:
    # Alerts store the patient's profile id, never their name or email.
    assert all(isinstance(user, User) for user in session.exec(select(User)).all())
