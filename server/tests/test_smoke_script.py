import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Calibration, GameRun, Trial, User, WarmupResult
from scripts.smoke_test import run_smoke


def test_smoke_passes_every_step(
    client: TestClient, session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_smoke(client, "admin@motionlab.local", "test-password") is True

    output = capsys.readouterr().out
    assert output.count("PASS") == 23
    assert "FAIL" not in output
    assert len(session.exec(select(Calibration)).all()) == 1
    assert len(session.exec(select(WarmupResult)).all()) == 6
    assert len(session.exec(select(GameRun)).all()) == 1
    assert len(session.exec(select(Trial)).all()) == 20
    patient = session.exec(select(User).where(User.role == "patient")).one()
    assert patient.is_active is False


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
