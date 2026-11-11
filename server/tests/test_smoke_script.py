import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import (
    Calibration,
    GameRun,
    GameSetting,
    SessionFeedback,
    Trial,
    User,
    WarmupResult,
)
from app.models import Session as SessionRecord
from scripts.smoke_test import run_smoke


def test_smoke_passes_every_step(
    client: TestClient, session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_smoke(client, "admin@motionlab.local", "test-password") is True

    output = capsys.readouterr().out
    assert output.count("PASS") == 45
    assert "FAIL" not in output
    assert "PASS  Patient plays a bloom run with non-spatial targets" in output
    assert "PASS  Patient plays a finger_piano run with non-spatial targets" in output
    assert "PASS  Patient plays a path_trace run with non-spatial targets" in output
    assert "PASS  Patient plays a paint_wall run with non-spatial targets" in output
    assert "PASS  Patient plays a pick_place run with non-spatial targets" in output
    assert "PASS  Patient plays a grip_hold run with non-spatial targets" in output
    assert "PASS  Patient's game settings follow the admin's" in output
    assert "PASS  Admin puts both games' settings back" in output
    assert len(session.exec(select(Calibration)).all()) == 1
    assert len(session.exec(select(WarmupResult)).all()) == 6
    assert len(session.exec(select(GameRun)).all()) == 9
    # 20 trials for each reaching game and 4 for each other game.
    assert len(session.exec(select(Trial)).all()) == 84
    # The game library is as it was: never changed, so no settings are left behind.
    assert session.exec(select(GameSetting)).all() == []
    patient = session.exec(select(User).where(User.role == "patient")).one()
    assert patient.is_active is False
    feedback = session.exec(select(SessionFeedback)).one()
    assert feedback.pain_0_10 == 5
    record = session.exec(select(SessionRecord)).one()
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
