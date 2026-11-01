import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Calibration, User
from scripts.smoke_test import run_smoke


def test_smoke_passes_every_step(
    client: TestClient, session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_smoke(client, "admin@motionlab.local", "test-password") is True

    output = capsys.readouterr().out
    assert output.count("PASS") == 12
    assert "FAIL" not in output
    assert len(session.exec(select(Calibration)).all()) == 1
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
