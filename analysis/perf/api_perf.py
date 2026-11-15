"""API performance (Day 18): the engine's latency, a feedback report end to end, and a small
load test. Run from the repository root:

    server\\.venv\\Scripts\\python.exe analysis\\perf\\api_perf.py            # everything (about 6 min)
    server\\.venv\\Scripts\\python.exe analysis\\perf\\api_perf.py --minutes 1

It starts the API itself (uvicorn, in this process, on a free port) with a temporary SQLite
database and the mock model, measures over real HTTP, then stops the server and deletes the
database. Your own database and server/.env are never used. Results go to
analysis/results/perf_api.json and are printed as Markdown for docs/performance.md.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import statistics
import sys
import tempfile
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
TEMP = Path(tempfile.mkdtemp(prefix="muvi-perf-"))
ADMIN = ("perf-admin@example.com", "perf-admin-password-1")
PASSWORD = "perf-patient-password"

# Before the app is imported: a throwaway database, the mock model, test mode (its mock writes
# valid reports, so the report timing is the model path, not the template's).
os.environ.update(
    {
        "DATABASE_URL": "sqlite:///" + (TEMP / "perf.db").as_posix(),
        "JWT_SECRET": "perf-only-" + "x" * 60,
        "ADMIN_EMAIL": ADMIN[0],
        "ADMIN_PASSWORD": ADMIN[1],
        "ADMIN_NAME": "Perf Admin",
        "LLM_PROVIDER": "mock",
        "APP_ENV": "test",
        "FEEDBACK_SESSION_END_WAIT_S": "0",
    }
)
sys.path.insert(0, str(SERVER))
os.chdir(SERVER)

import httpx  # noqa: E402
import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from scripts.smoke_test import (  # noqa: E402
    PARAMS,
    calibration_payload,
    game_summary,
    trial_payload,
)

# The games the smoke test has ready-made trials for.
GAMES = ["reach_activate", "balloon_pop", "fruit_catch"]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Server:
    """uvicorn in a thread, stopped on exit."""

    def __init__(self) -> None:
        self.port = free_port()
        config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> str:
        self.thread.start()
        deadline = time.monotonic() + 60
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("the server did not start")
            time.sleep(0.05)
        return f"http://127.0.0.1:{self.port}"

    def __exit__(self, *_: object) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=30)


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def stats(values: list[float]) -> dict[str, float]:
    return {
        "n": len(values),
        "mean_ms": round(statistics.fmean(values), 2) if values else float("nan"),
        "p50_ms": round(percentile(values, 0.50), 2),
        "p95_ms": round(percentile(values, 0.95), 2),
        "max_ms": round(max(values), 2) if values else float("nan"),
    }


async def login(client: httpx.AsyncClient, email: str, password: str) -> dict[str, str]:
    response = await client.post("/api/auth/login", data={"username": email, "password": password})
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def new_patient(client: httpx.AsyncClient, admin: dict[str, str], n: int) -> dict[str, str]:
    email = f"perf.patient{n}.{time.time_ns()}@example.com"
    body = {
        "email": email,
        "full_name": f"Perf Patient {n}",
        "password": PASSWORD,
        "affected_side": "left" if n % 2 else "right",
        "dominant_side": "right",
        "age_band": "60-69",
    }
    (await client.post("/api/admin/patients", json=body, headers=admin)).raise_for_status()
    return await login(client, email, PASSWORD)


async def start_session(client: httpx.AsyncClient, patient: dict[str, str], side: str) -> int:
    response = await client.post("/api/sessions", headers=patient)
    response.raise_for_status()
    session_id = int(response.json()["id"])
    await client.post(
        f"/api/sessions/{session_id}/calibration", json=calibration_payload(side), headers=patient
    )
    return session_id


async def start_run(
    client: httpx.AsyncClient, patient: dict[str, str], session_id: int, game: str, engine: str
) -> int:
    payload = {
        "game_id": game,
        "engine": engine,
        "input_source": "keyboard",
        "params_initial": PARAMS[game],
        "trials_planned": 10,
    }
    response = await client.post(f"/api/sessions/{session_id}/games", json=payload, headers=patient)
    response.raise_for_status()
    return int(response.json()["id"])


def last_trial(n: int) -> dict[str, Any]:
    success = n % 3 != 0
    return {"trial_no": n, "outcome": "success" if success else "reach_fail", "movement_ms": 900}


# ---------------------------------------------------------------------------------------------


async def engine_latency(base: str, calls: int) -> dict[str, Any]:
    """POST /api/engine/next, one patient, one run per engine, `calls` answers each."""
    results: dict[str, Any] = {}
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        admin = await login(client, *ADMIN)
        patient = await new_patient(client, admin, 0)
        session_id = await start_session(client, patient, "left")
        for engine in ("L1", "L2"):
            times: list[float] = []
            run_id = 0
            for n in range(calls):
                # A run allows 500 trials: a new run every 200 calls.
                trial = n % 200
                if trial == 0:
                    run_id = await start_run(client, patient, session_id, "reach_activate", engine)
                payload = {"run_id": run_id, "last_trial": last_trial(trial) if trial else None}
                started = time.perf_counter()
                response = await client.post("/api/engine/next", json=payload, headers=patient)
                times.append((time.perf_counter() - started) * 1000)
                response.raise_for_status()
            results[engine] = stats(times)
    return results


async def report_end_to_end(base: str, reports: int) -> dict[str, Any]:
    """A finished session's report with the mock model: from the request to the report ready."""
    times: list[float] = []
    statuses: list[str] = []
    async with httpx.AsyncClient(base_url=base, timeout=60) as client:
        admin = await login(client, *ADMIN)
        patient = await new_patient(client, admin, 1)
        for _ in range(reports):
            session_id = await start_session(client, patient, "right")
            run_id = await start_run(client, patient, session_id, "reach_activate", "L1")
            trials = [trial_payload("reach_activate", n) for n in range(1, 11)]
            (await client.post(f"/api/games/{run_id}/trials", json=trials, headers=patient)).raise_for_status()
            end = {"status": "completed", "score": 500, "summary": game_summary("reach_activate", trials)}
            (await client.post(f"/api/games/{run_id}/end", json=end, headers=patient)).raise_for_status()
            (await client.post(f"/api/sessions/{session_id}/end", json={"status": "completed"}, headers=patient)).raise_for_status()
            started = time.perf_counter()
            job = await client.post(f"/api/sessions/{session_id}/feedback", json={"language": "en"}, headers=patient)
            job.raise_for_status()
            job_id = job.json()["job_id"]
            while True:
                body = (await client.get(f"/api/feedback/jobs/{job_id}", headers=patient)).json()
                if body["status"] in ("done", "fallback", "failed"):
                    break
                await asyncio.sleep(0.02)
            times.append((time.perf_counter() - started) * 1000)
            statuses.append(body["status"])
    return {**stats(times), "statuses": sorted(set(statuses))}


