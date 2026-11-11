from typing import Any

import numpy as np
import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from metrics_helpers import reach, two_sub_movements
from sqlmodel import Session, select
from test_games import end_run, start_run, start_session, trial_payload, upload

from app.models import Trial
from app.services import trial_metrics
from app.services.trial_metrics import (
    ENGINE_VERSION,
    compute,
    copied_metrics,
    data_quality,
    mismatches,
    spatial_metrics,
)

REACH_TIMINGS = {"spawn": 0, "enter": 1300, "end": 2000}


def trajectory(points: Any) -> list[list[float]]:
    return [[round(t, 1), round(x, 4), round(y, 4)] for t, x, y in np.asarray(points)]


# Data quality


def test_data_quality_counts_points_rate_and_gaps() -> None:
    times = [0, 33, 66, 100, 400, 433, 466, 1000, 1033]  # Gaps of 300 and 534 ms.
    quality = data_quality([[t, 0.1, 0.2] for t in times])
    assert quality["n_points"] == 9
    assert quality["sampling_hz"] == pytest.approx(8 / 1.033, abs=0.01)
    assert quality["gaps_over_200ms"] == 2
    assert quality["max_gap_ms"] == 534


def test_data_quality_of_a_regular_30_hz_trajectory() -> None:
    quality = data_quality(trajectory(reach()))
    assert quality["sampling_hz"] == pytest.approx(30, abs=0.1)
    assert quality["gaps_over_200ms"] == 0


def test_data_quality_without_points() -> None:
    assert data_quality([]) == {
        "n_points": 0,
        "sampling_hz": None,
        "gaps_over_200ms": 0,
        "max_gap_ms": None,
    }
    assert data_quality([[0, 0.1, 0.1]])["n_points"] == 1


# Spatial games: recomputed from the trajectory


def test_reach_measures_recomputed_from_a_synthetic_trajectory() -> None:
    # A smooth 1 SW reach starting 300 ms after spawn, entering the target at 1300 ms.
    server = spatial_metrics("reach_activate", trajectory(reach()), REACH_TIMINGS, {})
    assert 330 <= server["reaction_ms"] <= 420
    assert server["movement_ms"] == pytest.approx(1300 - server["reaction_ms"], abs=1)
    assert server["path_efficiency"] == pytest.approx(1.0, abs=0.01)
    assert server["path_length_sw"] == pytest.approx(1.0, abs=0.05)
    assert server["speed_peaks"] == 1
    assert server["sparc"] == pytest.approx(-1.4, abs=0.15)
    assert server["peak_speed_sw_s"] == pytest.approx(1.875, rel=0.1)


def test_two_sub_movements_show_two_peaks_and_worse_smoothness() -> None:
    timings = {"spawn": 0, "enter": 1500, "end": 1800}
    smooth = spatial_metrics("reach_activate", trajectory(reach()), REACH_TIMINGS, {})
    two = spatial_metrics("balloon_pop", trajectory(two_sub_movements()), timings, {})
    assert two["speed_peaks"] == 2
    assert two["sparc"] < smooth["sparc"]


def test_no_movement_gives_empty_measures() -> None:
    still = [[t, 0.2, -0.5] for t in range(0, 1500, 33)]
    server = spatial_metrics("reach_activate", still, REACH_TIMINGS, {})
    assert all(value is None for value in server.values())
    assert spatial_metrics("reach_activate", [], REACH_TIMINGS, {})["sparc"] is None


def test_fruit_catch_is_measured_sideways_only() -> None:
    # Up and down wobble does not count: the basket moves along x.
    points = np.asarray(reach())
    points[:, 2] += 0.15 * np.sin(points[:, 0] / 60)
    server = spatial_metrics("fruit_catch", trajectory(points), REACH_TIMINGS, {})
    assert server["path_efficiency"] == pytest.approx(1.0, abs=0.01)
    assert server["path_length_sw"] == pytest.approx(0.6, abs=0.03)


