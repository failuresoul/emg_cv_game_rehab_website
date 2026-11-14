"""Day 17 review: every route, from the app's own route list, refuses the wrong person.

- Every /api/admin/* route answers 403 to a patient (and 401 without login).
- Every patient route with a session, run or report id answers 404 for another patient's.
"""

import re
from collections.abc import Callable
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient

from app.main import app


def routes(prefix: str) -> list[tuple[str, str]]:
    """Every (method, path) under prefix, from the OpenAPI schema (it lists the routes of every
    included router)."""
    found = []
    for path, operations in app.openapi()["paths"].items():
        if path.startswith(prefix):
            for method in operations:
                if method in {"get", "post", "put", "patch", "delete"}:
                    found.append((method.upper(), path))
    return sorted(found)


ADMIN_ROUTES = routes("/api/admin")


def test_the_sweep_sees_every_admin_area() -> None:
    paths = {path for _, path in ADMIN_ROUTES}
    for expected in (
        "/api/admin/patients/{patient_id}/programme",
        "/api/admin/studies",
        "/api/admin/studies/{study_id}/export.csv",
        "/api/admin/alerts",
        "/api/admin/alerts/{alert_id}/resolve",
        "/api/admin/stats",
    ):
        assert expected in paths
    assert len(ADMIN_ROUTES) >= 52  # every admin route on Day 17


def _fill(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
def test_patients_never_reach_admin_routes(
    client: TestClient, patient_headers: Headers, method: str, path: str
) -> None:
    url = _fill(path)
    response = client.request(method, url, headers=patient_headers, json={})
    assert response.status_code == 403, (method, path, response.status_code)
    assert client.request(method, url, json={}).status_code == 401


#: Patient routes whose path names another person's data.
OWNED = [
    (method, path)
    for method, path in routes("/api")
    if method == "GET"
    and not path.startswith("/api/admin")
    and re.search(r"\{(session_id|run_id|job_id|report_id|id)\}", path)
]


@pytest.fixture
def two_patients(
    client: TestClient,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> tuple[Headers, dict[str, int]]:
    """Patient A's login, and ids of patient B's session and game run."""
    create_patient(email="a@example.com")
    create_patient(email="b@example.com")
    a = login("a@example.com", PATIENT_PASSWORD)
    b = login("b@example.com", PATIENT_PASSWORD)
    session_id = client.post("/api/sessions", headers=b).json()["id"]
    run = client.post(
        f"/api/sessions/{session_id}/games",
        json={"game_id": "reach_activate", "engine": "L1", "input_source": "keyboard",
              "params_initial": {}, "trials_planned": 5},
        headers=b,
    ).json()
    return a, {"session_id": session_id, "run_id": run["id"], "job_id": 1, "report_id": 1, "id": session_id}


def test_the_sweep_sees_the_patient_routes() -> None:
    paths = {path for _, path in OWNED}
    assert "/api/sessions/{session_id}/plan" in paths
    assert "/api/sessions/{session_id}/facts" in paths
    assert len(OWNED) >= 9  # every patient route with an id on Day 17


@pytest.mark.parametrize(("method", "path"), OWNED)
def test_a_patient_never_reads_another_patients_data(
    client: TestClient, two_patients: tuple[Headers, dict[str, int]], method: str, path: str
) -> None:
    headers, ids = two_patients
    url = re.sub(r"\{([^}]+)\}", lambda m: str(ids.get(m.group(1), 1)), path)
    response = client.request(method, url, headers=headers)
    assert response.status_code in (403, 404), (path, response.status_code, response.text[:120])
