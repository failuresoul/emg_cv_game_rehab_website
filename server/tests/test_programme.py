"""Each patient's programme (Day 17): migration, the API, its history, and every place that obeys
it: the engine's cap, the planner, the patient's games, regular rests, and the browser's warm-up
and muscle-sensor defaults (served by GET /api/patient/programme)."""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from conftest import Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from test_engine_api import new_run, step, trial
from test_planner import add_session, feedback, ids, noon, plan_for, profile, statuses  # noqa: F401

from app.core.security import hash_password
from app.engine.base import EngineData
from app.engine.safety import SafetyInput, apply_safety
from app.models import (
    AdaptationLog,
    GameRun,
    GameSetting,
    PatientProfile,
    PatientProgramme,
    ProgrammeChange,
    User,
)
from app.models.user import utc_now
from app.schemas.game import GAME_IDS
from app.schemas.programme import EXERCISE_IDS
from app.services import engine_store
from app.services import programme as programmes
from tests.programme_helpers import set_programme

ALL_GAMES = [game for game in GAME_IDS]


def url(patient_id: int, suffix: str = "") -> str:
    return f"/api/admin/patients/{patient_id}/programme{suffix}"


def body(**changes: Any) -> dict[str, Any]:
    """A full, valid programme for PUT."""
    return {
        "enabled_games": ALL_GAMES,
        "max_level": {},
        "session_minutes_target": 18,
        "games_per_session": {"min": 3, "max": 4},
        "warmup_exercises": list(EXERCISE_IDS),
        "warmup_preset": "personal",
        "rest_every_minutes": 5,
        "engine_mode": "L1",
        "emg_default_site": None,
        "weekly_goal": 5,
        "notes": None,
        **changes,
    }


@pytest.fixture
def patient(create_patient: Callable[..., dict[str, Any]]) -> dict[str, Any]:
    return create_patient(email="patient@example.com", weekly_goal=7)


def put(client: TestClient, headers: Headers, patient_id: int, **changes: Any) -> Any:
    return client.put(url(patient_id), json=body(**changes), headers=headers)


# ---- Migration from the old profile fields --------------------------------------------------


@pytest.mark.parametrize(
    ("old", "level"),
    [(0.3, 3), (0.35, 3), (0.29, 2), (0.05, 1), (0.0, 1), (1.0, 10), (1.7, 10), ("oops", 10), (None, 10)],
)
def test_an_old_maximum_difficulty_becomes_a_level_never_looser(old: Any, level: int) -> None:
    assert programmes.level_from_difficulty(old) == level


def test_profiles_from_before_day_17_get_a_programme_from_their_old_fields(
    session: Session,
) -> None:
    user = User(email="old@example.com", full_name="Old", role="patient", hashed_password=hash_password("x" * 8))
    session.add(user)
    session.flush()
    assert user.id is not None
    old = PatientProfile(
        user_id=user.id,
        patient_code="P900",
        affected_side="left",
        dominant_side="right",
        age_band="60-69",
        weekly_goal=3,
        engine_mode="L2",
        max_difficulty={"bloom": 0.4, "grip_hold": 1.0, "chess": 0.2, "path_trace": "oops"},
    )
    session.add(old)
    session.commit()
    engine = session.get_bind()
    assert programmes.migrate_programmes(engine) == 1  # type: ignore[arg-type]
    assert programmes.migrate_programmes(engine) == 0  # type: ignore[arg-type]
    session.expire_all()
    programme = session.exec(select(PatientProgramme)).one()
    assert programme.patient_id == old.id
    assert programme.weekly_goal == 3
    assert programme.engine_mode == "L2"
    # 1.0 is the default level 10, an unknown game and an unreadable value are left out.
    assert programme.max_level == {"bloom": 4}
    assert programme.enabled_games == programmes.implemented_games()
    assert programme.warmup_exercises == list(EXERCISE_IDS)
    assert (programme.session_minutes_target, programme.rest_every_minutes) == (18, 5)
    assert (programme.games_per_session_min, programme.games_per_session_max) == (3, 4)
    assert programme.warmup_preset == "personal" and programme.emg_default_site is None
    # The old fields are never read again: changing them changes nothing.
    old.weekly_goal, old.engine_mode, old.max_difficulty = 9, "L0", {"bloom": 0.1}
    session.add(old)
    session.commit()
    assert engine_store.max_difficulty(session, old, "bloom") == 0.4
    assert programmes.programme_for(session, old).engine_mode == "L2"