def test_path_trace_measures_the_trace_only() -> None:
    timings = {"spawn": 0, "dwell_done": 300, "end": 1300}
    server = spatial_metrics("path_trace", trajectory(reach()), timings, {})
    assert set(server) == {"sparc", "peak_speed_sw_s", "speed_peaks"}
    assert server["speed_peaks"] == 1
    assert spatial_metrics("path_trace", trajectory(reach()), {"end": 900}, {})["sparc"] is None


def test_pick_place_measures_the_reach_and_the_carry() -> None:
    # Reach to the object (300-1300 ms), hold it, then carry it (1600-2600 ms) to the box.
    times = np.arange(0, 2800, 1000 / 30)
    first = np.clip((times - 300) / 1000, 0, 1)
    second = np.clip((times - 1600) / 1000, 0, 1)
    ease = lambda share: 10 * share**3 - 15 * share**4 + 6 * share**5  # noqa: E731
    x = 0.1 + 0.5 * ease(first) + 0.6 * ease(second)
    y = -0.5 + 0.8 * ease(first)
    points = trajectory(np.column_stack([times, x, y]))
    timings = {"spawn": 0, "enter": 1300, "dwell_done": 1500, "end": 2600}
    server = spatial_metrics("pick_place", points, timings, {"transport_ms": 1000})
    assert 330 <= server["reaction_ms"] <= 420
    assert server["transport_path_efficiency"] == pytest.approx(1.0, abs=0.01)
    assert server["speed_peaks"] == 1
    assert server["sparc"] is not None and server["sparc"] < 0
    # A miss has no carry.
    missed = spatial_metrics("pick_place", points, timings, {"transport_ms": None})
    assert missed["sparc"] is None and missed["reaction_ms"] is not None


def test_spatial_metrics_refuses_other_games() -> None:
    with pytest.raises(ValueError):
        spatial_metrics("bloom", [], {}, {})


# Mismatches


def test_mismatch_when_more_than_10_percent_apart() -> None:
    server = {"path_efficiency": 0.99, "reaction_ms": 380.0, "sparc": -1.5, "speed_peaks": 1}
    client = {"path_efficiency": 0.7, "reaction_ms": 360, "sparc": None, "movement_ms": 900}
    assert mismatches(server, client) == {"path_efficiency": {"client": 0.7, "server": 0.99}}
    # Exactly 10% apart is not a mismatch; a client value of 0 needs an exact match.
    assert mismatches({"reaction_ms": 110.0}, {"reaction_ms": 100}) == {}
    assert mismatches({"drops": 1}, {"drops": 0}) == {"drops": {"client": 0, "server": 1}}
    assert mismatches({"reaction_ms": True}, {"reaction_ms": 1}) == {}


# Other games: checked copies


def test_non_spatial_games_copy_the_client_values() -> None:
    metrics = {"peak_openness": 0.82, "hold_stability": 0.03, "time_to_open_ms": 1400, "x": None}
    copied, valid = copied_metrics({k: v for k, v in metrics.items() if k != "x"})
    assert valid is True
    assert copied == {"peak_openness": 0.82, "hold_stability": 0.03, "time_to_open_ms": 1400}
    # Values the schema would refuse are not copied.
    assert copied_metrics({"peak_openness": 1.7}) == ({}, False)


def test_compute_keeps_both_values_and_the_source() -> None:
    spatial = Trial(
        game_run_id=1,
        trial_no=1,
        outcome="success",
        timings=REACH_TIMINGS,
        metrics={"path_efficiency": 0.5, "reaction_ms": 380},
        trajectory=trajectory(reach()),
    )
    server, quality = compute("reach_activate", spatial)
    assert quality["source"] == "trajectory"
    assert quality["engine_version"] == ENGINE_VERSION
    assert quality["mismatches"]["path_efficiency"]["client"] == 0.5
    assert quality["mismatches"]["path_efficiency"]["server"] == server["path_efficiency"]
    assert "reaction_ms" not in quality["mismatches"]

    grip = Trial(
        game_run_id=1,
        trial_no=2,
        outcome="success",
        metrics={"steadiness": 0.04, "relaxation_ms": 700, "input_source": "cv_grip"},
    )
    server, quality = compute("grip_hold", grip)
    assert server == {"steadiness": 0.04, "relaxation_ms": 700, "input_source": "cv_grip"}
    assert quality["source"] == "client"
    assert quality["client_metrics_valid"] is True
    assert quality["mismatches"] == {}
    assert quality["n_points"] == 0


