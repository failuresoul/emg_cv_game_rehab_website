# Testing

How MuVi Rehab is tested, how to run each kind of test, and the current results (2026-11-16, Day 18).

## Strategy

| Level                | What it covers                                                                                                                                                            | Tools                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unit                 | Pure logic: vision maths, rep and sequence counters, input sources, metrics, the difficulty engines, safety rules, planner, feedback rules and validation, EMG processing | pytest, Vitest                                                                                |
| Integration          | The API with a real (in-memory) database: every route, access rules, migrations, report jobs with the mock model                                                          | pytest + FastAPI TestClient                                                                   |
| End to end           | Real user journeys in headless Chromium against both servers                                                                                                              | Playwright                                                                                    |
| Performance          | API latency, a report end to end, a 10-patient load test, the frame budget of every game                                                                                  | `analysis/perf/api_perf.py`, `npm run e2e:perf`                                               |
| Security             | Tokens, access to other people's data, hostile input, request limits, headers and CSP, bundle secrets, dependencies                                                       | pytest, Vitest, `check:csp`, `scan:bundle`, `npm audit`, `pip-audit` (see `docs/security.md`) |
| Accessibility        | axe on ten pages in both languages, contrast tokens, display settings                                                                                                     | vitest-axe (jsdom)                                                                            |
| Internationalisation | Key and placeholder parity, nothing left in English, no JSX text outside `t()`; a Bangla session with no English on screen                                                | Vitest (`i18n:check`), Playwright `bangla.spec.ts`                                            |
| Usability            | A scripted session with 3–5 volunteers, timed tasks and the System Usability Scale                                                                                        | Manual, Day 19                                                                                |

### No hardware in automated tests

The automated tests never need a webcam, the ESP32 or Ollama:

- **Camera:** replayed landmark recordings (`web/public/test-fixtures/landmarks`, including `shadik_full.json`, recorded with `/dev/record-guide`) or the synthetic generator (`src/testing/synthLandmarks.ts`). The generator can also play a game by itself.
- **Muscle sensor:** the simulated sensor, driven by the tests (`window.__muviTest.emg`).
- **Feedback model:** the mock provider, which writes valid reports on the test server, or fails on request.
- **Test mode:** these hooks exist only in a development build with `VITE_TEST_MODE=true`, and on a server with `APP_ENV=test`. A production build has none of them (`npm run scan:bundle`).

**Real-hardware EMG testing happens on Day 21**, following `docs/emg-hardware-test.md`.

## How to run

```powershell
# Server: unit and integration tests, with coverage
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term

# Web: unit tests, coverage, accessibility, translations
cd web; npm test
npx vitest run --coverage
npx vitest run src/a11y
npm run i18n:check

# End to end (Playwright starts and stops its own servers on ports 8001 and 5174)
npx playwright install chromium   # once
npm run e2e                       # fast: every suite, short sessions
npm run e2e:full                  # the main journey at full length
npm run e2e:perf                  # frame budget of every game

# Performance of the API (quick mode, about 1 minute; leave out the options for the full run)
cd ..; server\.venv\Scripts\python.exe analysis\perf\api_perf.py --calls 200 --patients 3 --minutes 0.5

# Security
cd web; npm run build; npm run scan:bundle; npm run check:csp; npm audit --omit=dev
cd ..\server; .venv\Scripts\python.exe -m pip_audit -r requirements.txt

# Everything, then the fast end-to-end suite
cd ..; .\scripts\check.ps1 -E2E
```

## Current results

| Check                     | Result                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pytest                    | 1,406 passed                                                                                                                                                    |
| Server coverage           | 98.4% of `app/`: engine 98.6%, safety 100%, planner 99.0%, metrics 100%, feedback 97.7%                                                                         |
| Vitest                    | 1,580 passed (138 files)                                                                                                                                        |
| Web coverage (pure logic) | vision maths 98.6%, warm-up counters 94.1%, input 94.1%, metrics 98.2%, AI 96.2%, EMG 91.9%                                                                     |
| Accessibility, i18n       | 32 and 15 passed (Day 17), still passing within `npm test`                                                                                                      |
| Playwright fast           | 28 passed in 10.7 min                                                                                                                                           |
| Playwright full           | Not run yet (the journey at full length, about 15 min)                                                                                                          |
| Performance               | `/api/engine/next` p95 21.5 ms (L1) and 23.9 ms (L2); load test 0 errors in 11,890 requests, p95 140 ms; 60 FPS in every game on replay (`docs/performance.md`) |
| Security                  | `npm audit --omit=dev` 0 and `pip-audit` 0; CSP 0 violations; bundle scan 0 findings (`docs/security.md`)                                                       |

Fast suite timings:

| Spec               | Time                                           |
| ------------------ | ---------------------------------------------- |
| auth               | 9 s                                            |
| admin              | 19 s                                           |
| patient session    | 2.6 min (synthetic 1.5 min, recording 1.1 min) |
| EMG                | 1.7 min                                        |
| resilience         | 2.1 min                                        |
| Bangla             | 48 s                                           |
| research           | 1.8 min                                        |
| privacy            | 1.0 min                                        |
| smoke and recorder | 8 s                                            |
