from typing import Any

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select
from test_progress import add_calibration, add_run, add_session, noon, profile

from app.models import SessionFeedback, SessionMetric, Trial, WarmupResult
from app.models import Session as SessionRecord
from app.services import session_metrics
from app.services.metrics_catalog import load_catalog
from app.services.session_metrics import (
    SessionNotFoundError,
    compute_for_sessions,
    compute_session_metrics,
    list_session_metrics,
)
from scripts import backfill_metrics


def add_result(
    session: Session,
    record: SessionRecord,
    exercise_id: str,
    best_peak: float | None,
    full_reps: int = 9,
    low: float = 30,
    skipped: bool = False,
) -> None:
    assert record.id is not None
    session.add(
        WarmupResult(
            session_id=record.id,
            exercise_id=exercise_id,
            preset="standard",
            thresholds={"low": low, "high": 90},
            full_reps=full_reps,
            partial_reps=1,
            target_reps=10,
            best_peak=best_peak,
            active_time_ms=60_000,
            paused_time_ms=0,
            skipped=skipped,
        )
    )
    session.commit()


def add_feedback(session: Session, record: SessionRecord, pain: int = 2) -> None:
    assert record.id is not None
    session.add(
        SessionFeedback(
            session_id=record.id,
            pain_0_10=pain,
            fatigue_0_10=4,
            enjoyment_1_5=5,
            difficulty="just_right",
            new_symptoms=False,
        )
    )
    session.commit()


def set_server(session: Session, run_id: int, values: list[dict[str, Any]]) -> None:
    trials = session.exec(
        select(Trial).where(Trial.game_run_id == run_id).order_by(col(Trial.trial_no))
    ).all()
    for trial, server in zip(trials, values, strict=True):
        trial.metrics_server = server
        session.add(trial)
    session.commit()


def by_key(rows: list[SessionMetric]) -> dict[tuple[str, str | None], SessionMetric]:
    return {(row.metric_id, row.game_id): row for row in rows}


def full_session(session: Session) -> SessionRecord:
    """A session with every part: calibration, warm-up, nine kinds of trials, questionnaire."""
    record = add_session(session, profile(session), noon(1))
    add_calibration(session, record, 1.6)
    add_result(session, record, "shoulder_flexion", 118.0)
    add_result(session, record, "shoulder_abduction", 96.0)
    add_result(session, record, "elbow_flexion", 62.0)
    add_result(session, record, "forward_reach", 0.82)
    add_result(session, record, "hand_open_close", 1.75, low=1.2)
    add_result(session, record, "thumb_opposition", 0.3, skipped=True)

    reach = add_run(
        session,
        record,
        ["success", "success", "miss", "aborted"],
        metrics=[
            {"reaction_ms": 999, "path_efficiency": 0.5},
            {"reaction_ms": 999},
            {"reaction_ms": 999},
            {"reaction_ms": 1},
        ],
    )
    assert reach.id is not None
    # The server's values come first; the stopped trial is left out.
    set_server(
        session,
        reach.id,
        [
            {"reaction_ms": 300, "movement_ms": 900, "path_efficiency": 0.9, "sparc": -1.5,
             "peak_speed_sw_s": 1.2, "speed_peaks": 1},
            {"reaction_ms": 400, "movement_ms": 1100, "path_efficiency": 0.8, "sparc": -1.7,
             "peak_speed_sw_s": 1.0, "speed_peaks": 2},
            {"reaction_ms": None, "movement_ms": None},
            {"reaction_ms": 5},
        ],
    )
    add_run(
        session,
        record,
        ["success", "miss"],
        game_id="finger_piano",
        metrics=[{"hits": 3, "notes_total": 4}, {"hits": 1, "notes_total": 4}],
    )
    add_run(
        session,
        record,
        ["success", "success", "miss"],
        game_id="paint_wall",
        metrics=[
            {"achieved_range_deg": 70.0},
            {"achieved_range_deg": 81.5},
            {"achieved_range_deg": 50.0},
        ],
    )
    add_run(
        session,
        record,
        ["success", "miss"],
        game_id="grip_hold",
        metrics=[
            {"steadiness": 0.04, "relaxation_ms": 600},
            {"steadiness": 0.06, "relaxation_ms": None},
        ],
    )
    add_run(
        session,
        record,
        ["success", "success"],
        game_id="pick_place",
        metrics=[{"transport_ms": 2000}, {"transport_ms": 3000}],
    )
    add_run(
        session, record, ["success"], game_id="bloom", metrics=[{"peak_openness": 0.84}]
    )
    add_feedback(session, record, pain=3)
    return record


