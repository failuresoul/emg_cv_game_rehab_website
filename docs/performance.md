# Performance (Day 18)

Measured on 2026-11-15 on the development laptop (Windows 11), with the mock feedback model and SQLite. Every figure can be measured again with the commands below.

```powershell
# API: engine latency, a report end to end, and the load test (about 6 minutes)
server\.venv\Scripts\python.exe analysis\perf\api_perf.py
# Frame budget of every game, on replayed landmarks (about 3 minutes)
cd web; npm run e2e:perf
```

- **Where the raw numbers go:** `analysis/results/perf_api.json` and `analysis/results/perf_frames.json`.
- **What the API script uses:** its own server, on a free port, with a temporary database. It stops the server and deletes the database at the end.

## Targets

| Measure                                    | Target   | Result                                  |      |
| ------------------------------------------ | -------- | --------------------------------------- | ---- |
| `/api/engine/next` p95, 1,000 calls        | < 50 ms  | 21.5 ms (L1), 23.9 ms (L2)              | PASS |
| Report job with the mock model, end to end |          | 60 ms median, 69 ms worst of 5          |      |
| Load test: 10 patients for 5 minutes       | errors 0 | 0 errors in 11,890 requests; p95 140 ms | PASS |
| Game loop frames a second, on replay       | ≥ 30 FPS | 60 FPS in all 9 games                   | PASS |

## API

