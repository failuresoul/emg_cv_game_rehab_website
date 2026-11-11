import csv
import io
import json
from collections.abc import Callable
from typing import Any

from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session
from test_games import end_run, start_run, start_session, upload
from test_progress import add_calibration, add_session, noon, profile
from test_session_facts import add_metric
from test_trial_metrics import reach_trial

from app.services.exports import METRIC_COLUMNS, TRIAL_COLUMNS, _cell


def rows_of(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def assert_pseudonymous(text: str) -> None:
    for secret in ("Alice", "Rahman", "Bob", "@", "example.com"):
        assert secret not in text


# One patient's session metrics


def test_patient_metrics_csv(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    patient = profile(session)
    first = add_session(session, patient, noon(3))
    second = add_session(session, patient, noon(1))
    add_metric(session, first, "K6", 1100, "reach_activate")
    add_metric(session, first, "K1", 1.4, unit="sw2")
    add_metric(session, second, "K1", 1.6, unit="sw2")

    response = client.get(f"/api/admin/patients/{patient.id}/export.csv", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert 'filename="P001-metrics.csv"' in response.headers["content-disposition"]
    assert response.text.splitlines()[0] == ",".join(METRIC_COLUMNS)
    rows = rows_of(response.text)
    # Oldest session first, then by metric id.
    assert [(row["session_id"], row["metric_id"]) for row in rows] == [
        (str(first.id), "K1"),
        (str(first.id), "K6"),
        (str(second.id), "K1"),
    ]
    movement = rows[1]
    assert movement["patient_code"] == "P001"
    assert movement["metric_name"] == "Movement time"
    assert movement["game_id"] == "reach_activate"
    assert float(movement["value"]) == 1100 and movement["unit"] == "ms"
    assert rows[0]["game_id"] == ""
    assert_pseudonymous(response.text)


def test_patient_metrics_csv_access(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    patient_id = profile(session).id
    url = f"/api/admin/patients/{patient_id}/export.csv"
    assert client.get(url, headers=patient_headers).status_code == 403
    assert client.get(url).status_code == 401
    missing = client.get("/api/admin/patients/999/export.csv", headers=admin_headers)
    assert missing.status_code == 404
    empty = client.get(url, headers=admin_headers)
    assert empty.status_code == 200
    assert rows_of(empty.text) == []


# Every trial


def test_trials_csv(
    client: TestClient,
    admin_headers: Headers,
    patient_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    for headers in (patient_headers, None):
        if headers is None:
            create_patient(email="bob@example.com", full_name="Bob Rahman")
            headers = login("bob@example.com", PATIENT_PASSWORD)
        session_id = start_session(client, headers)
        run_id = start_run(client, headers, session_id)
        trials = [reach_trial(1, path_efficiency=0.5), reach_trial(2)]
        assert upload(client, headers, run_id, trials).status_code == 200
        assert end_run(client, headers, run_id).status_code == 200

    response = client.get("/api/admin/export/trials.csv", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert 'filename="muvi-rehab-trials.csv"' in response.headers["content-disposition"]
    header = response.text.splitlines()[0].split(",")
    assert header[: len(TRIAL_COLUMNS)] == list(TRIAL_COLUMNS)
    measures = header[len(TRIAL_COLUMNS) :]
    assert "server_sparc" in measures and "server_speed_peaks" in measures
    assert measures == sorted(measures)

    rows = rows_of(response.text)
    assert len(rows) == 4
    assert [row["patient_code"] for row in rows] == ["P001", "P001", "P002", "P002"]
    first = rows[0]
    assert first["game_id"] == "reach_activate" and first["trial_no"] == "1"
    assert first["outcome"] == "success"
    # The test trial has compensation flagged.
    assert first["is_demo"] == "false" and first["compensated"] == "true"
    assert json.loads(first["params"])["dwell_ms"] == 500
    assert json.loads(first["timings"])["enter"] == 1300
    assert first["mismatches"] == "path_efficiency"
    assert rows[1]["mismatches"] == ""
    assert int(first["n_points"]) > 30
    assert first["server_speed_peaks"] == "1"
    assert_pseudonymous(response.text)


def test_trials_csv_access_and_empty(
    client: TestClient, admin_headers: Headers, patient_headers: Headers
) -> None:
    assert client.get("/api/admin/export/trials.csv", headers=patient_headers).status_code == 403
    assert client.get("/api/admin/export/trials.csv").status_code == 401
    empty = client.get("/api/admin/export/trials.csv", headers=admin_headers)
    assert empty.text == ",".join(TRIAL_COLUMNS) + "\n"


def test_cells() -> None:
    assert _cell(None) == ""
    assert _cell(True) == "true"
    assert _cell(float("nan")) == ""
    assert _cell(1.5) == 1.5
    assert _cell({"b": 1, "a": [1, 2]}) == '{"a":[1,2],"b":1}'


# The admin session page's metrics


def test_admin_session_detail_lists_the_session_metrics(
    client: TestClient, admin_headers: Headers, patient_headers: Headers, session: Session
) -> None:
    record = add_session(session, profile(session), noon(1))
    add_calibration(session, record, 1.5)
    assert client.post(
        f"/api/admin/metrics/recompute?session_id={record.id}", headers=admin_headers
    ).json()["session_metrics"] == 1
    detail = client.get(f"/api/admin/sessions/{record.id}", headers=admin_headers).json()
    [row] = detail["session_metrics"]
    assert row["metric_id"] == "K1" and row["value"] == 1.5 and row["unit"] == "sw2"
    assert row["game_id"] is None and row["n"] == 1
