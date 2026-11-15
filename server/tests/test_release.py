"""Release candidate (Day 20): the version, production's refusal of default secrets, and a
complete .env.example."""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.core.config import Settings, production_problems, settings

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
GOOD_SECRET = "f3K9xQ2mV7pL1zR8tY4wN6bH0cJ5dS2aE9uI7oP3"


def test_one_version_everywhere(client: TestClient) -> None:
    assert __version__ == "1.0.0-rc1"
    body = client.get("/api/version").json()
    assert body["version"] == __version__ and body["app"] == settings.APP_NAME
    assert f'version = "{__version__}"' in (SERVER / "pyproject.toml").read_text(encoding="utf-8")
    assert f'"version": "{__version__}"' in (ROOT / "web" / "package.json").read_text(encoding="utf-8")


def make(**overrides: str) -> Settings:
    values = {"JWT_SECRET": GOOD_SECRET, "ADMIN_EMAIL": "a@example.com", "ADMIN_PASSWORD": "a-long-unique-pass-2026",
              "ADMIN_NAME": "Admin", "APP_ENV": "production", **overrides}
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_production_accepts_real_secrets() -> None:
    assert production_problems(make()) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"ADMIN_PASSWORD": "replace-with-a-strong-password"},
        {"ADMIN_PASSWORD": "admin"},
        {"ADMIN_PASSWORD": "short-pw"},
        {"JWT_SECRET": "replace-with-a-random-64-character-string"},
        {"JWT_SECRET": "too-short"},
        {"JWT_SECRET": "a" * 64},
    ],
)
def test_production_refuses_defaults(overrides: dict[str, str]) -> None:
    assert production_problems(make(**overrides))


def test_other_environments_are_not_checked() -> None:
    assert production_problems(make(APP_ENV="development", ADMIN_PASSWORD="admin")) == []


def test_the_server_refuses_to_start_in_production_with_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import app

    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "replace-with-a-strong-password")
    with pytest.raises(RuntimeError, match="Refusing to start in production"):
        with TestClient(app):
            pass


def test_env_example_lists_every_setting() -> None:
    example = (SERVER / ".env.example").read_text(encoding="utf-8")
    listed = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", example, flags=re.M))
    missing = sorted(set(Settings.model_fields) - listed)
    assert not missing, f"Missing from .env.example: {missing}"


def test_dependencies_are_pinned_exactly() -> None:
    for line in (SERVER / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            assert "==" in line, line
