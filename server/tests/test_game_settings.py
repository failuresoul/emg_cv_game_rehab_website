from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import GameSetting
from app.services import game_specs
from app.services.game_specs import GameSpecsUnavailableError, get_spec, load_specs
from conftest import Headers

ALL_GAMES = [
    "reach_activate",
    "balloon_pop",
    "fruit_catch",
    "bloom",
    "finger_piano",
    "path_trace",
    "paint_wall",
    "pick_place",
    "grip_hold",
]


def setting(**changes: Any) -> dict[str, Any]:
    return {"enabled": True, "default_params": {}, "trials_default": None, "notes": None, **changes}


def put(client: TestClient, headers: Headers, game_id: str, body: dict[str, Any]) -> Any:
    return client.put(f"/api/admin/games/{game_id}", json=body, headers=headers)


def test_specs_are_read_from_the_shared_file() -> None:
    specs = load_specs()
    assert [spec.id for spec in specs] == ALL_GAMES
    pick_place = get_spec("pick_place")
    assert pick_place is not None
    box = pick_place.param("box_size_sw")
    assert box is not None
    assert (box.min, box.max, box.default, box.harder) == (0.4, 0.9, 0.7, "lower")
    assert get_spec("chess") is None


def test_missing_specs_file_is_a_clear_error(tmp_path: Path) -> None:
    with pytest.raises(GameSpecsUnavailableError):
        game_specs._load(tmp_path / "nowhere.json")


def test_admin_lists_every_game_with_its_spec_and_defaults(
    client: TestClient, admin_headers: Headers
) -> None:
    response = client.get("/api/admin/games", headers=admin_headers)
    assert response.status_code == 200, response.text
    games = response.json()
    assert [game["spec"]["id"] for game in games] == ALL_GAMES
    grip = games[-1]
    assert grip["enabled"] is True
    assert grip["default_params"] == {}
    assert grip["updated_at"] is None
    assert grip["effective_trials"] == 8
    assert grip["effective_params"]["band_width"] == 0.3
    assert grip["spec"]["params"][1] == {
        "name": "band_width",
        "label_key": "param.bandWidth",
        "min": 0.1,
        "max": 0.35,
        "step": 0.05,
        "default": 0.3,
        "unit": "level",
        "harder": "lower",
    }


def test_admin_game_routes_need_an_admin(client: TestClient, patient_headers: Headers) -> None:
    assert client.get("/api/admin/games").status_code == 401
    assert client.get("/api/admin/games", headers=patient_headers).status_code == 403
    assert put(client, patient_headers, "bloom", setting()).status_code == 403
    response = client.post("/api/admin/games/bloom/reset", headers=patient_headers)
    assert response.status_code == 403


def test_admin_saves_defaults_trials_and_notes(client: TestClient, admin_headers: Headers) -> None:
    body = setting(
        default_params={"box_size_sw": 0.5, "carry_angle_deg": 135},
        trials_default=10,
        notes="  Start with small carries.  ",
    )
    response = put(client, admin_headers, "pick_place", body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["default_params"] == {"box_size_sw": 0.5, "carry_angle_deg": 135}
    assert saved["effective_params"]["box_size_sw"] == 0.5
    assert saved["effective_params"]["object_radius_sw"] == 0.35
    assert saved["effective_trials"] == 10
    assert saved["notes"] == "Start with small carries."
    assert saved["updated_at"] is not None

    games = client.get("/api/admin/games", headers=admin_headers).json()
    pick_place = next(game for game in games if game["spec"]["id"] == "pick_place")
    assert pick_place["trials_default"] == 10
    assert pick_place["effective_params"]["carry_angle_deg"] == 135


def test_defaults_at_the_ends_of_their_ranges_are_accepted(
    client: TestClient, admin_headers: Headers
) -> None:
    body = setting(default_params={"band_width": 0.1, "hold_ms": 8000}, trials_default=40)
    assert put(client, admin_headers, "grip_hold", body).status_code == 200
    body = setting(default_params={"band_width": 0.35, "hold_ms": 2000}, trials_default=5)
    assert put(client, admin_headers, "grip_hold", body).status_code == 200


def test_unknown_game_is_404(client: TestClient, admin_headers: Headers) -> None:
    assert put(client, admin_headers, "chess", setting()).status_code == 404
    assert client.post("/api/admin/games/chess/reset", headers=admin_headers).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(setting(default_params={"band_width": 0.05}), id="below-min"),
        pytest.param(setting(default_params={"band_width": 0.4}), id="above-max"),
        pytest.param(setting(default_params={"hold_ms": 9000}), id="hold-above-max"),
        pytest.param(setting(default_params={"speed": 1}), id="unknown-setting"),
        pytest.param(setting(default_params={"rest_ms": 2500}), id="fixed-setting-changed"),
        pytest.param(setting(trials_default=4), id="too-few-trials"),
        pytest.param(setting(trials_default=41), id="too-many-trials"),
        pytest.param(setting(trials_default=8.5), id="fractional-trials"),
        pytest.param(setting(enabled="sometimes"), id="enabled-not-bool"),
        pytest.param(setting(notes="x" * 1001), id="notes-too-long"),
        pytest.param({**setting(), "colour": "blue"}, id="unknown-field"),
    ],
)
def test_invalid_setting_is_422(
    client: TestClient, admin_headers: Headers, body: dict[str, Any]
) -> None:
    response = put(client, admin_headers, "grip_hold", body)
    assert response.status_code == 422, response.text


