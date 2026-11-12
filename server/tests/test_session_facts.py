import json
from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select
from test_progress import add_calibration, add_run, add_session, noon, profile
from test_session_metrics import add_feedback

from app.models import SessionMetric, Trial
from app.models import Session as SessionRecord
from app.schemas.metrics import FactsMetric
from app.services.session_facts import choose_metrics, directions, hand_loss_pct
from app.services.session_metrics import compute_session_metrics


def add_metric(
    session: Session,
    record: SessionRecord,
    metric_id: str,
    value: float,
    game_id: str | None = None,
    unit: str = "ms",
) -> None:
    assert record.id is not None
    session.add(
        SessionMetric(
            session_id=record.id,
            metric_id=metric_id,
            value=value,
            unit=unit,
            n=1,
            game_id=game_id,
        )
    )
    session.commit()


def history(session: Session) -> list[SessionRecord]:
    """Four completed sessions and an active one: movement time falls, reach area stays."""
    patient = profile(session)
    records = [add_session(session, patient, noon(days)) for days in (8, 6, 4, 2)]
    values = zip(records, (1000, 1100, 950, 800), (1.5, 1.5, 1.52, 1.55), strict=True)
    for record, ms, area in values:
        add_metric(session, record, "K6", ms, "reach_activate")
        add_metric(session, record, "K1", area, unit="sw2")
    active = add_session(session, patient, noon(0), status="active")
    add_metric(session, active, "K6", 300, "reach_activate")
    return records


# Patient series


