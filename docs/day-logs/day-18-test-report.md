# Day 18 test report

**Date:** 2026-11-16.

- **Results:** the figures are from today's runs. The final review reused them rather than running everything again.
- **Not run:** anything marked so below has not been run yet.

## Results

| Check                               | Result                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| pytest                              | 1,406 passed (after the security changes)                                     |
| Server coverage                     | 98.4%; engine 98.6%, safety 100%, planner 99.0%, metrics 100%, feedback 97.7% |
| Vitest                              | 1,580 passed, 138 files                                                       |
| Web pure-logic coverage             | 91.9–98.6% per area (all ≥ 85%)                                               |
| Playwright fast                     | 28 passed, 10.7 min                                                           |
| Playwright full                     | **Not run**                                                                   |
| Playwright perf                     | 9 games, 60 FPS, p95 frame time ≤ 0.4 ms                                      |
| API performance                     | engine p95 21.5 / 23.9 ms; report 60 ms; load test 0 errors, p95 140 ms       |
| `check:csp`                         | PASS, 0 violations                                                            |
| `scan:bundle`                       | PASS: 54 files, no secrets, test code, developer pages or test routes         |
| `npm audit --omit=dev`, `pip-audit` | 0, 0                                                                          |
| `scripts/check.ps1 -E2E`            | **Not run as a whole**; each of its steps passed separately today             |

## Requirements

| Requirement                                 | How checked                                                                                      | Result                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Tests run without a webcam, sensor or model | Replay or synthetic camera, simulated EMG, mock model; Playwright counts the camera requests (0) | PASS                                   |
| Test-only features absent from production   | `scan:bundle` on the build; pytest proves `/api/test/*` exists only with `APP_ENV=test`          | PASS                                   |
| Patients reach only their own data          | Access sweep over every route from OpenAPI, reading and writing                                  | PASS                                   |
| Coverage targets                            | pytest and Vitest coverage                                                                       | PASS                                   |
| API contract up to date                     | `test_api_contract.py`                                                                           | PASS (18 routes added to the document) |
| Performance targets                         | `docs/performance.md`                                                                            | PASS                                   |
| Security review                             | `docs/security.md`                                                                               | PASS; the limits are listed there      |

## Manual checks still open

- **Day 21, real hardware:**
  - the muscle-sensor test with the real ESP32 (`docs/emg-hardware-test.md`);
  - the frame rate with the real webcam.
- **Day 19, by eye:** the Bangla screens, large text and high contrast (the checklist in the Day 17 test report).
