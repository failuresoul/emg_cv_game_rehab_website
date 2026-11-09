import math
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, func, select

from app.models import (
    Calibration,
    GameRun,
    PatientProfile,
    SessionFeedback,
    Trial,
    User,
    WarmupResult,
)
from app.models import Session as SessionRecord
from app.schemas.game import GameSummary, TrialCreate
from app.schemas.session import DIRECTIONS_DEG, CalibrationCreate
from app.schemas.session_feedback import SessionFeedbackCreate
from app.schemas.warmup import WarmupResultCreate
from app.services.users import authenticate
from scripts import seed_demo_data as demo

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


def count(session: Session, model: Any) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


def revalidate(model: Any) -> None:
    """Valid against its schema even after a round trip through JSON, as the API would see it."""
    type(model).model_validate_json(model.model_dump_json())


# The generators


@pytest.mark.parametrize("progress", [0.0, 0.5, 1.0])
def test_calibration_is_valid_and_consistent(progress: float) -> None:
    calibration = demo.make_calibration(random.Random(1), "left", progress, 1.0)

    revalidate(calibration)
    assert isinstance(calibration, CalibrationCreate)
    for radius, (x, y), degrees in zip(
        calibration.reach_radii_sw, calibration.reach_points_sw, DIRECTIONS_DEG, strict=True
    ):
        assert math.isclose(math.hypot(x, y), radius, abs_tol=1e-3)
        assert math.isclose(math.degrees(math.atan2(y, x)) % 360, degrees, abs_tol=0.5)
    assert len(calibration.hull_sw) >= 3
    area = demo.polygon_area(calibration.hull_sw)
    assert calibration.hull_area_sw2 == pytest.approx(area, abs=1e-4)


def test_reach_grows_more_for_rahim_than_salma() -> None:
    def area(progress: float, improvement: float) -> float:
        return demo.make_calibration(random.Random(3), "left", progress, improvement).hull_area_sw2

    rahim_gain = area(1, 1.0) / area(0, 1.0)
    salma_gain = area(1, 0.4) / area(0, 0.4)
    assert rahim_gain > 1.3
    assert 1.0 < salma_gain < rahim_gain


def test_warmup_results_are_valid_for_every_exercise() -> None:
    rng = random.Random(2)
    histories: dict[Any, demo.ExerciseHistory] = {}
    for session_index in range(8):
        results = demo.make_warmup(rng, session_index / 7, 1.0, histories)
        assert [result.exercise_id for result in results] == [
            spec.exercise_id for spec in demo.EXERCISES
        ]
        for result in results:
            revalidate(result)
            assert isinstance(result, WarmupResultCreate)
            assert result.full_reps + result.partial_reps == len(result.reps)
            assert result.compensated_reps == sum(rep.compensated for rep in result.reps)
            assert result.personalisation is not None
            if session_index == 0:
                assert result.preset == "standard"
                assert result.personalisation.previous_high is None
            else:
                assert result.preset == "personal"
                assert result.personalisation.previous_high is not None


def test_personal_goals_rise_after_good_sets() -> None:
    spec = demo.EXERCISES[0]  # Shoulder flexion, up from 90 degrees.
    good = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0.05, target=90, best_peak=96
    )
    hard = demo.ExerciseHistory(
        full_reps=4, target_reps=10, compensation_rate=0.1, target=90, best_peak=80
    )
    compensating = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0.4, target=90, best_peak=96
    )

    assert demo.next_target(spec, good) == (95, "raised: 10/10 reps, 5% compensated")
    assert demo.next_target(spec, hard)[0] == 85
    assert demo.next_target(spec, compensating)[1].startswith("lowered for compensation")
    # Never more than 15% past the standard target.
    high = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0, target=103.5, best_peak=110
    )
    assert demo.next_target(spec, high) == (
        103.5,
        "adjusted: 10/10 reps, 0% compensated; limited by standard max",
    )


def test_rahims_warmup_improves() -> None:
    rng = random.Random(demo.SEED)
    histories: dict[Any, demo.ExerciseHistory] = {}
    sessions = [demo.make_warmup(rng, index / 7, 1.0, histories) for index in range(8)]

    def mean_compensation(results: list[WarmupResultCreate]) -> float:
        return sum(result.compensation_rate for result in results) / len(results)

    first, last = sessions[0], sessions[-1]
    assert sum(r.full_reps for r in last) > sum(r.full_reps for r in first)
    assert mean_compensation(last) < mean_compensation(first)
    # Goals rose: the last shoulder-flexion target is above the standard 90 degrees.
    assert last[0].thresholds.high > 90