def test_out_of_range_message_names_the_range(client: TestClient, admin_headers: Headers) -> None:
    response = put(client, admin_headers, "grip_hold", setting(default_params={"band_width": 0.5}))
    assert response.json()["detail"] == "band_width must be between 0.1 and 0.35, not 0.5"


def test_reset_restores_the_games_own_defaults(
    client: TestClient, admin_headers: Headers
) -> None:
    body = setting(enabled=False, default_params={"band_center": 0.7}, trials_default=12)
    assert put(client, admin_headers, "grip_hold", body).status_code == 200

    response = client.post("/api/admin/games/grip_hold/reset", headers=admin_headers)
    assert response.status_code == 200, response.text
    reset = response.json()
    assert reset["enabled"] is True
    assert reset["default_params"] == {}
    assert reset["trials_default"] is None
    assert reset["effective_params"]["band_center"] == 0.5
    assert reset["effective_trials"] == 8
    assert reset["updated_at"] is None
    # Resetting a game never changed is fine too.
    assert client.post("/api/admin/games/bloom/reset", headers=admin_headers).status_code == 200


def test_patient_sees_enabled_games_with_effective_defaults(
    client: TestClient, admin_headers: Headers, patient_headers: Headers
) -> None:
    response = client.get("/api/games/settings", headers=patient_headers)
    assert response.status_code == 200, response.text
    assert [game["game_id"] for game in response.json()] == ALL_GAMES

    assert put(client, admin_headers, "bloom", setting(enabled=False)).status_code == 200
    body = setting(default_params={"hold_ms": 5000}, trials_default=6)
    assert put(client, admin_headers, "grip_hold", body).status_code == 200

    games = client.get("/api/games/settings", headers=patient_headers).json()
    ids = [game["game_id"] for game in games]
    assert "bloom" not in ids
    assert len(ids) == 8
    grip = next(game for game in games if game["game_id"] == "grip_hold")
    assert grip["trials"] == 6
    assert grip["params"]["hold_ms"] == 5000
    assert grip["params"]["band_center"] == 0.5


def test_patient_settings_need_a_patient(client: TestClient, admin_headers: Headers) -> None:
    assert client.get("/api/games/settings").status_code == 401
    assert client.get("/api/games/settings", headers=admin_headers).status_code == 403


def test_saved_defaults_no_longer_valid_are_ignored(
    client: TestClient, session: Session, patient_headers: Headers
) -> None:
    # As if the game's ranges changed after the admin saved these.
    session.add(
        GameSetting(
            game_id="grip_hold", default_params={"band_width": 0.9, "gone": 1, "hold_ms": 4000}
        )
    )
    session.commit()
    games = client.get("/api/games/settings", headers=patient_headers).json()
    grip = next(game for game in games if game["game_id"] == "grip_hold")
    assert grip["params"]["band_width"] == 0.3
    assert grip["params"]["hold_ms"] == 4000
    assert "gone" not in grip["params"]
