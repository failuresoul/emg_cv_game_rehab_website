"""The muscle sensor's session measures (E2-E9), trials carrying EMG data, and the facts."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.mdc import mdc_for
from app.models import EmgCalibration, GameRun, SessionMetric, Trial
from app.models import Session as SessionRecord
from app.services.session_facts import build_facts
from app.services.session_metrics import compute_session_metrics, fatigue_slope
from app.services.metrics_catalog import get_metric
from tests.conftest import Headers
from tests.test_progress import add_session, noon, profile

EMG_IDS = ("E2", "E3", "E5", "E6", "E8", "E9")


def emg(peak: float, onset: float, relax: float, steadiness: float | None = None) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "peak_mvc": peak, "mean_mvc_active": peak * 0.7, "onset_latency_ms": onset,
        "relaxation_ms": relax, "onset_ms": 400.0, "offset_ms": 2400.0,
    }  # fmt: skip
    if steadiness is not None:
        metrics["steadiness"] = steadiness
        metrics["time_in_band_pct"] = 80.0
    return {"site": "flexors", "trace": [[0.0, 2.0], [20.0, 5.0]], "metrics": metrics}


def add_run(session: Session, record: SessionRecord, game_id: str, trials: list[tuple[str, dict[str, Any] | None]]) -> None:
    assert record.id is not None
    run = GameRun(session_id=record.id, game_id=game_id, engine="L1", input_source="emg", trials_planned=len(trials))
    session.add(run)
    session.commit()
    assert run.id is not None
    for number, (outcome, data) in enumerate(trials, start=1):
        session.add(Trial(game_run_id=run.id, trial_no=number, outcome=outcome, emg=data))
    session.commit()


def calibrate(session: Session, record: SessionRecord, mvc: float = 1750.0) -> None:
    assert record.id is not None
    session.add(
        EmgCalibration(
            session_id=record.id, site="flexors", source="serial", firmware_version="1.0.0",
            sample_rate=500, rest_mean_mv=210, rest_sd_mv=8, mvc_mv=mvc,
            mvc_attempts=[1700, 1800, 1750], threshold_mv=234, battery_ok=True,
        )  # fmt: skip
    )
    session.commit()


def test_the_catalogue_and_mdc_cover_the_emg_measures() -> None:
    for metric_id in EMG_IDS:
        metric = get_metric(metric_id)
        assert metric is not None, metric_id
        assert mdc_for(metric_id) is not None, metric_id
    assert get_metric("E2").unit == "mv"  # type: ignore[union-attr]
    assert get_metric("E9").better_when == "higher"  # type: ignore[union-attr]


def test_fatigue_slope() -> None:
    assert fatigue_slope([90, 85, 80, 75, 70]) == pytest.approx(-5.0)
    assert fatigue_slope([80, 80, 80, 80]) == 0
    assert fatigue_slope([90, 85, 80]) is None  # too few


def test_emg_session_measures(session: Session, patient_headers: Headers) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(0))
    calibrate(session, record)
    add_run(session, record, "reach_activate", [
        ("success", emg(95, 300, 600)), ("success", emg(90, 320, 700)),
        ("miss", emg(85, 400, 800)), ("success", None),  # a trial without EMG is left out
    ])  # fmt: skip
    add_run(session, record, "grip_hold", [
        ("success", emg(80, 250, 500, 0.05)), ("success", emg(75, 260, 520, 0.07)),
        ("aborted", emg(10, 900, 900, 0.5)),  # stopped trials are left out
    ])  # fmt: skip
    assert record.id is not None
    rows = {(row.metric_id, row.game_id): row for row in compute_session_metrics(session, record.id)}

    assert rows[("E2", None)].value == 1750 and rows[("E2", None)].n == 3
    assert rows[("E3", "reach_activate")].value == pytest.approx(2 / 3)
    assert rows[("E3", "grip_hold")].value == 1.0
    assert rows[("E5", "reach_activate")].value == 320
    assert rows[("E6", "reach_activate")].value == 700
    assert rows[("E5", "grip_hold")].value == pytest.approx(255)
    assert rows[("E8", "grip_hold")].value == pytest.approx(0.06)
    assert ("E8", "reach_activate") not in rows
    # Peaks 95, 90, 85, 80, 75 in the order played: falling 5 %MVC per activation.
    assert rows[("E9", None)].value == pytest.approx(-5.0)
    assert rows[("E9", None)].n == 5


def test_no_emg_no_emg_measures(session: Session, patient_headers: Headers) -> None:
    record = add_session(session, profile(session), noon(0))
    add_run(session, record, "reach_activate", [("success", None), ("miss", None)])
    assert record.id is not None
    found = {row.metric_id for row in compute_session_metrics(session, record.id)}
    assert not found & set(EMG_IDS)


def test_the_facts_carry_the_emg_measures(session: Session, patient_headers: Headers) -> None:
    patient = profile(session)
    # Two earlier sessions set a baseline; the latest relaxes much more slowly.
    for days, relax in ((6, 500.0), (4, 520.0), (1, 1400.0)):
        record = add_session(session, patient, noon(days))
        calibrate(session, record)
        add_run(session, record, "grip_hold", [
            ("success", emg(80, 250, relax, 0.05)), ("success", emg(78, 260, relax, 0.05)),
        ])  # fmt: skip
        assert record.id is not None
        compute_session_metrics(session, record.id)
    facts = build_facts(session, record)
    by_id = {metric.id: metric for metric in facts.metrics}
    assert {"E2", "E5", "E6"} <= set(by_id)
    assert by_id["E6"].mdc_status == "worse"
    assert by_id["E6"].game_id == "grip_hold"
    # The feedback's "relax after a squeeze" suggestion follows the muscle sensor.
    from app.feedback.rules import candidates

    assert "RELAX_AFTER_SQUEEZE" in [candidate.id for candidate in candidates(facts)]


def test_trials_accept_and_return_emg_data(client: TestClient, patient_headers: Headers, session: Session) -> None:
    started = client.post("/api/sessions", json={}, headers=patient_headers).json()
    run = client.post(
        f"/api/sessions/{started['id']}/games",
        json={"game_id": "grip_hold", "engine": "L1", "input_source": "emg", "trials_planned": 5},
        headers=patient_headers,
    )
    assert run.status_code == 201, run.text
    run_id = run.json()["id"]
    trial = {"trial_no": 1, "outcome": "success", "emg": emg(80, 250, 500, 0.05)}
    response = client.post(f"/api/games/{run_id}/trials", json=[trial], headers=patient_headers)
    assert response.status_code in (200, 201), response.text
    stored = session.exec(select(Trial).where(Trial.game_run_id == run_id)).one()
    assert stored.emg is not None and stored.emg["metrics"]["relaxation_ms"] == 500

    too_long = {**trial, "trial_no": 2, "emg": {**emg(80, 250, 500), "trace": [[0.0, 1.0]] * 1501}}
    assert client.post(f"/api/games/{run_id}/trials", json=[too_long], headers=patient_headers).status_code == 422
    over = {**trial, "trial_no": 3, "emg": {**emg(80, 250, 500), "metrics": {"peak_mvc": 130}}}
    assert client.post(f"/api/games/{run_id}/trials", json=[over], headers=patient_headers).status_code == 422
    assert session.exec(select(SessionMetric)).all() is not None


def test_the_admin_session_detail_has_the_emg_calibration_and_traces(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers
) -> None:
    record = add_session(session, profile(session), noon(0))
    calibrate(session, record)
    add_run(session, record, "grip_hold", [("success", emg(80, 250, 500, 0.05))])
    detail = client.get(f"/api/admin/sessions/{record.id}", headers=admin_headers).json()
    assert detail["emg_calibration"]["mvc_mv"] == 1750
    assert detail["emg_calibration"]["threshold_mv"] == 234
    trial = detail["games"][0]["trials"][0]
    assert trial["emg"]["trace"] == [[0.0, 2.0], [20.0, 5.0]]
    assert trial["emg"]["metrics"]["onset_ms"] == 400