@pytest.mark.parametrize("game_id", demo.GAMES)
def test_game_trials_are_valid_and_inside_the_reach(game_id: demo.GameName) -> None:
    calibration = demo.make_calibration(random.Random(4), "right", 0.5, 1.0)
    radii = calibration.reach_radii_sw

    trials = demo.make_game_trials(random.Random(5), game_id, radii, 0.5, 1.0)

    assert [trial.trial_no for trial in trials] == list(range(1, 21))
    for trial in trials:
        revalidate(trial)
        assert isinstance(trial, TrialCreate)
        assert trial.target is not None
        assert 3 <= len(trial.trajectory) <= 50
        times = [point[0] for point in trial.trajectory]
        assert times == sorted(times)
        direction = DIRECTIONS_DEG.index(int(trial.target.direction_deg))
        if game_id == "fruit_catch":
            # Fruit falls along the basket line, within the sideways reach.
            assert abs(trial.target.x_sw) <= radii[direction] + 1e-6
        else:
            assert math.hypot(trial.target.x_sw, trial.target.y_sw) <= radii[direction] + 1e-6
        if trial.outcome == "success":
            assert trial.metrics.movement_ms is not None
    outcomes = {trial.outcome for trial in trials}
    assert "success" in outcomes
    assert len(outcomes) > 1  # Some misses too.

    summary = demo.summarise_trials(game_id, trials)
    revalidate(summary)
    assert isinstance(summary, GameSummary)
    assert summary.successes == sum(trial.outcome == "success" for trial in trials)
    if game_id != "reach_activate":
        assert next(iter(summary.details.values())) is not None


def test_games_improve_over_the_sessions() -> None:
    radii = list(demo.BASE_RADII)

    def figures(progress: float) -> tuple[float, float]:
        trials = [
            trial
            for seed in range(10)
            for trial in demo.make_game_trials(
                random.Random(seed), "reach_activate", radii, progress, 1.0
            )
        ]
        summary = demo.summarise_trials("reach_activate", trials)
        assert summary.mean_movement_ms is not None
        return summary.success_rate, summary.mean_movement_ms

    first_rate, first_time = figures(0)
    last_rate, last_time = figures(1)
    assert last_rate > first_rate + 0.15
    assert last_time < first_time * 0.75


def test_questionnaire_is_valid_and_pain_raises_a_flag() -> None:
    calm = demo.make_questionnaire(random.Random(6), 0.5, 1.0, pain=False)
    pain = demo.make_questionnaire(random.Random(6), 0.5, 0.4, pain=True)

    for answers in (calm, pain):
        revalidate(answers)
        assert isinstance(answers, SessionFeedbackCreate)
    assert calm.pain_0_10 < 4
    assert calm.fatigue_0_10 < 8
    assert pain.pain_0_10 == 5


def test_convex_hull_and_area() -> None:
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.5, 0.5)]

    hull = demo.convex_hull(square)

    assert len(hull) == 4
    assert demo.polygon_area(hull) == pytest.approx(1.0)


# Seeding and clearing the database


def demo_profiles(session: Session) -> list[PatientProfile]:
    return list(session.exec(select(PatientProfile).where(col(PatientProfile.is_demo))).all())


def test_seed_creates_two_demo_patients_with_full_sessions(session: Session) -> None:
    logins = demo.seed_demo_data(session, now=NOW)

    profiles = {profile.affected_side: profile for profile in demo_profiles(session)}
    assert set(profiles) == {"left", "right"}
    for email, password in logins:
        assert authenticate(session, email, password) is not None

    expected = {"left": 8, "right": 6}
    for side, profile in profiles.items():
        records = session.exec(
            select(SessionRecord).where(SessionRecord.patient_id == profile.id)
        ).all()
        assert len(records) == expected[side]
        for record in records:
            started = record.started_at.replace(tzinfo=UTC)
            assert NOW - timedelta(days=14) <= started <= NOW
            assert record.status == "completed"
            assert record.ended_at is not None
            assert record.current_step == "summary"
    assert count(session, Calibration) == 14
    assert count(session, WarmupResult) == 14 * 6
    assert count(session, GameRun) == 14 * 3
    assert count(session, Trial) == 14 * 3 * 20
    assert count(session, SessionFeedback) == 14


def test_salma_has_exactly_one_unreviewed_pain_alert(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)

    flagged = session.exec(select(SessionRecord).where(col(SessionRecord.needs_review))).all()

    assert len(flagged) == 1
    alert = flagged[0]
    assert alert.flags == ["pain"]
    assert alert.reviewed_at is None
    profile = session.get(PatientProfile, alert.patient_id)
    assert profile is not None and profile.affected_side == "right"
    feedback = session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == alert.id)
    ).one()
    assert feedback.pain_0_10 == 5


