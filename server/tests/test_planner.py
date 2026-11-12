"""The session planner (app/services/planner.py) and its routes."""

from collections.abc import Callable
from itertools import pairwise
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select
from test_progress import add_run, add_session, noon, profile

from app.models import GameSetting, PatientProfile, SessionFeedback, Trial
from app.models import Session as SessionRecord
from app.schemas.metrics import MetricChange, PatientMetrics
from app.schemas.plan import SessionPlan
from app.services import planner
from app.services.planner import HAND, REACH_SHOULDER, SHOULDER_HEAVY


def change(metric_id: str, status: str) -> MetricChange:
    return MetricChange(
        metric_id=metric_id,
        game_id=None,
        name=metric_id,
        unit="",
        better_when="higher",
        baseline=1.0,
        latest=1.0,
        change=0.0,
        change_mdc=0.0,
        status=status,  # type: ignore[arg-type]
        mdc=None,
        provisional=True,
        n_sessions=4,
    )


@pytest.fixture
def statuses(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Each measure's change status, as patient_metrics would give it; improved unless set."""
    chosen: dict[str, str] = {}
    every = ("K1", "K6", "K7", "K8", "R1", "R2", "R3", "H1", "H2", "H3", "H4", "H6")

    def fake(session: Session, patient_id: int) -> PatientMetrics:
        return PatientMetrics(
            metrics=[change(m, chosen.get(m, "improved")) for m in every],
            series=[],
            mdc_provisional=True,
        )

    monkeypatch.setattr(planner, "patient_metrics", fake)
    return chosen


def plan_for(session: Session, days_ago: int = 0) -> SessionPlan:
    patient = profile(session)
    record = add_session(session, patient, noon(days_ago, hour=18), status="active")
    return planner.plan_session(session, patient, record)


def ids(plan: SessionPlan) -> list[str]:
    return [game.game_id for game in plan.games]


def feedback(session: Session, record: SessionRecord, **changes: Any) -> None:
    assert record.id is not None
    values = {
        "pain_0_10": 1,
        "fatigue_0_10": 3,
        "enjoyment_1_5": 4,
        "difficulty": "just_right",
        "new_symptoms": False,
        **changes,
    }
    session.add(SessionFeedback(session_id=record.id, **values))
    session.commit()


def assert_rules(plan: SessionPlan, enabled: set[str] | None = None) -> None:
    """The planner's rules; a group is required only while one of its games is enabled."""
    games = ids(plan)
    enabled = enabled if enabled is not None else set(planner.MOVEMENT)
    assert len(games) == len(set(games))
    if enabled & REACH_SHOULDER:
        assert any(game in REACH_SHOULDER for game in games)
    if enabled & HAND:
        assert any(game in HAND for game in games)
    assert not any(a in SHOULDER_HEAVY and b in SHOULDER_HEAVY for a, b in pairwise(games))
    assert all(game.reason_key for game in plan.games)
    assert plan.total_minutes == pytest.approx(sum(game.minutes for game in plan.games), abs=0.11)


# Who gets what


def test_a_hand_weak_patient_gets_hand_games(session: Session, statuses: dict[str, str], patient_headers: Headers) -> None:
    statuses.update({"H1": "worse", "H6": "worse", "H2": "no_detectable_change"})
    plan = plan_for(session)
    games = ids(plan)
    assert "bloom" in games and "finger_piano" in games
    bloom = next(g for g in plan.games if g.game_id == "bloom")
    assert bloom.reason_key == "focus_hand_opening"
    assert "hand_opening" in plan.focus.movements
    assert_rules(plan)


def test_a_reach_weak_patient_practises_the_weak_direction(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    statuses.update({"K1": "worse", "K6": "no_detectable_change"})
    patient = profile(session)
    # Recent reach trials: 90 degrees (up) mostly fails, every other direction succeeds.
    for days in (5, 3):
        record = add_session(session, patient, noon(days))
        outcomes = ["success"] * 21 + ["reach_fail"] * 6 + ["success"] * 3
        run = add_run(session, record, outcomes)
        trials = session.exec(
            select(Trial).where(Trial.game_run_id == run.id).order_by(col(Trial.trial_no))
        ).all()
        for trial in trials:
            failed = trial.outcome == "reach_fail"
            degrees = 90 if failed or trial.trial_no in (28, 29, 30) else [0, 45, 135, 180, 225, 270, 315][trial.trial_no % 7]
            trial.target = {"direction_deg": degrees, "distance_frac": 0.7}
            session.add(trial)
        session.commit()
    plan = plan_for(session)
    assert plan.focus.directions == [90.0]
    reach = next(g for g in plan.games if g.game_id == "reach_activate")
    assert reach.reason_key == "practise_weak_direction"
    assert reach.reason_params == {"direction_deg": 90.0}
    assert "reach" in plan.focus.movements
    assert_rules(plan)


def test_l2_beliefs_name_the_weak_direction(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    from app.models import EngineState

    patient = profile(session)
    assert patient.id is not None
    sectors = {f"D{i}R{r}": [8.0, 2.0] for i in range(8) for r in (1, 2, 3)}
    sectors.update({"D6R1": [2.0, 8.0], "D6R2": [1.0, 9.0], "D6R3": [1.0, 9.0]})
    seen = {name: 4 for name in sectors}
    session.add(
        EngineState(
            patient_id=patient.id,
            game_id="reach_activate",
            engine="L2",
            state={"d": {}, "extra": {"sectors": sectors, "seen": seen}},
        )
    )
    session.commit()
    plan = plan_for(session)
    assert plan.focus.directions == [270.0]
    assert any(g.reason_key == "practise_weak_direction" for g in plan.games)


def test_different_histories_give_different_plans(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    statuses.update({"H1": "worse", "H6": "worse"})
    hand_plan = ids(plan_for(session, days_ago=0))
    statuses.clear()
    statuses.update({"R1": "worse", "R2": "worse", "R3": "worse", "K8": "worse"})
    arm_plan = ids(plan_for(session, days_ago=0))
    assert hand_plan != arm_plan
    assert "balloon_pop" in arm_plan and "paint_wall" in arm_plan


# Load


@pytest.mark.parametrize(
    ("changes", "flags", "because"),
    [
        ({"fatigue_0_10": 8}, [], "fatigue"),
        ({"difficulty": "too_hard"}, [], "too_hard"),
        ({"pain_0_10": 6}, ["pain"], "pain"),
    ],
)
def test_a_hard_last_session_gives_a_lighter_plan(
    session: Session,
    statuses: dict[str, str],
    patient_headers: Headers,
    changes: dict[str, Any],
    flags: list[str],
    because: str,
) -> None:
    normal = plan_for(session)
    assert len(normal.games) == 4
    assert 15.5 <= normal.total_minutes <= 18.5
    assert normal.notes == []

    patient = profile(session)
    last = add_session(session, patient, noon(1))
    last.flags = flags
    session.add(last)
    session.commit()
    feedback(session, last, **changes)
    light = plan_for(session)
    assert len(light.games) == 3
    assert 10 <= light.total_minutes <= 14
    assert light.notes[0].key == "lighter_today"
    assert light.notes[0].params == {"because": because}
    assert_rules(light)


# Rules


def test_disabled_games_are_never_planned(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    statuses.update({"H1": "worse", "H6": "worse", "H2": "worse"})
    for game_id in ("bloom", "finger_piano"):
        session.add(GameSetting(game_id=game_id, enabled=False))
    session.commit()
    plan = plan_for(session)
    assert "bloom" not in ids(plan) and "finger_piano" not in ids(plan)
    assert "grip_hold" in ids(plan)  # still one hand game
    assert_rules(plan)


def test_the_rules_hold_for_many_histories(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    import random

    rng = random.Random(7)
    patient = profile(session)
    games = sorted(planner.MOVEMENT)
    every = ("K1", "K6", "K7", "K8", "R1", "R2", "R3", "H1", "H2", "H3", "H4", "H6")
    for days in range(40, 0, -1):
        statuses.clear()
        statuses.update({m: rng.choice(["improved", "worse", "no_detectable_change", "no_baseline"]) for m in every})
        if rng.random() < 0.3:
            disabled = rng.sample(games, 3)
            for row in session.exec(select(GameSetting)).all():
                session.delete(row)
            session.commit()
            for game_id in disabled:
                session.add(GameSetting(game_id=game_id, enabled=False))
            session.commit()
        record = add_session(session, patient, noon(days, hour=9))
        plan = planner.plan_session(session, patient, record)
        enabled = {g for g in games} - {r.game_id for r in session.exec(select(GameSetting)).all() if not r.enabled}
        assert set(ids(plan)) <= enabled
        assert_rules(plan, enabled)
        for game in rng.sample(ids(plan), 2):
            add_run(session, record, ["success"] * rng.randint(3, 10) + ["miss"] * rng.randint(0, 6), game_id=game)
        feedback(session, record, fatigue_0_10=rng.randint(0, 9), enjoyment_1_5=rng.randint(1, 5))


def test_variety_avoids_a_third_session_in_a_row(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    patient = profile(session)
    first = plan_for(session, days_ago=0)
    for days in (4, 2):
        record = add_session(session, patient, noon(days))
        for game in ids(first):
            add_run(session, record, ["success"] * 8 + ["miss"] * 2, game_id=game)
    later = plan_for(session)
    assert len(set(ids(later)) & set(ids(first))) <= 2
    assert any(g.reason_key == "variety" for g in later.games)


def test_the_easiest_game_comes_first(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(2))
    add_run(session, record, ["success"] * 19 + ["miss"], game_id="grip_hold")
    add_run(session, record, ["success"] * 4 + ["miss"] * 16, game_id="reach_activate")
    statuses.update({"H3": "worse", "K1": "worse"})
    plan = plan_for(session)
    assert ids(plan)[0] == "grip_hold"


def test_the_same_inputs_give_the_same_plan(
    session: Session, statuses: dict[str, str], patient_headers: Headers
) -> None:
    patient = profile(session)
    record = add_session(session, patient, noon(0, hour=18), status="active")
    first = planner.plan_session(session, patient, record)
    again = planner.plan_session(session, patient, record)
    assert first.model_dump(exclude={"created_at"}) == again.model_dump(exclude={"created_at"})


# Routes


def test_the_plan_is_computed_once_and_kept(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    response = client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert len(plan["games"]) == 4
    assert {"games", "total_minutes", "focus", "notes"} <= set(plan)
    record = session.get(SessionRecord, session_id)
    assert record is not None and record.plan is not None
    # Asking again, as the patient or an admin, returns the stored plan.
    assert client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json() == plan
    assert client.get(f"/api/sessions/{session_id}/plan", headers=admin_headers).json() == plan


def test_only_the_owner_or_an_admin_reads_the_plan(
    client: TestClient,
    patient_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    create_patient(email="other@example.com")
    other = login("other@example.com", PATIENT_PASSWORD)
    assert client.get(f"/api/sessions/{session_id}/plan", headers=other).status_code == 404
    assert client.get(f"/api/sessions/{session_id}/plan").status_code == 401
    assert client.get("/api/sessions/999/plan", headers=patient_headers).status_code == 404


def test_patient_changes_to_the_plan_are_recorded(
    client: TestClient, session: Session, patient_headers: Headers, admin_headers: Headers
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    planned = [g["game_id"] for g in client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json()["games"]]
    kept = list(reversed(planned[1:]))  # untick the first game, reverse the rest
    url = f"/api/sessions/{session_id}/plan/override"
    response = client.post(url, json={"games": kept}, headers=patient_headers)
    assert response.status_code == 201, response.text
    [entry] = response.json()["overrides"]
    assert entry["planned"] == planned
    assert entry["games"] == kept
    assert entry["removed"] == [planned[0]]
    assert entry["added"] == []
    assert entry["reordered"] is True
    # A second change is added, not replacing the first.
    response = client.post(url, json={"games": planned}, headers=patient_headers)
    assert [e["reordered"] for e in response.json()["overrides"]] == [True, False]
    session.expire_all()
    record = session.get(SessionRecord, session_id)
    assert record is not None and len(record.plan_overrides) == 2
    # Only the patient sends changes, with known games.
    assert client.post(url, json={"games": planned}, headers=admin_headers).status_code == 403
    assert client.post(url, json={"games": ["chess"]}, headers=patient_headers).status_code == 422
    assert client.post(url, json={"games": []}, headers=patient_headers).status_code == 422


def test_changes_after_the_session_ended_are_refused(
    client: TestClient, patient_headers: Headers
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers)
    url = f"/api/sessions/{session_id}/plan/override"
    assert client.post(url, json={"games": ["bloom"]}, headers=patient_headers).status_code == 409


def test_the_facts_carry_the_next_sessions_plan(
    client: TestClient, session: Session, patient_headers: Headers
) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    facts = client.get(f"/api/sessions/{session_id}/facts", headers=patient_headers).json()
    assert facts["next_session"] is None  # still open
    client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient_headers)
    facts = client.get(f"/api/sessions/{session_id}/facts", headers=patient_headers).json()
    nxt = facts["next_session"]
    assert set(nxt) == {"focus_movements", "focus_directions", "planned_games"}
    assert len(nxt["planned_games"]) == 4


def test_demo_patients_get_plans_from_their_real_history(session: Session) -> None:
    from scripts import seed_demo_data as demo

    demo.seed_demo_data(session)
    for patient in session.exec(select(PatientProfile).where(col(PatientProfile.is_demo))).all():
        last = session.exec(
            select(SessionRecord)
            .where(SessionRecord.patient_id == patient.id)
            .order_by(col(SessionRecord.started_at).desc())
        ).first()
        assert last is not None
        plan = planner.plan_next(session, patient, last)
        assert_rules(plan)
        assert plan.games


# The admin's view and controls


def test_an_admin_changes_the_engine_and_runs_follow(
    client: TestClient,
    session: Session,
    admin_headers: Headers,
    create_patient: Callable[..., dict[str, Any]],
    login: Callable[[str, str], Headers],
) -> None:
    patient = create_patient(email="engine@example.com")
    url = f"/api/admin/patients/{patient['id']}"
    assert client.get(url, headers=admin_headers).json()["engine_mode"] == "L1"
    response = client.patch(url, json={"engine_mode": "L2"}, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["engine_mode"] == "L2"
    assert client.patch(url, json={"engine_mode": "L9"}, headers=admin_headers).status_code == 422
    headers = login("engine@example.com", PATIENT_PASSWORD)
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["patient_profile"]["engine_mode"] == "L2"
    session_id = client.post("/api/sessions", headers=headers).json()["id"]
    run = client.post(
        f"/api/sessions/{session_id}/games",
        json={"game_id": "reach_activate", "engine": "L0", "input_source": "keyboard", "params_initial": {}, "trials_planned": 10},
        headers=headers,
    ).json()
    assert run["engine"] == "L2"


def test_the_admin_sees_the_latest_plan_and_changes(
    client: TestClient,
    admin_headers: Headers,
    patient_headers: Headers,
    session: Session,
) -> None:
    patient_id = profile(session).id
    url = f"/api/admin/patients/{patient_id}/plan"
    empty = client.get(url, headers=admin_headers).json()
    assert empty == {"session_id": None, "started_at": None, "session_status": None, "plan": None, "overrides": []}
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    planned = [g["game_id"] for g in client.get(f"/api/sessions/{session_id}/plan", headers=patient_headers).json()["games"]]
    client.post(f"/api/sessions/{session_id}/plan/override", json={"games": planned[:2]}, headers=patient_headers)
    latest = client.get(url, headers=admin_headers).json()
    assert latest["session_id"] == session_id
    assert latest["session_status"] == "active"
    assert [g["game_id"] for g in latest["plan"]["games"]] == planned
    assert latest["overrides"][0]["removed"] == planned[2:]
    assert client.get(url, headers=patient_headers).status_code == 403
    assert client.get("/api/admin/patients/999/plan", headers=admin_headers).status_code == 404


def test_the_queue_keeps_the_plans_trials(client: TestClient, patient_headers: Headers) -> None:
    session_id = client.post("/api/sessions", headers=patient_headers).json()["id"]
    url = f"/api/sessions/{session_id}/progress"
    queue = {"games": ["bloom", "reach_activate"], "index": 0, "trials": {"bloom": 10}}
    response = client.patch(url, json={"game_queue": queue}, headers=patient_headers)
    assert response.status_code == 200, response.text
    assert response.json()["game_queue"]["trials"] == {"bloom": 10}
    bad = {**queue, "trials": {"bloom": 2}}
    assert client.patch(url, json={"game_queue": bad}, headers=patient_headers).status_code == 422