| Measure                                                       | n    | p50 ms | p95 ms | max ms |
| ------------------------------------------------------------- | ---- | ------ | ------ | ------ |
| `/api/engine/next` (L1, staircase)                            | 1000 | 17.9   | 21.5   | 111.3  |
| `/api/engine/next` (L2, Bayesian)                             | 1000 | 18.6   | 23.9   | 110.8  |
| Report job, mock model (the model's report, not the template) | 5    | 59.5   | 69.4   | 69.4   |

- **The engine:** each answer is one request, measured from the client.
- **The report job:** timed from the request to the finished report.

### Load test

The test ran 10 patients at once for 305 s, each playing like the app:

- **Each trial:** a trial every 0.5 s, which is an engine answer and then the trial saved.
- **Each game:** 10 trials, then the game's end and the home page.
- **Each session:** four games, then the session's end.

The run covered:

- 130 sessions, 500 game runs and 5,000 trials;
- 39 requests a second;
- **0 errors**.

| Route                                          | n      | p50 ms | p95 ms | max ms |
| ---------------------------------------------- | ------ | ------ | ------ | ------ |
| Every request                                  | 11,890 | 18.9   | 139.9  | 1,611  |
| `POST /api/engine/next`                        | 5,000  | 22.4   | 146.3  | 648    |
| `POST /api/games/{id}/trials`                  | 5,000  | 13.6   | 75.6   | 380    |
| `GET /api/patient/dashboard`                   | 500    | 14.4   | 146.7  | 385    |
| `POST /api/sessions/{id}/games` (start a game) | 500    | 26.2   | 183.3  | 434    |
| `POST /api/games/{id}/end`                     | 500    | 65.7   | 239.8  | 407    |
| `POST /api/sessions`                           | 130    | 31.5   | 620.5  | 1,611  |
| `POST /api/sessions/{id}/calibration`          | 130    | 12.5   | 117.2  | 461    |
| `POST /api/sessions/{id}/end`                  | 130    | 198.4  | 538.8  | 761    |

**What this means:**

- **Fast enough for a 30 FPS game:** a trial is saved and the next one set in well under a frame most of the time. The game never waits for either: trials are saved in the background, and the engine is asked between trials.
- **The slow calls:**
  - **Ending a session** computes all of the session's measures (about 200 ms on its own).
  - **Starting a session** builds the plan from the patient's history.
  - With 10 patients at once on SQLite, which lets one write happen at a time, these two queue behind each other. That queuing is what produces the 0.5–1.6 s maximums.
- **For a clinic with more patients at once:** PostgreSQL (`DATABASE_URL`) removes the single writer.

### Database indexes

The load test's queries list a patient's sessions newest first, and a session's game runs in order. Most foreign keys already had an index; these were added:

| Index                        | Table        | Columns                  |
| ---------------------------- | ------------ | ------------------------ |
| `ix_session_patient_started` | `session`    | `patient_id, started_at` |
| `ix_gamerun_session_started` | `gamerun`    | `session_id, started_at` |
| `ix_reviewitem_session_id`   | `reviewitem` | `session_id`             |
| `ix_reviewitem_report_id`    | `reviewitem` | `report_id`              |

- **How they are added:** `app/core/db.py` (`ADDED_INDEXES`) creates them on start with `CREATE INDEX IF NOT EXISTS`. That works on a new or an existing SQLite (or PostgreSQL) database and is safe to run again.
- **The check:** `tests/test_db.py` proves it.
- **The numbers above:** they were measured with the indexes in place. No before-and-after comparison was made: with a few hundred sessions the tables are small, and the indexes matter as a clinic's history grows.

## Frame budget

Each game was played for 12 s by the synthetic player, in headless Chromium, on replayed landmarks at 30 frames a second. Each frame's update and render were timed in the game loop (test mode only).

| Game              | Loop FPS | Frame time mean ms | p95 ms | max ms | Replay FPS |
| ----------------- | -------- | ------------------ | ------ | ------ | ---------- |
| Reach and squeeze | 60       | 0.12               | 0.3    | 1.9    | 30         |
| Balloon pop       | 60       | 0.13               | 0.2    | 1.1    | 30         |
| Fruit catch       | 60       | 0.15               | 0.2    | 1.3    | 30         |
| Bloom             | 60       | 0.20               | 0.3    | 1.4    | 30         |
| Finger piano      | 60       | 0.19               | 0.3    | 0.8    | 30         |
| Path trace        | 60       | 0.19               | 0.3    | 8.8    | 30         |
| Paint the wall    | 60       | 0.31               | 0.4    | 0.6    | 30         |
| Pick and place    | 60       | 0.15               | 0.3    | 0.4    | 30         |
| Grip and hold     | 60       | 0.13               | 0.2    | 0.3    | 30         |

**What this means:**

- **Little time per frame:** every game spends under half a millisecond of a 16.7 ms frame (60 Hz) on its own update and drawing, so the games themselves are never the bottleneck.
- **What replay leaves out:** it replaces MediaPipe, so the camera's hand and pose detection is not in these numbers. On a real webcam that detection is the main cost. The app reports it as the camera FPS on the set-up page.
- **To be measured on Day 21:** the same check on the target hardware with the real camera.

## Test coverage

| Area                                                      | Target | Result |
| --------------------------------------------------------- | ------ | ------ |
| Server `app/`                                             | ≥ 85%  | 98.4%  |
| `app/engine`                                              | ≥ 90%  | 98.6%  |
| Safety (`app/engine/safety.py`, `app/services/safety.py`) | ≥ 90%  | 100%   |
| Planner (`app/services/planner.py`)                       | ≥ 90%  | 99.0%  |
| `app/metrics`                                             | ≥ 90%  | 100%   |
| `app/feedback`                                            | ≥ 90%  | 97.7%  |
| Web vision maths (`src/vision`, without the camera glue)  | ≥ 85%  | 98.6%  |
| Web warm-up counters (`src/warmup`)                       | ≥ 85%  | 94.1%  |
| Web input (`src/input`)                                   | ≥ 85%  | 94.1%  |
| Web metrics (`src/metrics`)                               | ≥ 85%  | 98.2%  |
| Web AI (`src/ai`)                                         | ≥ 85%  | 96.2%  |
| Web EMG processing (`src/emg`)                            | ≥ 85%  | 91.9%  |

- **The server numbers:** `pytest --cov=app` (1,339 tests).
- **The web numbers:** `npx vitest run --coverage` with `@vitest/coverage-v8`.
- **The camera glue:** `src/vision/visionEngine.ts` (9% in Vitest) opens the camera and runs MediaPipe in the browser. The end-to-end tests cover it, because it cannot run in Node.