def test_a_new_patient_gets_the_default_programme(
    client: TestClient, admin_headers: Headers, patient: dict[str, Any]
) -> None:
    response = client.get(url(patient["id"]), headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["weekly_goal"] == 7  # from the create form
    assert data["enabled_games"] == ALL_GAMES
    assert data["warmup_exercises"] == list(EXERCISE_IDS)
    assert data["games_per_session"] == {"min": 3, "max": 4}
    assert data["session_minutes_target"] == 18 and data["rest_every_minutes"] == 5
    assert data["engine_mode"] == "L1" and data["warmup_preset"] == "personal"
    assert data["max_level"] == {} and data["emg_default_site"] is None
    assert data["library_disabled_games"] == []
    assert patient["weekly_goal"] == 7 and patient["engine_mode"] == "L1"


# ---- Validation -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"games_per_session": {"min": 5, "max": 4}}, "cannot be more than the most"),
        ({"games_per_session": {"min": 1, "max": 4}}, "greater than or equal to 2"),
        ({"games_per_session": {"min": 3, "max": 7}}, "less than or equal to 6"),
        ({"session_minutes_target": 9}, "greater than or equal to 10"),
        ({"session_minutes_target": 41}, "less than or equal to 40"),
        ({"rest_every_minutes": 2}, "greater than or equal to 3"),
        ({"rest_every_minutes": 11}, "less than or equal to 10"),
        ({"max_level": {"bloom": 0}}, "greater than or equal to 1"),
        ({"max_level": {"bloom": 11}}, "less than or equal to 10"),
        ({"max_level": {"chess": 5}}, "chess"),
        ({"enabled_games": ["bloom", "chess", "grip_hold"]}, "Input should be 'reach_activate'"),
        ({"enabled_games": ["bloom", "bloom", "grip_hold"]}, "only once"),
        ({"enabled_games": ["bloom", "grip_hold"]}, "Turn on at least 3 games"),
        ({"enabled_games": []}, "at least 1"),
        ({"warmup_exercises": []}, "at least 1"),
        ({"warmup_exercises": ["shoulder_flexion", "shoulder_flexion"]}, "only once"),
        ({"warmup_preset": "standard"}, "personal"),
        ({"engine_mode": "L9"}, "L0"),
        ({"emg_default_site": "biceps"}, "flexors"),
        ({"weekly_goal": 0}, "greater than or equal to 1"),
        ({"weekly_goal": 15}, "less than or equal to 14"),
        ({"notes": "x" * 2001}, "at most 2000"),
        ({"reason": "x" * 501}, "at most 500"),
        ({"surprise": 1}, "Extra inputs"),
    ],
)
def test_invalid_programmes_are_refused_with_a_clear_message(
    client: TestClient,
    admin_headers: Headers,
    patient: dict[str, Any],
    changes: dict[str, Any],
    message: str,
) -> None:
    response = put(client, admin_headers, patient["id"], **changes)
    assert response.status_code == 422, response.text
    assert message in response.text


def test_a_game_the_library_turned_off_cannot_be_turned_on(
    client: TestClient, admin_headers: Headers, patient: dict[str, Any], session: Session
) -> None:
    session.add(GameSetting(game_id="bloom", enabled=False))
    session.commit()
    response = put(client, admin_headers, patient["id"])
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Turned off in the Game Library, so it cannot be in a programme: bloom"
    )
    without = [game for game in ALL_GAMES if game != "bloom"]
    response = put(client, admin_headers, patient["id"], enabled_games=without)
    assert response.status_code == 200, response.text
    assert response.json()["library_disabled_games"] == ["bloom"]


def test_unknown_patients_are_404(client: TestClient, admin_headers: Headers) -> None:
    assert client.get(url(999), headers=admin_headers).status_code == 404
    assert client.put(url(999), json=body(), headers=admin_headers).status_code == 404
    assert client.get(url(999, "/history"), headers=admin_headers).status_code == 404


# ---- History --------------------------------------------------------------------------------


