from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Calibration, GameRun, PatientProfile, Trial, WarmupResult
from app.models import Session as SessionRecord
from app.services import progress

CreatePatient = Callable[..., dict[str, Any]]
Login = Callable[[str, str], Headers]

TODAY = datetime.now(UTC).date()


def noon(days_ago: int, hour: int = 12) -> datetime:
    """A fixed time on a day before today (UTC), so tests do not depend on the clock."""
    return datetime.combine(TODAY - timedelta(days=days_ago), time(hour), tzinfo=UTC)


def profile(session: Session, code: str = "P001") -> PatientProfile:
    return session.exec(select(PatientProfile).where(PatientProfile.patient_code == code)).one()


def add_session(
    session: Session,
    patient: PatientProfile,
    started_at: datetime,
    status: str = "completed",
    minutes: int = 30,
) -> SessionRecord:
    assert patient.id is not None
    record = SessionRecord(
        patient_id=patient.id,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=minutes) if status != "active" else None,
        status=status,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def add_warmup(
    session: Session,
    record: SessionRecord,
    exercise_id: str,
    full_reps: int,
    target_reps: int = 10,
    skipped: bool = False,
    active_time_ms: float = 60_000,
) -> None:
    assert record.id is not None
    session.add(
        WarmupResult(
            session_id=record.id,
            exercise_id=exercise_id,
            preset="standard",
            thresholds={"low": 30, "high": 90, "unit": "deg"},
            full_reps=full_reps,
            partial_reps=0,
            target_reps=target_reps,
            active_time_ms=active_time_ms,
            paused_time_ms=0,
            skipped=skipped,
        )
    )
    session.commit()


