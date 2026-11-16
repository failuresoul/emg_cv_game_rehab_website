"""The admin's EMG settings: one spec shared with the browser, limits enforced, only admins change
them, every signed-in user reads them, and reset brings back the defaults."""

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import emg_settings

Headers = dict[str, str]
REPO = Path(__file__).resolve().parents[2]
WEB_SPEC = REPO / "web" / "src" / "emg" / "emgSettings.json"


def test_the_server_and_the_browser_share_one_spec() -> None:
    server = json.loads(emg_settings.SPEC_PATH.read_text(encoding="utf-8"))
    web = json.loads(WEB_SPEC.read_text(encoding="utf-8"))
    assert server == web


def test_every_default_is_inside_its_limits() -> None:
    for key, rule in emg_settings.spec().items():
        assert rule["min"] <= rule["default"] <= rule["max"], key
        assert rule["group"] in {"stream", "check", "calibration", "signal"}, key
        if rule["integer"]:
            assert float(rule["default"]).is_integer(), key
    defaults = emg_settings.defaults()
    assert defaults["minRateHz"] < defaults["maxRateHz"]


def test_the_familiar_thresholds_keep_their_values() -> None:
    defaults = emg_settings.defaults()
    expected = {
        "minRateHz": 490, "maxRateHz": 510, "maxGapsPct": 0.5, "minContactSdMv": 2,
        "saturationMv": 3000, "relaxedMaxSdMv": 40, "relaxedMaxMeanMv": 800,
        "squeezeMinRatio": 3, "restMs": 10_000, "attempts": 3, "mvcWindowMs": 500,
        "maxAttemptSpread": 0.15, "smoothingMs": 50, "onsetK": 3, "onsetMs": 50, "offsetMs": 100,
    }  # fmt: skip
    for key, value in expected.items():
        assert defaults[key] == value, key


def test_everyone_signed_in_reads_them_and_nobody_else(
    client: TestClient, patient_headers: Headers
) -> None:
    assert client.get("/api/emg-settings").status_code == 401
    response = client.get("/api/emg-settings", headers=patient_headers)
    assert response.status_code == 200
    assert response.json() == {"overrides": {}, "updated_at": None}


def test_only_admins_change_or_reset_them(client: TestClient, patient_headers: Headers) -> None:
    body = {"overrides": {"minRateHz": 480}}
    assert client.put("/api/admin/emg-settings", json=body, headers=patient_headers).status_code == 403
    assert client.delete("/api/admin/emg-settings", headers=patient_headers).status_code == 403


def test_an_admin_changes_them_and_every_browser_gets_them(
    client: TestClient, admin_headers: Headers, patient_headers: Headers
) -> None:
    body = {"overrides": {"minRateHz": 480, "maxGapsPct": 1.5, "restMs": 10_000}}
    response = client.put("/api/admin/emg-settings", json=body, headers=admin_headers)
    assert response.status_code == 200, response.text
    # restMs equals its default, so it is not a change.
    assert response.json()["overrides"] == {"minRateHz": 480, "maxGapsPct": 1.5}
    assert response.json()["updated_at"] is not None
    read = client.get("/api/emg-settings", headers=patient_headers).json()
    assert read["overrides"] == {"minRateHz": 480, "maxGapsPct": 1.5}

    # PUT replaces every change; DELETE resets.
    client.put("/api/admin/emg-settings", json={"overrides": {"onsetK": 2.5}}, headers=admin_headers)
    assert client.get("/api/emg-settings", headers=admin_headers).json()["overrides"] == {"onsetK": 2.5}
    reset = client.delete("/api/admin/emg-settings", headers=admin_headers)
    assert reset.status_code == 200 and reset.json()["overrides"] == {}


@pytest.mark.parametrize(
    ("overrides", "key"),
    [
        ({"noSuchThing": 1}, "noSuchThing"),
        ({"minRateHz": 10}, "minRateHz"),
        ({"saturationMv": 4000}, "saturationMv"),
        ({"attempts": 2.5}, "attempts"),
        ({"minRateHz": 600, "maxRateHz": 550}, "minRateHz"),
    ],
)
def test_values_outside_the_limits_are_refused(
    client: TestClient, admin_headers: Headers, overrides: dict[str, Any], key: str
) -> None:
    response = client.put("/api/admin/emg-settings", json={"overrides": overrides}, headers=admin_headers)
    assert response.status_code == 422
    assert key in response.json()["detail"]
    assert client.get("/api/emg-settings", headers=admin_headers).json()["overrides"] == {}