def _snapshot(session: Session) -> list[Any]:
    calibrations = session.exec(select(Calibration).order_by(Calibration.created_at)).all()
    trials = session.exec(select(Trial).order_by(Trial.created_at, Trial.trial_no)).all()
    return [
        [c.reach_radii_sw for c in calibrations],
        [(t.outcome, t.target, t.metrics) for t in trials[:60]],
    ]


def test_same_data_every_time(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)
    first = _snapshot(session)

    demo.seed_demo_data(session, now=NOW)

    assert _snapshot(session) == first
    assert len(demo_profiles(session)) == 2


def test_clear_removes_every_demo_row_and_keeps_real_patients(
    client: TestClient,
    session: Session,
    patient_headers: Headers,
) -> None:
    # A real patient with a session of their own.
    real_session = client.post("/api/sessions", headers=patient_headers).json()["id"]
    demo.seed_demo_data(session, now=NOW)

    removed = demo.clear_demo_data(session)

    assert removed == 2
    assert demo_profiles(session) == []
    assert session.exec(select(User).where(col(User.email).startswith("demo."))).all() == []
    assert count(session, SessionRecord) == 1
    assert session.exec(select(SessionRecord)).one().id == real_session
    for model in (Calibration, WarmupResult, GameRun, Trial, SessionFeedback):
        assert count(session, model) == 0
    assert authenticate(session, "patient@example.com", PATIENT_PASSWORD) is not None
    assert demo.clear_demo_data(session) == 0


def test_clear_option_of_the_script(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    demo.seed_demo_data(session, now=NOW)
    # The script opens its own session on its engine; point it at the test database.
    monkeypatch.setattr(demo, "engine", session.get_bind())
    monkeypatch.setattr(demo, "create_db_and_tables", lambda: None)

    assert demo.main(["--clear"]) == 0

    session.expire_all()
    assert demo_profiles(session) == []
    assert count(session, Trial) == 0


def test_running_without_options_recreates(
    session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(demo, "engine", session.get_bind())
    monkeypatch.setattr(demo, "create_db_and_tables", lambda: None)

    assert demo.main([]) == 0
    assert demo.main([]) == 0

    session.expire_all()
    assert len(demo_profiles(session)) == 2
    assert count(session, SessionRecord) == 14
    output = capsys.readouterr().out
    assert "demo.rahim@example.com" in output
    assert "demo.salma@example.com" in output


def test_refuses_when_a_real_patient_uses_a_demo_email(
    session: Session, create_patient: Any
) -> None:
    create_patient(email="demo.rahim@example.com")

    with pytest.raises(demo.DemoEmailTakenError):
        demo.seed_demo_data(session, now=NOW)

    assert demo_profiles(session) == []
    assert count(session, SessionRecord) == 0


# What the dashboards then show


def test_dashboards_read_the_demo_data(
    client: TestClient, session: Session, admin_headers: Headers
) -> None:
    logins = dict(demo.seed_demo_data(session))
    rahim = client.post(
        "/api/auth/login",
        data={
            "username": "demo.rahim@example.com",
            "password": logins["demo.rahim@example.com"],
        },
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {rahim}"}

    progress = client.get("/api/patient/progress", headers=headers).json()
    assert len(progress["series"]) == 8
    series = progress["series"]
    assert series[-1]["hull_area_sw2"] > series[0]["hull_area_sw2"]
    assert series[-1]["game_success_rate"] > series[0]["game_success_rate"]
    assert progress["streak_days"] >= 1

    summary = client.get(f"/api/sessions/{series[-1]['session_id']}/summary", headers=headers)
    assert summary.status_code == 200
    body = summary.json()
    assert len(body["games"]) == 3
    assert all(game["previous"] is not None for game in body["games"])
    assert body["previous_reach"] is not None

    patients = client.get("/api/admin/patients", headers=admin_headers).json()
    assert sorted(p["user"]["full_name"] for p in patients if p["is_demo"]) == [
        "Demo Rahim",
        "Demo Salma",
    ]
    alerts = client.get("/api/admin/alerts?reviewed=false", headers=admin_headers).json()
    assert len(alerts) == 1
    assert client.get("/api/admin/stats", headers=admin_headers).json()["open_alerts"] == 1
    detail = client.get(f"/api/admin/sessions/{series[-1]['session_id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert len(detail.json()["games"][0]["trials"]) == 20