def test_a_full_session_has_every_measure_it_can(
    session: Session, patient_headers: Headers
) -> None:
    record = full_session(session)
    assert record.id is not None
    rows = by_key(compute_session_metrics(session, record.id))

    expected = {
        ("K1", None), ("R1", None), ("R2", None), ("R4", None), ("H1", None),
        ("G3", None), ("G4", None), ("G1", None), ("G2", None), ("K12", None),
        ("K5", "reach_activate"), ("K6", "reach_activate"), ("K7", "reach_activate"),
        ("K8", "reach_activate"), ("K9", "reach_activate"), ("K10", "reach_activate"),
        ("H2", "finger_piano"), ("R3", "paint_wall"), ("H3", "grip_hold"),
        ("H4", "grip_hold"), ("H5", "pick_place"), ("H6", "bloom"),
        ("P1", None), ("P2", None), ("P3", None),
    }  # fmt: skip
    assert set(rows) == expected

    assert rows[("K1", None)].value == 1.6
    assert rows[("K1", None)].unit == "sw2"
    # The median of the server's 300 and 400 ms; the client's 999 and the stopped trial unused.
    reaction = rows[("K5", "reach_activate")]
    assert (reaction.value, reaction.n, reaction.unit) == (350, 2, "ms")
    assert reaction.details is not None
    assert reaction.details["from_server"] == 2 and reaction.details["from_client"] == 0
    assert reaction.details["iqr"] == pytest.approx(50)
    assert rows[("K7", "reach_activate")].value == pytest.approx(0.85)
    assert rows[("K10", "reach_activate")].value == 1.5
    # Range measures take the best value.
    assert rows[("R3", "paint_wall")].value == 81.5
    assert rows[("R1", None)].value == 118
    assert rows[("H1", None)].value == pytest.approx(0.55)
    # Rates.
    assert rows[("H2", "finger_piano")].value == pytest.approx(4 / 8)
    # 2 + 1 + 2 + 1 + 2 + 1 = 9 successes of 3 + 2 + 3 + 2 + 2 + 1 = 13 counted trials (the
    # stopped one left out).
    assert rows[("G1", None)].value == pytest.approx(9 / 13)
    assert rows[("G1", None)].n == 13
    assert rows[("K12", None)].value == 0
    # Trial measures from the browser when the server has none.
    assert rows[("H5", "pick_place")].value == 2500
    assert rows[("H5", "pick_place")].details["from_client"] == 2  # type: ignore[index]
    assert rows[("H4", "grip_hold")].n == 1
    # Warm-up: five exercises done (one skipped), 9 of 10 reps each reaches the goal.
    assert (rows[("G3", None)].value, rows[("G4", None)].value) == (45, 5)
    # 5 minutes of warm-up plus six 2-minute games.
    assert rows[("G2", None)].value == pytest.approx(17)
    assert (rows[("P1", None)].value, rows[("P3", None)].value) == (3, 5)


def test_every_unit_comes_from_the_catalogue(session: Session, patient_headers: Headers) -> None:
    record = full_session(session)
    assert record.id is not None
    units = {metric.id: metric.unit for metric in load_catalog()}
    for row in compute_session_metrics(session, record.id):
        assert row.unit == units[row.metric_id]


def test_missing_parts_leave_their_measures_out(
    session: Session, patient_headers: Headers
) -> None:
    patient = profile(session)
    empty = add_session(session, patient, noon(3))
    assert empty.id is not None
    assert compute_session_metrics(session, empty.id) == []

    # A warm-up skipped completely, no games, no questionnaire: only the reach area.
    skipped = add_session(session, patient, noon(2))
    assert skipped.id is not None
    add_calibration(session, skipped, 1.2)
    for exercise in ("shoulder_flexion", "hand_open_close"):
        add_result(session, skipped, exercise, None, full_reps=0, skipped=True)
    ids = {row.metric_id for row in compute_session_metrics(session, skipped.id)}
    assert ids == {"K1"}

    # A warm-up exercise without a best peak, and games with no usable measures.
    partial = add_session(session, patient, noon(1))
    assert partial.id is not None
    add_result(session, partial, "shoulder_flexion", None)
    add_run(session, partial, ["aborted"], metrics=[{"reaction_ms": 300}])
    add_run(session, partial, ["miss"], game_id="bloom", metrics=[{}])
    rows = by_key(compute_session_metrics(session, partial.id))
    assert ("R1", None) not in rows
    assert ("K5", "reach_activate") not in rows
    assert ("H6", "bloom") not in rows
    assert rows[("G1", None)].value == 0  # The bloom miss; the stopped reach left out.
    assert ("G3", None) in rows and ("P1", None) not in rows