# Through the API


def reach_trial(trial_no: int, **metrics: Any) -> dict[str, Any]:
    base = trial_payload(trial_no)
    return {
        **base,
        "timings": {**base["timings"], **REACH_TIMINGS},
        # Only the client figures each test sets, so the others cannot disagree.
        "metrics": metrics,
        "trajectory": trajectory(reach()),
    }


def detail_trials(client: TestClient, headers: Headers, session_id: int) -> list[dict[str, Any]]:
    body = client.get(f"/api/admin/sessions/{session_id}", headers=headers).json()
    return [trial for game in body["games"] for trial in game["trials"]]


def test_ending_a_run_recomputes_its_trials(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    trials = [reach_trial(1, path_efficiency=0.98), reach_trial(2, path_efficiency=0.6)]
    assert upload(client, patient_headers, run_id, trials).status_code == 200
    # Nothing is computed while the run is still being played.
    played = detail_trials(client, admin_headers, session_id)
    assert all(trial["metrics_server"] is None for trial in played)

    assert end_run(client, patient_headers, run_id).status_code == 200

    first, second = detail_trials(client, admin_headers, session_id)
    assert first["metrics_server"]["speed_peaks"] == 1
    assert first["data_quality"]["n_points"] == len(trajectory(reach()))
    assert first["data_quality"]["mismatches"].get("path_efficiency") is None
    assert second["data_quality"]["mismatches"]["path_efficiency"]["client"] == 0.6
    # The client's own figures are kept as they were.
    assert second["metrics"]["path_efficiency"] == 0.6


def test_a_failed_recomputation_never_fails_ending_the_run(
    client: TestClient, patient_headers: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(trial_metrics, "compute", broken)
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    assert upload(client, patient_headers, run_id, [reach_trial(1)]).status_code == 200
    response = end_run(client, patient_headers, run_id)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"


def test_admin_recomputes_one_session_or_all(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    session_id = start_session(client, patient_headers)
    run_id = start_run(client, patient_headers, session_id)
    trials = [reach_trial(1), reach_trial(2, path_efficiency=0.5)]
    assert upload(client, patient_headers, run_id, trials).status_code == 200
    bloom_run = start_run(client, patient_headers, session_id, game_id="bloom")
    bloom = trial_payload(
        1, target={"kind": "bloom"}, metrics={"peak_openness": 0.8}, trajectory=[]
    )
    assert upload(client, patient_headers, bloom_run, [bloom]).status_code == 200

    url = f"/api/admin/metrics/recompute?session_id={session_id}"
    response = client.post(url, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"sessions": 1, "runs": 2, "trials": 3, "mismatched_trials": 1}
    first = [trial.model_dump() for trial in session.exec(select(Trial)).all()]

    # Idempotent: the same results again.
    assert client.post(url, headers=admin_headers).json()["trials"] == 3
    session.expire_all()
    again = [trial.model_dump() for trial in session.exec(select(Trial)).all()]
    assert [t["metrics_server"] for t in again] == [t["metrics_server"] for t in first]
    assert [t["data_quality"] for t in again] == [t["data_quality"] for t in first]

    every = client.post("/api/admin/metrics/recompute", headers=admin_headers)
    assert every.json()["trials"] == 3
    copied = next(t for t in again if t["metrics_server"].get("peak_openness") is not None)
    assert copied["data_quality"]["source"] == "client"


def test_recompute_needs_an_admin_and_a_real_session(
    client: TestClient, patient_headers: Headers, admin_headers: Headers
) -> None:
    assert client.post("/api/admin/metrics/recompute").status_code == 401
    assert client.post("/api/admin/metrics/recompute", headers=patient_headers).status_code == 403
    missing = client.post("/api/admin/metrics/recompute?session_id=999", headers=admin_headers)
    assert missing.status_code == 404
    empty = client.post("/api/admin/metrics/recompute", headers=admin_headers)
    assert empty.json() == {"sessions": 0, "runs": 0, "trials": 0, "mismatched_trials": 0}
