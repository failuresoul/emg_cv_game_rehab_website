"""Research mode (Day 17): assignment balance, the condition override and blinding, withdrawal,
results on synthetic data, and a pseudonymous export."""

import csv
import io
import itertools
from collections import Counter
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import (
    AdaptationLog,
    GameRun,
    LlmReport,
    PatientProfile,
    ReportRating,
    SessionFeedback,
    Study,
    Trial,
    User,
)
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.services import studies

STUDIES = "/api/admin/studies"


# ---- Assignment balance --------------------------------------------------------------------------


@pytest.mark.parametrize("conditions", [["L0", "L1"], ["L0", "L1", "L2"]])
def test_the_latin_square_is_balanced_for_position_and_carry_over(conditions: list[str]) -> None:
    rows = studies.williams_orders(conditions)
    n = len(conditions)
    assert len(rows) == (n if n % 2 == 0 else 2 * n)
    assert all(sorted(row) == sorted(conditions) for row in rows)
    # Every condition in every position equally often.
    for position in range(n):
        counts = Counter(row[position] for row in rows)
        assert set(counts.values()) == {len(rows) // n}
    # Every condition followed by every other equally often.
    pairs = Counter((a, b) for row in rows for a, b in itertools.pairwise(row))
    assert len(pairs) == n * (n - 1)
    assert len(set(pairs.values())) == 1


def test_participants_take_the_square_rows_in_turn() -> None:
    conditions = ["L0", "L1", "L2"]
    rows = studies.williams_orders(conditions)
    orders = [studies.condition_order(conditions, position) for position in range(12)]
    assert orders[:6] == rows and orders[6:] == rows
    # With every row once, each condition comes first equally often.
    assert Counter(order[0] for order in orders[:6]) == {"L0": 2, "L1": 2, "L2": 2}


@pytest.mark.parametrize("conditions", [["L0", "L1"], ["L0", "L1", "L2"]])
def test_between_subject_randomisation_is_balanced_and_reproducible(conditions: list[str]) -> None:
    assigned = [studies.randomised_condition(conditions, 1234, p) for p in range(30)]
    counts = Counter(assigned)
    assert set(counts.values()) == {30 // len(conditions)}
    # Never more than one apart at any point.
    for end in range(1, 31):
        prefix = Counter(assigned[:end])
        assert max(prefix.values()) - min(prefix.get(c, 0) for c in conditions) <= 1
    assert assigned == [studies.randomised_condition(conditions, 1234, p) for p in range(30)]
    other = [studies.randomised_condition(conditions, 99, p) for p in range(30)]
    assert Counter(other) == counts  # balanced with any seed


# ---- Fixtures -------------------------------------------------------------------------------------


@pytest.fixture
def consenting(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> Callable[[str], tuple[dict[str, Any], Headers]]:
    """A patient with research consent recorded, and their login."""

    def make(email: str) -> tuple[dict[str, Any], Headers]:
        patient = create_patient(email=email)
        response = client.patch(
            f"/api/admin/patients/{patient['id']}",
            json={"research_consent_at": "2026-11-01"},
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["research_consent_at"] == "2026-11-01"
        return response.json(), login(email, PATIENT_PASSWORD)

    return make


def new_study(client: TestClient, headers: Headers, **changes: Any) -> dict[str, Any]:
    payload = {
        "name": "Engines pilot",
        "description": "L0 against L2",
        "design": "within_subject",
        "conditions": ["L0", "L2"],
        "sessions_per_condition": 1,
        "games": ["grip_hold", "bloom"],
        "seed": 7,
        **changes,
    }
    response = client.post(STUDIES, json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def activate(client: TestClient, headers: Headers, study_id: int) -> None:
    response = client.patch(f"{STUDIES}/{study_id}", json={"status": "active"}, headers=headers)
    assert response.status_code == 200, response.text


def enrol(client: TestClient, headers: Headers, study_id: int, patient_id: int) -> Any:
    return client.post(f"{STUDIES}/{study_id}/participants", json={"patient_id": patient_id}, headers=headers)


def play_session(client: TestClient, headers: Headers) -> dict[str, Any]:
    """Starts a session, plays its first planned game briefly, ends it; returns the session."""
    started = client.post("/api/sessions", headers=headers).json()
    sid = started["id"]
    plan = client.get(f"/api/sessions/{sid}/plan", headers=headers).json()
    game = plan["games"][0]["game_id"]
    run = client.post(
        f"/api/sessions/{sid}/games",
        json={"game_id": game, "engine": "L1", "input_source": "keyboard", "params_initial": {}, "trials_planned": 5},
        headers=headers,
    )
    assert run.status_code == 201, run.text
    client.post(f"/api/sessions/{sid}/end", json={"status": "completed"}, headers=headers)
    return {"session": started, "plan": plan, "run": run.json()}


# ---- The API ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "changes",
    [
        {"conditions": ["L0"]},
        {"conditions": ["L0", "L0"]},
        {"conditions": ["L0", "L9"]},
        {"games": []},
        {"games": ["bloom", "bloom"]},
        {"sessions_per_condition": 0},
        {"design": "crossover"},
        {"name": ""},
    ],
)
def test_invalid_studies_are_refused(
    client: TestClient, admin_headers: Headers, changes: dict[str, Any]
) -> None:
    payload = {
        "name": "x", "design": "within_subject", "conditions": ["L0", "L1"],
        "sessions_per_condition": 2, "games": ["bloom"], **changes,
    }
    assert client.post(STUDIES, json=payload, headers=admin_headers).status_code == 422


def test_studies_are_created_listed_edited_and_move_forward_only(
    client: TestClient, admin_headers: Headers
) -> None:
    study = new_study(client, admin_headers)
    assert study["status"] == "draft" and study["participants"] == 0 and study["seed"] == 7
    assert [s["id"] for s in client.get(STUDIES, headers=admin_headers).json()] == [study["id"]]
    url = f"{STUDIES}/{study['id']}"
    edited = client.patch(url, json={"sessions_per_condition": 3, "name": "Renamed"}, headers=admin_headers)
    assert edited.status_code == 200 and edited.json()["sessions_per_condition"] == 3
    activate(client, admin_headers, study["id"])
    # The design is fixed once active; the name is not.
    assert client.patch(url, json={"games": ["bloom"]}, headers=admin_headers).status_code == 409
    assert client.patch(url, json={"name": "Pilot A"}, headers=admin_headers).status_code == 200
    assert client.patch(url, json={"status": "draft"}, headers=admin_headers).status_code == 409
    assert client.delete(url, headers=admin_headers).status_code == 409
    assert client.patch(url, json={"status": "closed"}, headers=admin_headers).status_code == 200
    draft = new_study(client, admin_headers, name="Empty")
    assert client.delete(f"{STUDIES}/{draft['id']}", headers=admin_headers).status_code == 204
    assert client.get(f"{STUDIES}/{draft['id']}", headers=admin_headers).status_code == 404


def test_patients_cannot_reach_research_mode(client: TestClient, patient_headers: Headers) -> None:
    assert client.get(STUDIES, headers=patient_headers).status_code == 403
    assert client.post(STUDIES, json={}, headers=patient_headers).status_code == 403
    assert client.get(f"{STUDIES}/1/results", headers=patient_headers).status_code == 403


def test_only_consenting_patients_are_enrolled_once_and_in_one_study(
    client: TestClient,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    consenting: Callable[[str], tuple[dict[str, Any], Headers]],
) -> None:
    study = new_study(client, admin_headers)
    without = create_patient(email="noconsent@example.com")
    refused = enrol(client, admin_headers, study["id"], without["id"])
    assert refused.status_code == 409 and "no research consent" in refused.json()["detail"]
    patient, _ = consenting("yes@example.com")
    first = enrol(client, admin_headers, study["id"], patient["id"])
    assert first.status_code == 201, first.text
    assert first.json()["condition_order"] == ["L0", "L2"] and first.json()["position"] == 0
    assert enrol(client, admin_headers, study["id"], patient["id"]).status_code == 409
    other = new_study(client, admin_headers, name="Other")
    assert enrol(client, admin_headers, other["id"], patient["id"]).status_code == 409
    assert enrol(client, admin_headers, study["id"], 999).status_code == 404
    # Consent in the future is refused.
    bad = client.patch(
        f"/api/admin/patients/{patient['id']}", json={"research_consent_at": "2999-01-01"}, headers=admin_headers
    )
    assert bad.status_code == 422


# ---- The condition override and blinding --------------------------------------------------------------


def test_each_session_plays_the_next_condition_with_the_studys_games(
    client: TestClient,
    admin_headers: Headers,
    consenting: Callable[[str], tuple[dict[str, Any], Headers]],
    session: Session,
) -> None:
    study = new_study(client, admin_headers)
    patient, headers = consenting("p1@example.com")
    # The programme says L1; the study's conditions win while it is active.
    enrol(client, admin_headers, study["id"], patient["id"])

    # Draft: no override yet.
    draft = play_session(client, headers)
    assert draft["session"]["blinded"] is False and draft["run"]["engine"] == "L1"

    activate(client, admin_headers, study["id"])
    first = play_session(client, headers)
    second = play_session(client, headers)
    after = play_session(client, headers)
    for played, condition in ((first, "L0"), (second, "L2")):
        assert played["session"]["blinded"] is True
        assert played["run"]["engine"] == condition
        assert [g["game_id"] for g in played["plan"]["games"]] == ["grip_hold", "bloom"]
        assert played["plan"]["locked"] is True
        run = session.get(GameRun, played["run"]["id"])
        assert run is not None and (run.study_id, run.condition) == (study["id"], condition)
        detail = client.get(f"/api/admin/sessions/{played['session']['id']}", headers=admin_headers).json()
        assert (detail["study_id"], detail["study_condition"]) == (study["id"], condition)
    # Every condition done: back to the programme.
    assert after["session"]["blinded"] is False and after["run"]["engine"] == "L1"
    progress = client.get(f"{STUDIES}/{study['id']}/progress", headers=admin_headers).json()
    row = progress["participants"][0]
    assert row["sessions_done"] == {"L0": 1, "L2": 1}
    assert row["complete"] is True and row["next_condition"] is None


def test_patients_are_never_told_the_condition(
    client: TestClient,
    admin_headers: Headers,
    consenting: Callable[[str], tuple[dict[str, Any], Headers]],
) -> None:
    study = new_study(client, admin_headers, design="between_subject", conditions=["L0", "L2"], seed=3)
    patients = [consenting(f"b{i}@example.com") for i in range(2)]
    assigned = []
    for patient, _ in patients:
        assigned.append(enrol(client, admin_headers, study["id"], patient["id"]).json()["assigned_condition"])
    assert sorted(assigned) == ["L0", "L2"]  # one of each in the first block
    activate(client, admin_headers, study["id"])

    seen = []
    for _, headers in patients:
        started = client.post("/api/sessions", headers=headers)
        sid = started.json()["id"]
        plan = client.get(f"/api/sessions/{sid}/plan", headers=headers).json()
        current = client.get("/api/sessions/current", headers=headers)
        me = client.get("/api/auth/me", headers=headers).json()
        # Nothing the patient receives names the condition.
        for response_text in (started.text, current.text):
            assert "study_condition" not in response_text and "study_id" not in response_text
        assert me["patient_profile"]["engine_mode"] == "L1"  # the programme's, not the condition
        plan.pop("created_at")
        seen.append(plan)
    # The same plan, reasons and notes in both conditions.
    assert seen[0] == seen[1]


def test_withdrawn_participants_go_back_to_their_programme(
    client: TestClient,
    admin_headers: Headers,
    consenting: Callable[[str], tuple[dict[str, Any], Headers]],
) -> None:
    study = new_study(client, admin_headers, sessions_per_condition=2)
    patient, headers = consenting("w@example.com")
    participant = enrol(client, admin_headers, study["id"], patient["id"]).json()
    activate(client, admin_headers, study["id"])
    first = play_session(client, headers)
    assert first["run"]["engine"] == "L0"
    url = f"{STUDIES}/{study['id']}/participants/{participant['id']}/withdraw"
    withdrawn = client.post(url, headers=admin_headers)
    assert withdrawn.status_code == 200 and withdrawn.json()["withdrawn_at"] is not None
    later = play_session(client, headers)
    assert later["session"]["blinded"] is False and later["run"]["engine"] == "L1"
    row = client.get(f"{STUDIES}/{study['id']}/progress", headers=admin_headers).json()["participants"][0]
    assert row["withdrawn_at"] is not None and row["next_condition"] is None
    assert row["sessions_done"] == {"L0": 1, "L2": 0}
    # Their data stays in the results.
    results = client.get(f"{STUDIES}/{study['id']}/results", headers=admin_headers).json()
    assert results["conditions"][0]["sessions"] == 1
    # Withdrawn from this study, they may join another.
    other = new_study(client, admin_headers, name="Next")
    assert enrol(client, admin_headers, other["id"], patient["id"]).status_code == 201


# ---- Results on synthetic data -----------------------------------------------------------------------


def _patient(session: Session, code: str) -> PatientProfile:
    user = User(email=f"{code}@example.com", full_name=f"Name {code}", role="patient", hashed_password="x")
    session.add(user)
    session.flush()
    assert user.id is not None
    profile = PatientProfile(
        user_id=user.id, patient_code=code, affected_side="left", dominant_side="right", age_band="60-69"
    )
    session.add(profile)
    session.flush()
    return profile


def _study_session(
    session: Session,
    study: Study,
    profile: PatientProfile,
    condition: str,
    outcomes: list[str],
    level: int,
    enjoyment: int,
    fatigue: int,
    rating: int | None,
    compensated_every: int = 0,
) -> None:
    assert profile.id is not None
    record = SessionRecord(
        patient_id=profile.id, status="completed", study_id=study.id, study_condition=condition,
        started_at=utc_now() - timedelta(days=1), ended_at=utc_now(),
    )
    session.add(record)
    session.flush()
    assert record.id is not None
    run = GameRun(
        session_id=record.id, game_id="reach_activate", engine=condition, input_source="keyboard",
        trials_planned=len(outcomes), study_id=study.id, condition=condition, status="completed",
    )
    session.add(run)
    session.flush()
    assert run.id is not None
    d = round(level / 10 - 0.05, 3)
    for n, outcome in enumerate(outcomes, start=1):
        flagged = compensated_every > 0 and n % compensated_every == 0
        session.add(
            Trial(
                game_run_id=run.id, trial_no=n, params={}, outcome=outcome, timings={"spawn": 0},
                metrics={}, compensation={"flagged": flagged, "type": None, "max_values": {}}, trajectory=[],
            )
        )
        session.add(
            AdaptationLog(
                game_run_id=run.id, trial_no=n, engine=condition, state_before={"d": {"spatial": d}},
                state_after={"d": {"spatial": d}}, params={}, decision="",
            )
        )
    session.add(
        SessionFeedback(
            session_id=record.id, pain_0_10=0, fatigue_0_10=fatigue, enjoyment_1_5=enjoyment,
            difficulty="just_right", new_symptoms=False,
        )
    )
    if rating is not None:
        report = LlmReport(session_id=record.id, language="en", status="done")
        session.add(report)
        session.flush()
        assert report.id is not None
        session.add(
            ReportRating(report_id=report.id, rater="participant", rater_user_id=profile.user_id,
                         scores={"helpful": rating})
        )
    session.commit()


def test_results_per_condition_on_synthetic_data(session: Session) -> None:
    study = Study(name="s", design="within_subject", conditions=["L0", "L1"], sessions_per_condition=1,
                  games=["reach_activate"], status="active")
    session.add(study)
    session.commit()
    a, b = _patient(session, "P101"), _patient(session, "P102")
    always = ["success"] * 20
    seventy = (["success"] * 7 + ["miss"] * 3) * 2  # every rolling window of 10 is exactly 0.7
    half = ["success", "miss"] * 10
    _study_session(session, study, a, "L0", always, level=3, enjoyment=4, fatigue=2, rating=5)
    _study_session(session, study, b, "L0", half, level=5, enjoyment=2, fatigue=6, rating=3)
    _study_session(session, study, a, "L1", seventy, level=6, enjoyment=5, fatigue=3, rating=4,
                   compensated_every=4)
    _study_session(session, study, b, "L1", seventy, level=6, enjoyment=5, fatigue=3, rating=None)
    results = studies.results(session, study)
    l0, l1 = results.conditions
    assert (l0.condition, l0.participants, l0.sessions, l0.trials) == ("L0", 2, 2, 40)

    # Success: 1.0 and 0.5 -> mean 0.75, 95% t interval with 1 degree of freedom.
    assert l0.success_rate.mean == pytest.approx(0.75)
    half_width = 12.7062 * (0.5 ** 0.5 / 2) / 2 ** 0.5  # t(0.975, 1) x sd / sqrt(n)
    assert l0.success_rate.ci_low == pytest.approx(0.75 - half_width, abs=1e-3)
    assert l0.success_rate.ci_high == pytest.approx(0.75 + half_width, abs=1e-3)
    # Challenge error |rolling - 0.7|: always 1.0 -> 0.3; alternating -> 0.5 -> 0.2.
    assert l0.challenge_error.mean == pytest.approx(0.25)
    assert l0.time_in_zone.mean == pytest.approx(0.0)
    assert l1.challenge_error.mean == pytest.approx(0.0)
    assert l1.time_in_zone.mean == pytest.approx(1.0)
    assert l1.time_in_zone.ci_low == pytest.approx(1.0) and l1.time_in_zone.n == 2
    # Compensation: one participant 5 of 20, the other none.
    assert l1.compensation_rate.mean == pytest.approx(0.125)
    assert l0.mean_level.mean == pytest.approx(4.0)
    assert l0.enjoyment.mean == pytest.approx(3.0) and l0.fatigue.mean == pytest.approx(4.0)
    assert l0.report_rating.mean == pytest.approx(4.0) and l0.report_rating.n == 2
    # Only one rating in L1: a mean without an interval.
    assert l1.report_rating.n == 1 and l1.report_rating.ci_low is None


def test_results_are_empty_without_data(session: Session) -> None:
    study = Study(name="s", design="between_subject", conditions=["L0", "L2"], sessions_per_condition=2,
                  games=["bloom"], status="active")
    session.add(study)
    session.commit()
    results = studies.results(session, study)
    assert [c.trials for c in results.conditions] == [0, 0]
    assert results.conditions[0].success_rate.mean is None


def test_the_export_has_codes_and_no_names_or_emails(
    client: TestClient, admin_headers: Headers, session: Session
) -> None:
    study = Study(name="s", design="within_subject", conditions=["L0", "L1"], sessions_per_condition=1,
                  games=["reach_activate"], status="active")
    session.add(study)
    session.commit()
    a = _patient(session, "P201")
    _study_session(session, study, a, "L0", ["success", "miss"], level=4, enjoyment=4, fatigue=2, rating=None)
    response = client.get(f"{STUDIES}/{study.id}/export.csv", headers=admin_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    text = response.text
    assert "Name P201" not in text and "@" not in text
    rows = list(csv.DictReader(io.StringIO(text)))
    assert [row["patient_code"] for row in rows] == ["P201", "P201"]
    assert [row["outcome"] for row in rows] == ["success", "miss"]
    assert {row["condition"] for row in rows} == {"L0"}
    assert rows[0]["level_after"] == "4" and rows[0]["enjoyment_1_5"] == "4"
    assert "email" not in rows[0] and "full_name" not in rows[0]
    users = session.exec(select(User)).all()
    assert all(user.email not in text for user in users)