def test_every_change_is_kept_with_the_admin_and_the_reason(
    client: TestClient, admin_headers: Headers, patient: dict[str, Any], session: Session
) -> None:
    patient_id = patient["id"]
    response = put(
        client,
        admin_headers,
        patient_id,
        max_level={"bloom": 4, "grip_hold": 10},
        weekly_goal=7,
        rest_every_minutes=3,
        emg_default_site="extensors",
        notes="  Shoulder pain last week  ",
        reason="After the clinic visit",
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["max_level"] == {"bloom": 4}  # 10 is the default and is not stored
    assert data["notes"] == "Shoulder pain last week"
    history = client.get(url(patient_id, "/history"), headers=admin_headers).json()
    assert {row["field"] for row in history} == {
        "max_level",
        "rest_every_minutes",
        "emg_default_site",
        "notes",
    }
    rest = next(row for row in history if row["field"] == "rest_every_minutes")
    assert (rest["before"], rest["after"]) == (5, 3)
    assert rest["reason"] == "After the clinic visit"
    assert rest["admin_name"] and rest["admin_id"] is not None
    levels = next(row for row in history if row["field"] == "max_level")
    assert (levels["before"], levels["after"]) == ({}, {"bloom": 4})

    # The same programme again: nothing changed, nothing written.
    again = put(
        client,
        admin_headers,
        patient_id,
        max_level={"bloom": 4},
        weekly_goal=7,
        rest_every_minutes=3,
        emg_default_site="extensors",
        notes="Shoulder pain last week",
    )
    assert again.status_code == 200
    assert len(session.exec(select(ProgrammeChange)).all()) == 4

    # A later change comes first, without a reason; reordering lists is not a change.
    reordered = list(reversed(ALL_GAMES))
    put(client, admin_headers, patient_id, enabled_games=reordered, max_level={"bloom": 4},
        weekly_goal=7, rest_every_minutes=3, emg_default_site="extensors",
        notes="Shoulder pain last week", engine_mode="L2")
    history = client.get(url(patient_id, "/history"), headers=admin_headers).json()
    assert history[0]["field"] == "engine_mode" and history[0]["reason"] is None
    assert len(history) == 5


def test_the_patient_form_goes_through_the_programme_and_its_history(
    client: TestClient, admin_headers: Headers, patient: dict[str, Any]
) -> None:
    patient_url = f"/api/admin/patients/{patient['id']}"
    response = client.patch(patient_url, json={"weekly_goal": 3, "engine_mode": "L0"}, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["weekly_goal"] == 3 and response.json()["engine_mode"] == "L0"
    programme = client.get(url(patient["id"]), headers=admin_headers).json()
    assert programme["weekly_goal"] == 3 and programme["engine_mode"] == "L0"
    history = client.get(url(patient["id"], "/history"), headers=admin_headers).json()
    assert {(row["field"], row["before"], row["after"]) for row in history} == {
        ("weekly_goal", 7, 3),
        ("engine_mode", "L1", "L0"),
    }


# ---- Who may read and change it -------------------------------------------------------------


def test_patients_cannot_read_or_change_the_admin_programme(
    client: TestClient, patient_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    assert client.get(url(own.id), headers=patient_headers).status_code == 403
    assert client.put(url(own.id), json=body(), headers=patient_headers).status_code == 403
    assert client.get(url(own.id, "/history"), headers=patient_headers).status_code == 403
    # Their own view is read-only.
    assert client.put("/api/patient/programme", json=body(), headers=patient_headers).status_code == 405
    assert client.get("/api/patient/programme").status_code == 401
    assert session.exec(select(ProgrammeChange)).all() == []


def test_the_patients_view_has_only_what_the_browser_needs(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    games = ["reach_activate", "bloom", "grip_hold", "pick_place"]
    response = put(
        client,
        admin_headers,
        own.id,
        enabled_games=games,
        warmup_exercises=["thumb_opposition", "shoulder_flexion"],
        warmup_preset="gentle",
        rest_every_minutes=4,
        emg_default_site="extensors",
        notes="Private to the therapist",
    )
    assert response.status_code == 200, response.text
    session.add(GameSetting(game_id="pick_place", enabled=False))
    session.commit()
    response = client.get("/api/patient/programme", headers=patient_headers)
    assert response.status_code == 200
    assert response.json() == {
        "enabled_games": ["reach_activate", "bloom", "grip_hold"],
        # In the warm-up's own order.
        "warmup_exercises": ["shoulder_flexion", "thumb_opposition"],
        "warmup_preset": "gentle",
        "rest_every_minutes": 4,
        "emg_default_site": "extensors",
        "weekly_goal": 5,
    }
    assert "Private" not in response.text


# ---- Enforcement ----------------------------------------------------------------------------


def test_the_engine_never_goes_above_the_highest_level(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    assert put(client, admin_headers, own.id, max_level={"reach_activate": 3}).status_code == 200
    assert engine_store.max_difficulty(session, own, "reach_activate") == pytest.approx(0.3)
    assert engine_store.max_difficulty(session, own, "bloom") == 1.0
    run_id = new_run(client, patient_headers)
    step(client, patient_headers, run_id)
    for n in range(1, 16):
        answer = step(client, patient_headers, run_id, trial(n))
    session.expire_all()
    last = session.exec(select(AdaptationLog).order_by(AdaptationLog.trial_no.desc())).first()  # type: ignore[attr-defined]
    assert last is not None
    assert all(d <= 0.3 + 1e-9 for d in last.state_after["d"].values())
    assert answer["level"] <= 4


def test_the_engine_mode_comes_from_the_programme(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    put(client, admin_headers, own.id, engine_mode="L0")
    run_id = new_run(client, patient_headers)
    assert step(client, patient_headers, run_id)["engine"] == "L0"
    assert session.get(GameRun, run_id).engine == "L0"  # type: ignore[union-attr]
    me = client.get("/api/auth/me", headers=patient_headers).json()
    assert me["patient_profile"]["engine_mode"] == "L0"


def test_the_planner_uses_only_the_programmes_games(
    session: Session, statuses: dict[str, str], patient_headers: Headers  # noqa: F811
) -> None:
    statuses.update({"H1": "worse", "H6": "worse", "H2": "worse"})
    patient = profile(session)
    set_programme(
        session,
        patient,
        enabled_games=["reach_activate", "balloon_pop", "grip_hold"],
        games_per_session_min=2,
        games_per_session_max=6,
    )
    plan = plan_for(session)
    assert set(ids(plan)) == {"reach_activate", "balloon_pop", "grip_hold"}


@pytest.mark.parametrize("count", [2, 3, 5, 6])
def test_the_planner_plans_the_programmes_number_of_games(
    session: Session, statuses: dict[str, str], patient_headers: Headers, count: int  # noqa: F811
) -> None:
    set_programme(session, profile(session), games_per_session_min=2, games_per_session_max=count)
    assert len(plan_for(session).games) == count


def test_the_planner_fits_the_programmes_minutes(
    session: Session, statuses: dict[str, str], patient_headers: Headers  # noqa: F811
) -> None:
    patient = profile(session)
    set_programme(session, patient, session_minutes_target=30, games_per_session_max=5)
    long = plan_for(session)
    assert 28 - 0.5 <= long.total_minutes <= 30 + 0.5
    set_programme(session, patient, session_minutes_target=10, games_per_session_max=3)
    short = plan_for(session, days_ago=1)
    assert 8 - 1.5 <= short.total_minutes <= 10 + 0.5


def test_a_lighter_day_has_the_fewest_games_and_two_thirds_of_the_minutes(
    session: Session, statuses: dict[str, str], patient_headers: Headers  # noqa: F811
) -> None:
    patient = profile(session)
    set_programme(
        session, patient, games_per_session_min=2, games_per_session_max=5, session_minutes_target=24
    )
    last = add_session(session, patient, noon(1))
    feedback(session, last, fatigue_0_10=9)
    light = plan_for(session)
    assert len(light.games) == 2
    assert light.notes[0].key == "lighter_today"
    # Two thirds of 24 minutes.
    assert 16 - 1.5 <= light.total_minutes <= 16 + 1.5


def test_the_patients_games_follow_the_programme(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    put(client, admin_headers, own.id, enabled_games=["bloom", "grip_hold", "reach_activate"])
    games = client.get("/api/games/settings", headers=patient_headers).json()
    assert [game["game_id"] for game in games] == ["reach_activate", "bloom", "grip_hold"]


def test_safety_gives_a_rest_after_the_programmes_minutes_without_easing() -> None:
    state = EngineData(d={"spatial": 0.5, "temporal": 0.5})

    def check(minutes: float, every: float | None) -> Any:
        return apply_safety(
            SafetyInput(
                before=state,
                after=state,
                history=[],
                minutes_since_rest=minutes,
                rest_every_minutes=every,
            )
        )

    assert check(5.0, 5).cue == "rest"
    assert check(5.0, 5).state.d == state.d
    assert check(4.9, 5).cue is None
    assert check(9.0, 10).cue is None
    assert check(10.0, 10).cue == "rest"
    assert check(30.0, None).cue is None


def test_rests_come_every_few_minutes_of_play(
    client: TestClient, patient_headers: Headers, admin_headers: Headers, session: Session
) -> None:
    own = session.exec(select(PatientProfile)).one()
    assert own.id is not None
    put(client, admin_headers, own.id, rest_every_minutes=10)
    run_id = new_run(client, patient_headers)
    run = session.get(GameRun, run_id)
    assert run is not None
    # Six minutes of play so far.
    run.started_at = utc_now() - timedelta(minutes=6)
    session.add(run)
    session.commit()
    assert step(client, patient_headers, run_id)["cue"] is None

    put(client, admin_headers, own.id, rest_every_minutes=5)
    assert step(client, patient_headers, run_id, trial(1))["cue"] == "rest"
    # Just rested: the next trial has no rest prompt.
    assert step(client, patient_headers, run_id, trial(2))["cue"] is None


# ---- The demo seeder and the smoke test still work through it --------------------------------


def test_programme_rows_are_one_per_patient(session: Session, patient_headers: Headers) -> None:
    own = session.exec(select(PatientProfile)).one()
    first = programmes.programme_for(session, own)
    assert programmes.programme_for(session, own).id == first.id
    assert len(session.exec(select(PatientProgramme)).all()) == 1
