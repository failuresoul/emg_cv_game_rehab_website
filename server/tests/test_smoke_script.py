import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.models import (
    AdaptationLog,
    Calibration,
    EmgCalibration,
    GameRun,
    GameSetting,
    SessionFeedback,
    Trial,
    User,
    WarmupResult,
)
from app.models import LlmReport, ReportRating
from app.models import Session as SessionRecord
from scripts.smoke_test import run_smoke

# A file database and a running report worker (the mock model), as on a real server: the smoke
# test waits for the questionnaire's report to be written.
from tests.test_feedback_api import client, model, session  # noqa: F401, E402


def test_smoke_passes_every_step(
    client: TestClient, session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_smoke(client, "admin@motionlab.local", "test-password") is True

    output = capsys.readouterr().out
    assert output.count("PASS") == 71
    assert "FAIL" not in output
    assert "PASS  Patient plays a bloom run with non-spatial targets" in output
    assert "PASS  Patient plays a finger_piano run with non-spatial targets" in output
    assert "PASS  Patient plays a path_trace run with non-spatial targets" in output
    assert "PASS  Patient plays a paint_wall run with non-spatial targets" in output
    assert "PASS  Patient plays a pick_place run with non-spatial targets" in output
    assert "PASS  Patient plays a grip_hold run with non-spatial targets" in output
    assert "PASS  Patient's game settings follow the admin's" in output
    assert "PASS  Admin puts both games' settings back" in output
    assert "PASS  Patient reads the session facts, with no name or email" in output
    assert "PASS  The session metrics hold E2, E3, E5, E6, E8 and E9" in output
    assert "PASS  The session facts hold the EMG measures, without traces" in output
    assert "PASS  Admin downloads all trials as CSV" in output
    assert "PASS  Engine: 12 successes raise the level, 8 failures lower it" in output
    assert "PASS  Engine: a decision is logged at the start and after each trial" in output
    assert "PASS  Engine: quick successes then slow failures ask for a rest" in output
    assert "PASS  L2: a run returns sectors and its beliefs update" in output
    assert "PASS  Facts plan the next session once this one ends" in output
    assert "PASS  The questionnaire's report is written, with the fixed stop notice" in output
    assert "PASS  A Bangla report is written in Bangla" in output
    reports = session.exec(select(LlmReport).order_by(col(LlmReport.id))).all()
    assert [(r.language, r.status) for r in reports] == [("en", "fallback"), ("bn", "fallback")]
    assert all(r.facts and r.facts["patient_code"] for r in reports)
    assert len(session.exec(select(ReportRating)).all()) == 1
    assert len(session.exec(select(Calibration)).all()) == 1
    assert len(session.exec(select(WarmupResult)).all()) == 6
    # Nine games in the first session, two adaptive runs in the second, one L2 run in the third,
    # and one Grip and hold run with the muscle sensor in the fourth.
    assert len(session.exec(select(GameRun)).all()) == 13
    # The starts and trials of the staircase (20), tiring (10) and L2 (8) runs.
    assert len(session.exec(select(AdaptationLog)).all()) == 21 + 11 + 9
    # 20 trials for each reaching game and 4 for each other game, and 4 with the muscle sensor.
    trials = session.exec(select(Trial)).all()
    assert len(trials) == 88
    assert sum(1 for trial in trials if trial.emg) == 4
    # The rejected calibration (laptop on mains power) left nothing behind.
    emg = session.exec(select(EmgCalibration)).one()
    assert emg.battery_ok is True and emg.source == "serial" and len(emg.readiness) == 9
    # The game library is as it was: never changed, so no settings are left behind.
    assert session.exec(select(GameSetting)).all() == []
    patient = session.exec(select(User).where(User.role == "patient")).one()
    assert patient.is_active is False
    feedback = session.exec(select(SessionFeedback)).one()
    assert feedback.pain_0_10 == 5
    first, second, third, fourth = session.exec(
        select(SessionRecord).order_by(col(SessionRecord.id))
    ).all()
    assert fourth.status == "completed" and emg.session_id == fourth.id
    assert second.status == "completed" and second.flags == []
    assert third.status == "completed" and third.plan and len(third.plan_overrides) == 1
    record = first
    assert record.flags == ["pain"]
    assert record.reviewed_at is not None
    assert record.review_note == "Smoke test: reviewed"


def test_smoke_reports_failure_and_stops(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_smoke(client, "admin@motionlab.local", "wrong-password") is False

    output = capsys.readouterr().out
    assert "PASS  Server is healthy" in output
    assert "FAIL  Admin logs in" in output
    assert "Admin creates a test patient" not in output
    assert "wrong-password" not in output


def test_smoke_fails_a_warmup_step_and_stops(
    client: TestClient, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from scripts import smoke_test

    # Leaves thumb opposition out, so its history is empty.
    monkeypatch.setattr(smoke_test, "WARMUP_EXERCISES", smoke_test.WARMUP_EXERCISES[:5])

    assert run_smoke(client, "admin@motionlab.local", "test-password") is False

    output = capsys.readouterr().out
    assert "PASS  Patient saves six warm-up results" in output
    assert "FAIL  Patient reads warm-up history" in output
    assert "Patient ends the session" not in output


def test_smoke_puts_back_game_settings_the_admin_had(
    client: TestClient, session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    session.add(
        GameSetting(
            game_id="grip_hold",
            enabled=True,
            default_params={"band_width": 0.2},
            trials_default=12,
            notes="Clinic setting",
        )
    )
    session.commit()

    assert run_smoke(client, "admin@motionlab.local", "test-password") is True
    capsys.readouterr()

    settings = {row.game_id: row for row in session.exec(select(GameSetting)).all()}
    assert set(settings) == {"grip_hold"}
    grip = settings["grip_hold"]
    session.refresh(grip)
    assert grip.default_params == {"band_width": 0.2}
    assert grip.trials_default == 12
    assert grip.notes == "Clinic setting"