def add_calibration(session: Session, record: SessionRecord, area: float) -> None:
    assert record.id is not None
    session.add(
        Calibration(
            session_id=record.id,
            affected_side="left",
            shoulder_width_px=180,
            directions_deg=[0, 45, 90, 135, 180, 225, 270, 315],
            reach_radii_sw=[1.0] * 8,
            reach_points_sw=[[1.0, 0.0]] * 8,
            hull_sw=[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
            hull_area_sw2=area,
            quality={"valid": [True] * 8, "retries": 0, "max_trunk_displacement_sw": 0.0},
            created_at=record.started_at + timedelta(minutes=2),
        )
    )
    session.commit()


def add_run(
    session: Session,
    record: SessionRecord,
    outcomes: list[str],
    game_id: str = "reach_activate",
    status: str = "completed",
    seconds: int = 120,
    score: float | None = None,
    metrics: list[dict[str, Any]] | None = None,
    details: dict[str, Any] | None = None,
) -> GameRun:
    assert record.id is not None
    successes = outcomes.count("success")
    started = record.started_at + timedelta(minutes=10)
    run = GameRun(
        session_id=record.id,
        game_id=game_id,
        input_source="keyboard",
        trials_planned=len(outcomes),
        trials_done=len(outcomes),
        status=status,
        started_at=started,
        ended_at=started + timedelta(seconds=seconds) if status != "active" else None,
        score=score if score is not None else float(successes * 10),
        summary={
            "successes": successes,
            "success_rate": successes / len(outcomes) if outcomes else 0,
            "compensated_trials": 0,
            "details": details or {},
        }
        if status != "active"
        else None,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    assert run.id is not None
    for number, outcome in enumerate(outcomes, start=1):
        trial_metrics = metrics[number - 1] if metrics else {}
        session.add(
            Trial(game_run_id=run.id, trial_no=number, outcome=outcome, metrics=trial_metrics)
        )
    session.commit()
    return run


# Pure day logic


D = date(2026, 11, 10)  # A Tuesday.


def days_ago(*offsets: int) -> list[date]:
    return [D - timedelta(days=offset) for offset in offsets]


@pytest.mark.parametrize(
    ("days", "streak"),
    [
        ([], 0),
        (days_ago(0), 1),
        (days_ago(0, 1, 2), 3),
        (days_ago(0, 0, 1), 2),  # Two sessions on one day count once.
        (days_ago(1, 2), 2),  # Nothing yet today: the streak runs up to yesterday.
        (days_ago(0, 2, 3), 1),  # A missed day breaks it.
        (days_ago(2, 3), 0),  # Nothing today or yesterday.
    ],
)
def test_streak_days(days: list[date], streak: int) -> None:
    assert progress.streak_days(days, D) == streak


def test_week_starts_on_monday() -> None:
    assert progress.week_start(D) == date(2026, 11, 9)
    assert progress.week_start(date(2026, 11, 9)) == date(2026, 11, 9)
    assert progress.week_start(date(2026, 11, 15)) == date(2026, 11, 9)  # Sunday.


def test_sessions_this_week_counts_monday_to_today() -> None:
    # Sunday the 8th is last week; Monday the 9th and two today count.
    assert progress.sessions_this_week(days_ago(2, 1, 0, 0), D) == 3


def test_calendar_has_28_days_ending_today() -> None:
    days = progress.calendar(days_ago(0, 0, 3, 27, 28), D)

    assert len(days) == 28
    assert days[0].date == D - timedelta(days=27)
    assert days[-1].date == D
    assert days[-1].completed == 2
    assert days[-4].completed == 1
    assert days[0].completed == 1  # 28 days ago is outside.
    assert sum(day.completed for day in days) == 4


def test_local_day_uses_the_offset() -> None:
    late_evening_utc = datetime(2026, 11, 9, 20, 0, tzinfo=UTC)

    assert progress.local_day(late_evening_utc, 0) == date(2026, 11, 9)
    assert progress.local_day(late_evening_utc, 360) == date(2026, 11, 10)  # Dhaka.
    assert progress.local_day(late_evening_utc, -300) == date(2026, 11, 9)
    # SQLite returns datetimes without a timezone; they are UTC.
    assert progress.local_day(late_evening_utc.replace(tzinfo=None), 360) == date(2026, 11, 10)


# GET /api/patient/progress


def test_progress_without_sessions(client: TestClient, patient_headers: Headers) -> None:
    response = client.get("/api/patient/progress", headers=patient_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["streak_days"] == 0
    assert body["sessions_this_week"] == 0
    assert body["weekly_goal"] == 5
    assert len(body["calendar"]) == 28
    assert body["calendar"][-1] == {"date": TODAY.isoformat(), "completed": 0}
    assert body["series"] == []
    assert body["last_session_date"] is None
    assert body["first_reach"] is None
    assert body["latest_reach"] is None


def test_progress_counts_only_completed_sessions(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    add_session(session, patient, noon(0))
    add_session(session, patient, noon(1))
    add_session(session, patient, noon(2), status="aborted")
    add_session(session, patient, noon(3))

    body = client.get("/api/patient/progress", headers=patient_headers).json()

    assert body["streak_days"] == 2
    assert [point["date"][:10] for point in body["series"]] == [
        (TODAY - timedelta(days=3)).isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
        TODAY.isoformat(),
    ]
    assert body["calendar"][-3]["completed"] == 0  # The aborted day.
    assert body["calendar"][-1]["completed"] == 1
    expected_week = sum(
        1 for ago in (0, 1, 3) if TODAY - timedelta(days=ago) >= progress.week_start(TODAY)
    )
    assert body["sessions_this_week"] == expected_week
    assert body["last_session_date"][:10] == TODAY.isoformat()


def test_progress_series_figures(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    first = add_session(session, patient, noon(2))
    add_calibration(session, first, 1.5)
    add_warmup(session, first, "shoulder_flexion", full_reps=10)  # Goal reached.
    add_warmup(session, first, "elbow_flexion", full_reps=5)  # Not reached.
    add_warmup(session, first, "forward_reach", full_reps=0, skipped=True)
    add_run(session, first, ["success", "success", "reach_fail", "aborted"])
    add_run(session, first, ["success", "miss"], game_id="balloon_pop")
    second = add_session(session, patient, noon(1))

    body = client.get("/api/patient/progress", headers=patient_headers).json()

    assert body["series"][0] == {
        "session_id": first.id,
        "date": body["series"][0]["date"],
        "hull_area_sw2": 1.5,
        "warmup_goals_reached": 1,
        "warmup_total": 3,
        # 3 successes of 5 trials: the stopped trial is left out.
        "game_success_rate": 0.6,
        "total_reps": 15,
        "bloom_peak_openness": None,
        "piano_hit_rate": None,
        "path_sparc": None,
        "elbow_range_deg": None,
    }
    assert body["series"][1] == {
        "session_id": second.id,
        "date": body["series"][1]["date"],
        "hull_area_sw2": None,
        "warmup_goals_reached": 0,
        "warmup_total": 0,
        "game_success_rate": None,
        "total_reps": 0,
        "bloom_peak_openness": None,
        "piano_hit_rate": None,
        "path_sparc": None,
        "elbow_range_deg": None,
    }


def test_progress_movement_quality_figures(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(1))
    add_run(
        session,
        record,
        ["success", "miss", "aborted"],
        game_id="path_trace",
        metrics=[{"sparc": -1.5}, {"sparc": -2.1}, {"sparc": -4.0}],
    )
    add_run(
        session,
        record,
        ["success", "miss"],
        game_id="paint_wall",
        metrics=[{"achieved_range_deg": 80.0}, {"achieved_range_deg": 60.0}],
    )

    [point] = client.get("/api/patient/progress", headers=patient_headers).json()["series"]

    # The stopped trace is left out: (-1.5 - 2.1) / 2.
    assert point["path_sparc"] == pytest.approx(-1.8)
    assert point["elbow_range_deg"] == pytest.approx(70.0)
    assert point["bloom_peak_openness"] is None


def test_summary_includes_path_trace_and_paint_wall(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(0))
    add_run(
        session,
        record,
        ["success", "miss"],
        game_id="path_trace",
        details={"total_stars": 4, "mean_in_corridor_pct": 74.5, "best_sparc": -1.6},
    )
    add_run(session, record, ["success"], game_id="paint_wall", details={"best_range_deg": 81.0})

    body = client.get(f"/api/sessions/{record.id}/summary", headers=patient_headers).json()

    trace, wall = body["games"]
    assert trace["success_rate"] == 0.5
    assert trace["main_measure"] == {"name": "stars", "value": 4, "unit": "count"}
    assert [measure["name"] for measure in trace["extra_measures"]] == [
        "mean_in_corridor_pct",
        "best_sparc",
    ]
    assert trace["extra_measures"][1]["value"] == -1.6
    assert wall["main_measure"] == {"name": "stripes_finished", "value": 1, "unit": "count"}
    assert wall["extra_measures"] == [{"name": "best_range_deg", "value": 81.0, "unit": "deg"}]


def test_progress_hand_game_figures(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    first = add_session(session, patient, noon(2))
    add_run(
        session,
        first,
        ["success", "miss", "aborted"],
        game_id="bloom",
        metrics=[{"peak_openness": 0.6}, {"peak_openness": 0.8}, {"peak_openness": 0.1}],
    )
    add_run(
        session,
        first,
        ["success", "miss"],
        game_id="finger_piano",
        metrics=[{"hits": 3, "notes_total": 4}, {"hits": 2, "notes_total": 4}],
    )
    second = add_session(session, patient, noon(1))
    add_run(
        session,
        second,
        ["success"],
        game_id="finger_piano",
        metrics=[{"hits": 4, "notes_total": 4}],
    )
    add_run(session, second, ["success"])  # Reaching games do not count.

    series = client.get("/api/patient/progress", headers=patient_headers).json()["series"]

    # The stopped trial is left out: (0.6 + 0.8) / 2.
    assert series[0]["bloom_peak_openness"] == pytest.approx(0.7)
    # 5 notes played of 8.
    assert series[0]["piano_hit_rate"] == pytest.approx(0.625)
    assert series[1]["bloom_peak_openness"] is None
    assert series[1]["piano_hit_rate"] == 1.0


def test_progress_first_and_latest_reach(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    for days, area in ((5, 1.0), (3, 1.2), (1, 1.4)):
        add_calibration(session, add_session(session, patient, noon(days)), area)

    body = client.get("/api/patient/progress", headers=patient_headers).json()

    assert body["first_reach"]["hull_area_sw2"] == 1.0
    assert body["latest_reach"]["hull_area_sw2"] == 1.4
    assert body["latest_reach"]["valid"] == [True] * 8
    assert len(body["latest_reach"]["reach_radii_sw"]) == 8


def test_progress_uses_the_timezone_offset(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    # 20:00 UTC yesterday is already today in Dhaka.
    add_session(session, patient, noon(1, hour=20))

    utc = client.get("/api/patient/progress", headers=patient_headers).json()
    dhaka = client.get(
        "/api/patient/progress", params={"tz_offset_minutes": 360}, headers=patient_headers
    ).json()

    assert utc["calendar"][-2]["completed"] == 1
    # Dhaka's today may itself be a day ahead of UTC; either way the session moved forward.
    dhaka_today = date.fromisoformat(dhaka["calendar"][-1]["date"])
    session_day = (noon(1, hour=20) + timedelta(hours=6)).date()
    index = 27 - (dhaka_today - session_day).days
    assert dhaka["calendar"][index]["completed"] == 1
    assert dhaka["calendar"][index]["date"] == session_day.isoformat()


@pytest.mark.parametrize("offset", [-721, 841, "x"])
def test_progress_rejects_bad_offsets(
    client: TestClient, patient_headers: Headers, offset: Any
) -> None:
    response = client.get(
        "/api/patient/progress", params={"tz_offset_minutes": offset}, headers=patient_headers
    )
    assert response.status_code == 422


def test_progress_shows_only_own_sessions(
    client: TestClient,
    patient_headers: Headers,
    session: Session,
    create_patient: CreatePatient,
) -> None:
    create_patient(email="other@example.com")
    add_session(session, profile(session, "P002"), noon(0))

    body = client.get("/api/patient/progress", headers=patient_headers).json()

    assert body["series"] == []
    assert body["streak_days"] == 0


def test_progress_needs_patient(client: TestClient, admin_headers: Headers) -> None:
    assert client.get("/api/patient/progress").status_code == 401
    assert client.get("/api/patient/progress", headers=admin_headers).status_code == 403


def test_dashboard_streak(client: TestClient, patient_headers: Headers, session: Session) -> None:
    patient = profile(session)
    add_session(session, patient, noon(1))
    add_session(session, patient, noon(2))

    body = client.get("/api/patient/dashboard", headers=patient_headers).json()

    assert body["streak_days"] == 2


# Weekly goal and the admin view


def test_weekly_goal_defaults_and_can_be_changed(
    client: TestClient,
    admin_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    patient = create_patient(email="goal@example.com")
    assert patient["weekly_goal"] == 5

    response = client.patch(
        f"/api/admin/patients/{patient['id']}", json={"weekly_goal": 3}, headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json()["weekly_goal"] == 3
    headers = login("goal@example.com", PATIENT_PASSWORD)
    assert client.get("/api/patient/progress", headers=headers).json()["weekly_goal"] == 3


def test_weekly_goal_on_create(create_patient: CreatePatient) -> None:
    assert create_patient(weekly_goal=7)["weekly_goal"] == 7


@pytest.mark.parametrize("goal", [0, 15, 2.5, "3", None])
def test_invalid_weekly_goal_is_422(
    client: TestClient, admin_headers: Headers, create_patient: CreatePatient, goal: Any
) -> None:
    patient = create_patient()

    response = client.patch(
        f"/api/admin/patients/{patient['id']}", json={"weekly_goal": goal}, headers=admin_headers
    )

    assert response.status_code == 422


def test_admin_patient_progress(
    client: TestClient,
    admin_headers: Headers,
    patient_headers: Headers,
    session: Session,
) -> None:
    patient = profile(session)
    add_session(session, patient, noon(0))

    response = client.get(f"/api/admin/patients/{patient.id}/progress", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["streak_days"] == 1
    assert len(response.json()["series"]) == 1
    assert client.get("/api/admin/patients/9999/progress", headers=admin_headers).status_code == 404
    forbidden = client.get(f"/api/admin/patients/{patient.id}/progress", headers=patient_headers)
    assert forbidden.status_code == 403


# GET /api/sessions/{id}/summary


def test_summary_of_a_full_session(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    earlier = add_session(session, patient, noon(3))
    add_calibration(session, earlier, 1.0)
    add_warmup(session, earlier, "shoulder_flexion", full_reps=4)
    add_run(session, earlier, ["success", "reach_fail"], score=40)
    middle = add_session(session, patient, noon(2))  # No warm-up, calibration or games.

    record = add_session(session, patient, noon(0), minutes=25)
    add_calibration(session, record, 1.3)
    add_warmup(session, record, "shoulder_flexion", full_reps=10, active_time_ms=90_000)
    add_warmup(session, record, "elbow_flexion", full_reps=8, active_time_ms=60_000)
    add_warmup(session, record, "forward_reach", full_reps=0, skipped=True, active_time_ms=5_000)
    add_run(session, record, ["success", "success", "success", "reach_fail"], seconds=100)
    add_run(session, record, ["success", "miss"], game_id="balloon_pop", seconds=50)
    add_run(session, record, [], game_id="fruit_catch", status="active")  # Not finished.

    response = client.get(f"/api/sessions/{record.id}/summary", headers=patient_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == record.id
    assert body["status"] == "completed"
    assert body["duration_seconds"] == 25 * 60
    # Warm-up 90 + 60 seconds (the skipped exercise is left out) plus games 100 + 50.
    assert body["active_seconds"] == 300
    assert body["warmup"]["goals_reached"] == 1
    assert body["warmup"]["exercises_total"] == 3
    assert body["warmup"]["total_reps"] == 18
    # The middle session has no warm-up, so the comparison skips back to the earlier one.
    assert body["previous_warmup"]["session_id"] == earlier.id
    assert body["previous_warmup"]["total_reps"] == 4
    assert body["previous_warmup"]["session_id"] != middle.id

    assert [game["game_id"] for game in body["games"]] == ["reach_activate", "balloon_pop"]
    reach_game = body["games"][0]
    assert reach_game["successes"] == 3
    assert reach_game["success_rate"] == 0.75
    assert reach_game["trials_done"] == 4
    assert reach_game["summary"]["successes"] == 3
    assert reach_game["previous"]["session_id"] == earlier.id
    assert reach_game["previous"]["score"] == 40
    assert reach_game["previous"]["success_rate"] == 0.5
    assert body["games"][1]["previous"] is None  # Never played before.

    assert body["reach"]["hull_area_sw2"] == 1.3
    assert body["previous_reach"]["hull_area_sw2"] == 1.0
    assert body["previous_reach"]["session_id"] == earlier.id
    assert body["feedback"] is None
    assert body["flags"] == []


def test_summary_includes_the_hand_games_with_their_measures(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(0))
    add_run(session, record, ["success", "reach_fail"])
    add_run(
        session,
        record,
        ["success", "success", "miss"],
        game_id="bloom",
        details={"best_openness": 0.82, "mean_time_to_open_ms": 1400},
    )
    add_run(
        session,
        record,
        ["success", "miss"],
        game_id="finger_piano",
        details={"note_hit_rate": 0.75, "best_finger": "ring", "hit_rate_ring": 1.0},
    )

    body = client.get(f"/api/sessions/{record.id}/summary", headers=patient_headers).json()

    reach, bloom, piano = body["games"]
    assert reach["main_measure"] == {"name": "mean_reach_ms", "value": None, "unit": "ms"}
    assert reach["extra_measures"] == []
    assert bloom["game_id"] == "bloom"
    assert bloom["score"] == 20
    assert bloom["success_rate"] == pytest.approx(2 / 3)
    assert bloom["main_measure"] == {"name": "flowers_grown", "value": 2, "unit": "count"}
    assert bloom["extra_measures"] == [{"name": "best_openness", "value": 0.82, "unit": "share"}]
    assert piano["game_id"] == "finger_piano"
    assert piano["success_rate"] == 0.5
    assert piano["main_measure"] == {"name": "note_hit_rate", "value": 0.75, "unit": "share"}
    assert piano["extra_measures"] == [{"name": "best_finger", "value": "ring", "unit": "finger"}]


def test_summary_of_a_first_empty_session(client: TestClient, patient_headers: Headers) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]

    body = client.get(f"/api/sessions/{session_id}/summary", headers=patient_headers).json()

    assert body["status"] == "active"
    assert body["duration_seconds"] is None
    assert body["active_seconds"] == 0
    assert body["warmup"] is None
    assert body["previous_warmup"] is None
    assert body["games"] == []
    assert body["reach"] is None
    assert body["previous_reach"] is None


def test_summary_does_not_compare_with_later_sessions(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(3))
    later = add_session(session, patient, noon(1))
    add_calibration(session, later, 2.0)
    add_warmup(session, later, "shoulder_flexion", full_reps=9)
    add_run(session, later, ["success"])

    body = client.get(f"/api/sessions/{record.id}/summary", headers=patient_headers).json()

    assert body["previous_reach"] is None
    assert body["previous_warmup"] is None


def test_summary_includes_questionnaire_and_flags(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    client.post(
        f"/api/sessions/{session_id}/questionnaire",
        json={
            "pain_0_10": 6,
            "fatigue_0_10": 2,
            "enjoyment_1_5": 3,
            "difficulty": "too_hard",
            "new_symptoms": False,
        },
        headers=patient_headers,
    )

    body = client.get(f"/api/sessions/{session_id}/summary", headers=patient_headers).json()

    assert body["feedback"]["pain_0_10"] == 6
    assert body["flags"] == ["pain"]


def test_summary_ownership(
    client: TestClient,
    patient_headers: Headers,
    admin_headers: Headers,
    create_patient: CreatePatient,
    login: Login,
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)

    url = f"/api/sessions/{session_id}/summary"
    assert client.get(url, headers=other).status_code == 404
    assert client.get("/api/sessions/9999/summary", headers=patient_headers).status_code == 404
    assert client.get(url, headers=admin_headers).status_code == 403
    assert client.get(url).status_code == 401