async def load_test(base: str, patients: int, seconds: float) -> dict[str, Any]:
    """`patients` patients at once, each playing games for `seconds`: a trial every ~0.5 s
    (engine answer, then the trial saved), a run of 10 trials per game, a new session after
    four games (which computes the session's measures), and the home page now and then."""
    latencies: dict[str, list[float]] = defaultdict(list)
    errors: dict[str, int] = defaultdict(int)
    counts = {"requests": 0, "trials": 0, "runs": 0, "sessions": 0}
    deadline = time.monotonic() + seconds

    async with httpx.AsyncClient(base_url=base, timeout=60) as setup:
        admin = await login(setup, *ADMIN)
        logins = [await new_patient(setup, admin, 100 + n) for n in range(patients)]

    async def call(client: httpx.AsyncClient, name: str, method: str, url: str, **kwargs: Any) -> httpx.Response | None:
        started = time.perf_counter()
        try:
            response = await client.request(method, url, **kwargs)
        except httpx.HTTPError:
            errors[name] += 1
            return None
        latencies[name].append((time.perf_counter() - started) * 1000)
        counts["requests"] += 1
        if response.status_code >= 400:
            errors[name] += 1
            return None
        return response

    async def patient_loop(n: int, headers: dict[str, str]) -> None:
        async with httpx.AsyncClient(base_url=base, timeout=60, headers=headers) as client:
            side = "left" if n % 2 else "right"
            while time.monotonic() < deadline:
                response = await call(client, "POST /api/sessions", "POST", "/api/sessions")
                if response is None:
                    await asyncio.sleep(1)
                    continue
                session_id = int(response.json()["id"])
                counts["sessions"] += 1
                await call(client, "POST calibration", "POST", f"/api/sessions/{session_id}/calibration", json=calibration_payload(side))
                for round_no in range(4):
                    if time.monotonic() >= deadline:
                        break
                    game = GAMES[(n + round_no) % len(GAMES)]
                    payload = {"game_id": game, "engine": "L2", "input_source": "keyboard", "params_initial": PARAMS[game], "trials_planned": 10}
                    run = await call(client, "POST game run", "POST", f"/api/sessions/{session_id}/games", json=payload)
                    if run is None:
                        continue
                    run_id = int(run.json()["id"])
                    counts["runs"] += 1
                    trials = []
                    for trial_no in range(1, 11):
                        last = last_trial(trial_no - 1) if trial_no > 1 else None
                        await call(client, "POST /api/engine/next", "POST", "/api/engine/next", json={"run_id": run_id, "last_trial": last})
                        trial = trial_payload(game, trial_no)
                        trials.append(trial)
                        if await call(client, "POST trials", "POST", f"/api/games/{run_id}/trials", json=[trial]):
                            counts["trials"] += 1
                        await asyncio.sleep(0.5)
                    end = {"status": "completed", "score": 100, "summary": game_summary(game, trials)}
                    await call(client, "POST game end", "POST", f"/api/games/{run_id}/end", json=end)
                    await call(client, "GET dashboard", "GET", "/api/patient/dashboard")
                await call(client, "POST session end", "POST", f"/api/sessions/{session_id}/end", json={"status": "completed"})

    started = time.monotonic()
    await asyncio.gather(*(patient_loop(n, headers) for n, headers in enumerate(logins)))
    elapsed = time.monotonic() - started
    every = [value for values in latencies.values() for value in values]
    return {
        "patients": patients,
        "seconds": round(elapsed, 1),
        **counts,
        "errors": sum(errors.values()),
        "error_rate": round(sum(errors.values()) / max(1, counts["requests"] + sum(errors.values())), 4),
        "requests_per_second": round(counts["requests"] / elapsed, 1),
        "all": stats(every),
        "by_route": {name: stats(values) for name, values in sorted(latencies.items())},
        "errors_by_route": dict(errors),
    }


