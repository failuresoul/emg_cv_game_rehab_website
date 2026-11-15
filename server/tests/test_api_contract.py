"""docs/api-contract.md lists every route the server has, and nothing else (Day 18).

The routes table of the document (method, path) is compared with the app's own OpenAPI route
list. Parameter names may differ ({id} in the document, {patient_id} in the code), so every
{...} counts the same. The test-only routes (/api/test/*, APP_ENV=test) are not in this app.
"""

import re
from pathlib import Path

from app.main import app

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "api-contract.md"
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
ROW = re.compile(r"^\|\s*([A-Z, ]+?)\s*\|\s*`(/api/[^`]+)`\s*\|")


def normalise(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


def documented_routes() -> set[tuple[str, str]]:
    text = CONTRACT.read_text(encoding="utf-8")
    table = text.split("## Routes", 1)[1].split("\n## ", 1)[0]
    routes: set[tuple[str, str]] = set()
    for line in table.splitlines():
        match = ROW.match(line)
        if not match:
            continue
        for method in match.group(1).split(","):
            routes.add((method.strip(), normalise(match.group(2))))
    return routes


def app_routes() -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            if method.upper() in METHODS:
                routes.add((method.upper(), normalise(path)))
    return routes


def test_the_contract_table_is_read() -> None:
    assert len(documented_routes()) > 50


def test_every_route_is_documented() -> None:
    undocumented = sorted(app_routes() - documented_routes())
    assert not undocumented, f"Routes missing from docs/api-contract.md: {undocumented}"


def test_every_documented_route_exists() -> None:
    missing = sorted(documented_routes() - app_routes())
    assert not missing, f"Routes in docs/api-contract.md the server does not have: {missing}"