def test_patient_reads_their_own_series(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    records = history(session)
    response = client.get("/api/patient/progress/metrics?ids=K1,K6", headers=patient_headers)
    assert response.status_code == 200, response.text
    series = response.json()
    assert [(item["metric_id"], item["game_id"]) for item in series] == [
        ("K1", None),
        ("K6", "reach_activate"),
    ]
    movement = series[1]
    assert movement["unit"] == "ms" and movement["better_when"] == "lower"
    # Completed sessions only, oldest first: the active session's 300 ms is left out.
    assert [point["value"] for point in movement["points"]] == [1000, 1100, 950, 800]
    assert [point["session_id"] for point in movement["points"]] == [r.id for r in records]

    every = client.get("/api/patient/progress/metrics", headers=patient_headers).json()
    assert len(every) == 2


def test_series_ids_are_checked_and_need_a_patient(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    response = client.get("/api/patient/progress/metrics?ids=K1,Z9", headers=patient_headers)
    assert response.status_code == 422
    assert "Z9" in response.json()["detail"]
    assert client.get("/api/patient/progress/metrics", headers=admin_headers).status_code == 403
    assert client.get("/api/patient/progress/metrics").status_code == 401


def test_a_patient_never_sees_another_patients_series(
    client: TestClient,
    session: Session,
    patient_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    history(session)
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    assert client.get("/api/patient/progress/metrics", headers=other).json() == []


# Admin table


def test_admin_table_of_changes(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    history(session)
    patient_id = profile(session).id
    response = client.get(f"/api/admin/patients/{patient_id}/metrics", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mdc_provisional"] is True
    rows = {row["metric_id"]: row for row in body["metrics"]}
    movement = rows["K6"]
    # Baseline 1050 ms, latest 800 ms: 250 ms faster is 1.67 MDC better.
    assert movement["baseline"] == 1050
    assert movement["latest"] == 800
    assert movement["change"] == -250
    assert movement["change_mdc"] == pytest.approx(1.667, abs=1e-3)
    assert movement["status"] == "improved"
    assert movement["mdc"] == 150 and movement["provisional"] is True
    assert movement["n_sessions"] == 4
    assert rows["K1"]["status"] == "no_detectable_change"
    assert len(body["series"]) == 2


def test_admin_table_needs_an_admin_and_a_patient(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    patient_id = profile(session).id
    assert client.get("/api/admin/patients/999/metrics", headers=admin_headers).status_code == 404
    url = f"/api/admin/patients/{patient_id}/metrics"
    assert client.get(url, headers=patient_headers).status_code == 403
    body = client.get(url, headers=admin_headers).json()
    assert body["metrics"] == [] and body["series"] == []


# Session facts


def reach_trials(session: Session, record: SessionRecord) -> None:
    """Reach and squeeze: outward (0°) always reached, up (90°) mostly missed, 45° half."""
    outcomes = {
        0: ["success"] * 4,
        90: ["success", "reach_fail", "reach_fail"],
        45: ["success", "miss"],
    }
    flat = [(degrees, outcome) for degrees, found in outcomes.items() for outcome in found]
    run = add_run(session, record, [outcome for _, outcome in flat])
    assert run.id is not None
    trials = session.exec(
        select(Trial).where(Trial.game_run_id == run.id).order_by(col(Trial.trial_no))
    ).all()
    for trial, (degrees, _) in zip(trials, flat, strict=True):
        trial.target = {"direction_deg": degrees}
        # 30 Hz with one 400 ms gap, and one trial flagged.
        trial.trajectory = [[t, 0.1, 0.1] for t in [0, 33, 66, 466, 500]]
        trial.compensation = {"flagged": degrees == 45, "type": "trunk+shoulder" if degrees == 45 else None}
        session.add(trial)
    session.commit()


def facts_session(session: Session) -> SessionRecord:
    """Two earlier completed sessions, then this one with games, a questionnaire and flags."""
    patient = profile(session)
    for days in (6, 4):
        earlier = add_session(session, patient, noon(days))
        add_calibration(session, earlier, 1.2)
        add_run(session, earlier, ["success"], metrics=[{"movement_ms": 1200}])
    record = add_session(session, patient, noon(1))
    add_calibration(session, record, 1.6)
    reach_trials(session, record)
    add_run(
        session, record, ["success", "miss"], game_id="bloom", metrics=[{"peak_openness": 0.8}, {}]
    )
    add_feedback(session, record, pain=5)
    record.flags = ["pain"]
    session.add(record)
    session.commit()
    for session_id in session.exec(select(SessionRecord.id)).all():
        assert session_id is not None
        compute_session_metrics(session, session_id)
    return record


def test_facts_shape(client: TestClient, patient_headers: Headers, session: Session) -> None:
    record = facts_session(session)
    response = client.get(f"/api/sessions/{record.id}/facts", headers=patient_headers)
    assert response.status_code == 200, response.text
    facts = response.json()
    assert set(facts) == {
        "session_id", "patient_code", "session_no", "language", "affected_side",
        "duration_min", "baseline_available", "games", "metrics", "directions", "flags",
        "self_report", "adherence", "next_session", "safety_notice_present",
    }  # fmt: skip
    assert facts["session_id"] == record.id
    assert facts["patient_code"] == "P001"
    assert facts["session_no"] == 3
    assert facts["language"] == "en" and facts["affected_side"] == "left"
    assert facts["duration_min"] == 30
    assert facts["baseline_available"] is True
    assert facts["games"] == {
        "reach_activate": {
            "trials": 9,
            "success_rate": pytest.approx(6 / 9),
            "level_start": None,
            "level_end": None,
        },
        "bloom": {"trials": 2, "success_rate": 0.5, "level_start": None, "level_end": None},
    }
    assert facts["directions"] == {"weak": [90], "strong": [0]}
    assert facts["flags"]["compensation_rate"] == pytest.approx(2 / 11)
    assert facts["flags"]["fatigue_flag"] is False
    # One 400 ms gap in each 500 ms reach trial.
    assert facts["flags"]["hand_loss_pct"] == 80
    assert facts["flags"]["safety_flags"] == ["pain"]
    assert facts["flags"]["shoulder_compensation_rate"] == pytest.approx(2 / 11)
    assert facts["self_report"] == {"pain_0_10": 5, "fatigue_0_10": 4, "enjoyment_1_5": 5}
    assert facts["adherence"]["planned_this_week"] == 5
    assert 1 <= facts["adherence"]["sessions_this_week"] <= 3
    # The session ended with a pain flag: the next plan is the lighter one, three games.
    next_session = facts["next_session"]
    assert set(next_session) == {"focus_movements", "focus_directions", "planned_games"}
    assert len(next_session["planned_games"]) == 3
    assert facts["safety_notice_present"] is True

    metrics = facts["metrics"]
    assert 1 <= len(metrics) <= 8
    assert set(metrics[0]) == {
        "id", "game_id", "name", "value", "baseline", "unit", "change_mdc", "mdc_status",
    }  # fmt: skip
    area = next(item for item in metrics if item["id"] == "K1")
    # Reach area 1.2, 1.2, then 1.6: +0.4 sw2 is 2.67 MDC: improved, listed first.
    assert area["baseline"] == 1.2 and area["value"] == 1.6
    assert area["mdc_status"] == "improved"
    assert metrics[0]["mdc_status"] in ("improved", "worse")
    assert all(item["id"] not in ("P1", "P2", "P3") for item in metrics)


def test_facts_never_hold_a_name_or_an_email(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    record = facts_session(session)
    for headers in (patient_headers, admin_headers):
        text = client.get(f"/api/sessions/{record.id}/facts", headers=headers).text
        assert "Alice" not in text and "Rahman" not in text
        assert "@" not in text and "example.com" not in text
        assert "comment" not in json.loads(text)


def test_facts_belong_to_the_owner_or_an_admin(
    client: TestClient,
    session: Session,
    patient_headers: Headers,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    record = add_session(session, profile(session), noon(1))
    url = f"/api/sessions/{record.id}/facts"
    assert client.get(url, headers=patient_headers).status_code == 200
    assert client.get(url, headers=admin_headers).status_code == 200
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    assert client.get(url, headers=other).status_code == 404
    assert client.get(url).status_code == 401
    assert client.get("/api/sessions/999/facts", headers=admin_headers).status_code == 404


def test_facts_of_a_first_session_with_nothing_yet(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    record = add_session(session, profile(session), noon(0), status="active")
    facts = client.get(f"/api/sessions/{record.id}/facts", headers=patient_headers).json()
    assert facts["session_no"] == 1
    assert facts["baseline_available"] is False
    assert facts["duration_min"] is None
    assert facts["games"] == {} and facts["metrics"] == []
    assert facts["directions"] == {"weak": [], "strong": []}
    assert facts["flags"] == {
        "compensation_rate": None,
        "fatigue_flag": False,
        "hand_loss_pct": None,
        "shoulder_compensation_rate": None,
        "safety_flags": [],
    }
    assert facts["self_report"] is None
    assert facts["safety_notice_present"] is False


def fact(metric_id: str, status: str, change_mdc: float | None) -> FactsMetric:
    return FactsMetric(
        id=metric_id,
        game_id=None,
        name=metric_id,
        value=1,
        baseline=1,
        unit="ms",
        change_mdc=change_mdc,
        mdc_status=status,  # type: ignore[arg-type]
    )


def test_changed_measures_come_first_then_key_ones() -> None:
    chosen = choose_metrics(
        [
            fact("G3", "no_detectable_change", 0.1),
            fact("K6", "worse", -1.2),
            fact("G1", "no_detectable_change", 0.3),
            fact("H3", "improved", 2.5),
            fact("K1", "no_baseline", None),
        ]
    )
    assert [item.id for item in chosen] == ["H3", "K6", "G1", "K1", "G3"]
    many = choose_metrics([fact(f"X{n}", "no_detectable_change", 0) for n in range(12)])
    assert len(many) == 8


def test_direction_and_hand_loss_helpers() -> None:
    trial = Trial(game_run_id=1, trial_no=1, outcome="success", target={"direction_deg": 0.0})
    assert directions([trial]).strong == [0]
    assert directions([Trial(game_run_id=1, trial_no=2, outcome="miss")]).weak == []
    assert hand_loss_pct([trial]) is None
    tracked = Trial(
        game_run_id=1, trial_no=3, outcome="success", trajectory=[[0, 0, 0], [100, 0, 0]]
    )
    assert hand_loss_pct([tracked]) == 0