def markdown(results: dict[str, Any]) -> str:
    lines = ["| Measure | n | p50 ms | p95 ms | max ms |", "| --- | --- | --- | --- | --- |"]
    for engine, row in results["engine_next"].items():
        lines.append(f"| `/api/engine/next` ({engine}) | {row['n']} | {row['p50_ms']} | {row['p95_ms']} | {row['max_ms']} |")
    report = results["report"]
    lines.append(f"| Report job, mock model ({', '.join(report['statuses'])}) | {report['n']} | {report['p50_ms']} | {report['p95_ms']} | {report['max_ms']} |")
    load = results["load"]
    lines.append(f"| Load test, every request | {load['all']['n']} | {load['all']['p50_ms']} | {load['all']['p95_ms']} | {load['all']['max_ms']} |")
    for name, row in load["by_route"].items():
        lines.append(f"| &nbsp; {name} | {row['n']} | {row['p50_ms']} | {row['p95_ms']} | {row['max_ms']} |")
    lines.append("")
    lines.append(
        f"Load test: {load['patients']} patients for {load['seconds']} s, {load['sessions']} sessions, "
        f"{load['runs']} game runs, {load['trials']} trials, {load['requests_per_second']} requests/s, "
        f"errors {load['errors']} (rate {load['error_rate']})."
    )
    return "\n".join(lines)


async def main() -> int:
    parser = argparse.ArgumentParser(description="API performance")
    parser.add_argument("--calls", type=int, default=1000)
    parser.add_argument("--reports", type=int, default=5)
    parser.add_argument("--patients", type=int, default=10)
    parser.add_argument("--minutes", type=float, default=5)
    args = parser.parse_args()
    with Server() as base:
        results = {
            "engine_next": await engine_latency(base, args.calls),
            "report": await report_end_to_end(base, args.reports),
            "load": await load_test(base, args.patients, args.minutes * 60),
        }
    out = ROOT / "analysis" / "results" / "perf_api.json"
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(markdown(results))
    print(f"\nSaved {out.relative_to(ROOT)}")
    return 0 if results["load"]["errors"] == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    finally:
        import shutil

        shutil.rmtree(TEMP, ignore_errors=True)