def test_computing_again_replaces_the_rows(session: Session, patient_headers: Headers) -> None:
    record = full_session(session)
    assert record.id is not None
    def values() -> list[tuple[str, str | None, float]]:
        assert record.id is not None
        rows = compute_session_metrics(session, record.id)
        return [(row.metric_id, row.game_id, row.value) for row in rows]

    first, second = values(), values()
    assert sorted(first, key=str) == sorted(second, key=str)
    stored = session.exec(select(SessionMetric)).all()
    assert len(stored) == len(first)
    assert len(list_session_metrics(session, record.id)) == len(first)


def test_unknown_session(session: Session) -> None:
    with pytest.raises(SessionNotFoundError):
        compute_session_metrics(session, 999)


def test_computed_when_the_questionnaire_is_sent_and_the_session_ends(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    started = client.post("/api/sessions", headers=patient_headers).json()
    session_id = started["id"]
    answers = {
        "pain_0_10": 1,
        "fatigue_0_10": 2,
        "enjoyment_1_5": 4,
        "difficulty": "just_right",
        "new_symptoms": False,
    }
    url = f"/api/sessions/{session_id}/questionnaire"
    assert client.post(url, json=answers, headers=patient_headers).status_code == 201
    ids = {row.metric_id for row in list_session_metrics(session, session_id)}
    assert ids == {"P1", "P2", "P3"}

    record = session.get(SessionRecord, session_id)
    assert record is not None
    add_calibration(session, record, 1.4)
    ended = client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
    )
    assert ended.status_code == 200, ended.text
    ids = {row.metric_id for row in list_session_metrics(session, session_id)}
    assert ids == {"K1", "P1", "P2", "P3"}


def test_a_failure_never_blocks_ending_the_session(
    client: TestClient, patient_headers: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(session_metrics, "build_rows", broken)
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    ended = client.post(
        f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "completed"


def test_compute_for_every_session(session: Session, patient_headers: Headers) -> None:
    record = full_session(session)
    other = add_session(session, profile(session), noon(4))
    add_calibration(session, other, 1.0)
    rows = compute_for_sessions(session)
    assert rows == len(list(session.exec(select(SessionMetric)).all()))
    assert {row.session_id for row in session.exec(select(SessionMetric)).all()} == {
        record.id,
        other.id,
    }


# The backfill script


def test_backfill_computes_every_completed_session(
    session: Session, patient_headers: Headers
) -> None:
    patient = profile(session)
    done = [add_session(session, patient, noon(days)) for days in (5, 4, 3)]
    for record, area in zip(done, (1.1, 1.3, 1.5), strict=True):
        add_calibration(session, record, area)
        add_run(session, record, ["success", "miss"], metrics=[{"reaction_ms": 300}, {}])
    active = add_session(session, patient, noon(0), status="active")
    add_calibration(session, active, 2.0)

    report = backfill_metrics.backfill(session)

    assert report.sessions == 3
    assert report.trials == 6
    assert report.failed == []
    assert report.metrics["K1"] == 3 and report.metrics["G1"] == 3
    stored = session.exec(select(SessionMetric)).all()
    assert {row.session_id for row in stored} == {record.id for record in done}
    assert report.metric_rows == len(stored)
    lines = report.lines()
    assert lines[0] == "Sessions computed: 3"
    assert "K1 3" in lines[3]

    # Idempotent: the same report and rows again.
    again = backfill_metrics.backfill(session)
    assert again.metric_rows == report.metric_rows
    assert len(session.exec(select(SessionMetric)).all()) == len(stored)


def test_backfill_one_session_and_report_failures(
    session: Session, patient_headers: Headers
) -> None:
    active = add_session(session, profile(session), noon(0), status="active")
    add_calibration(session, active, 2.0)
    assert active.id is not None
    report = backfill_metrics.backfill(session, [active.id, 999])
    assert report.sessions == 1
    assert [session_id for session_id, _ in report.failed] == [999]
    assert any(line.startswith("FAILED session 999") for line in report.lines())


def test_backfill_script_main(
    session: Session,
    patient_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    record = add_session(session, profile(session), noon(2))
    add_calibration(session, record, 1.5)
    monkeypatch.setattr(backfill_metrics, "engine", session.get_bind())
    monkeypatch.setattr(backfill_metrics, "create_db_and_tables", lambda: None)

    assert backfill_metrics.main([]) == 0
    output = capsys.readouterr().out
    assert "Sessions computed: 1" in output
    assert backfill_metrics.main(["--session-id", "999"]) == 1
    assert "FAILED session 999" in capsys.readouterr().out
