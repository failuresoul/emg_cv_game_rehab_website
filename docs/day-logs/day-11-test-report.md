# Day 11 test report (server metrics engine)

Date: 2026-11-11. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 1,102 passed (93 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,376 kB, 398 kB gzipped) |
| `pytest` | 669 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **99%** of 4,537 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 50 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |
| `scripts/backfill_metrics.py` | Tested on synthetic sessions; **not run against the real database** |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/metrics/signal.py`, `sparc.py`, `kinematics.py`, `aggregate.py` | 100% |
| `app/core/mdc.py` | 100% |
| `app/services/metrics_catalog.py` | 100% |
| `app/services/session_metrics.py` | 100% |
| `app/services/exports.py` | 100% |
| `app/schemas/metrics.py` | 100% |
| `app/services/trial_metrics.py` | 99% |
| `app/services/session_facts.py` | 99% |
| `app/services/progress.py` | 99% |
| `scripts/backfill_metrics.py` | 98% |

## Day 11 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Resampling, Butterworth with a short-signal fallback, speeds | pytest | PASS | Zero phase; signals of 0–5 points; cut-off above Nyquist |
| SPARC reproduces `shared/test-vectors/sparc.json` | pytest | PASS | All three cases to about 1e-15 (asked: 1e-3), same sample count, FFT size and cut-off |
| Minimum-jerk reach: efficiency 1, one peak; two sub-movements: two peaks, worse SPARC | pytest | PASS | SPARC −1.40 against the vector's −1.401 |
| Reaction-time onset held 50 ms; corridor time; empty aggregates give None | pytest | PASS | |
| Metrics catalogue with every required id | pytest | PASS | 25 measures; ids unique |
| Trial recomputation from RAW; mismatch flag; non-spatial games copied; gaps; idempotent | pytest | PASS | Recompute on run end never fails the request |
| Session metrics: full session, missing parts, idempotency, backfill | pytest | PASS | Expected values checked for 25 rows |
| Baseline and status rules; sign for lower and closer-to-zero measures | pytest | PASS | Boundary at exactly 1 MDC |
| Facts shape, privacy and ownership | pytest | PASS | No name, email or comment; other patient 404 |
| Exports: columns, pseudonymous codes, admin only | pytest | PASS | |
| Admin Metrics section, session metrics card, run quality badge | Vitest | PASS / MANUAL | Formatting, statuses, run quality and series tested; screens by hand |
| Patient metric charts in plain words | Vitest | PASS / MANUAL | Titles checked free of codes and MDC; screen by hand |

## Review findings (task 5)

| Check | Result | Notes |
| --- | --- | --- |
| Server metrics come from RAW data | PASS | `trial_metrics` reads `Trial.trajectory` (the RAW fingertip saved by the browser) and timings; the smoothed cursor is never saved |
| Client and server SPARC agree on the shared vectors | PASS | `web/src/metrics/sparc.test.ts` (to 1e-6) and `server/tests/test_metrics_sparc.py` (to 1e-6, asked 1e-3) read the same file |
| Facts contain no names or emails | PASS | Code only; tests search the response text for the name and email, as patient and as admin; the smoke test does too |
| Exports contain only pseudonymous codes | PASS | Tests and the smoke test check for the name and email |
| All strings via `t()` | PASS | Measure names, units, statuses, data-quality labels and patient chart titles are translation keys (English and Bangla); a test checks every catalogue id has a name |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| The smoke script's response check reads JSON, which a CSV export is not | Smoke test | A separate status and content-type check for the CSV steps |
| Three over-long lines in `seed_demo_data.py` from Day 10 | Review | Wrapped |

## Smoke test against a live server

Not run in this review. Install the new packages, start the server, then in a second terminal:

```powershell
cd server; .venv\Scripts\python.exe -m pip install -r requirements.txt
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 50 `PASS` lines and exit code 0, including:

- "The session's metrics were computed when it ended"
- "Admin reads the patient's metrics table"
- "Patient reads the session facts, with no name or email"
- "Admin downloads the patient's metrics CSV"
- "Admin downloads all trials as CSV"

## Manual checklist

Before you start:

1. Install the new packages: `cd server; .venv\Scripts\python.exe -m pip install -r requirements.txt`.
2. Start the server and the web app.
3. Seed the demo data: `cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py`.
4. Optionally, run the backfill for your own older sessions: `cd server; .venv\Scripts\python.exe scripts\backfill_metrics.py`.
   - Expected: a report of sessions, trials and rows, and exit code 0.

### Admin: patient Progress tab

1. **Table.** Open Demo Rahim → Progress.
   - Expected: "Metrics" is the first section. A note says the MDC values are provisional.
   - The table lists measures (per game where they come from games), each with "Higher/Lower is better", baseline, latest, change, change (MDC), a status badge and sessions.
2. **Statuses.** Look at the badges.
   - Expected: improved green, worse amber, no change and no baseline grey.
   - Over Rahim's 8 sessions, reach area and success rate should read "Improved".
3. **Chart.** Choose "Movement time (Reach and squeeze)" in the picker.
   - Expected: its line over the sessions, in seconds, with a dashed "Baseline …" line.
   - Choose another measure: the chart redraws.
4. **Export.** Click "Export metrics (CSV)" in the patient header.
   - Expected: `P00x-metrics.csv` downloads; it opens in a spreadsheet with codes, no names.

### Admin: session page

1. **Session metrics.** Open one of Rahim's sessions.
   - Expected: a "Session metrics" card lists the session's measures with values and "From n".
2. **Data quality.** Look at each game card.
   - Expected: a "Data quality" badge: Data OK, Tracking gaps or Measures differ (demo trajectories are coarse, so "Measures differ" is common).
3. **A new session.** Play a short session of your own and end it.
   - Expected: its page shows session metrics and data-quality badges straight away.

### Admin: research

1. **Export all trials.** Open /admin/research and click "Export all trials (CSV)".
   - Expected: `motionlab-trials.csv` downloads.
   - It has one row per trial, patient codes, `is_demo`, settings as JSON and `server_…` columns; there are no names or emails.

### Patient progress

1. **Charts.** Log in as a patient with a few sessions and open Progress.
   - Expected: "Your measures over time" with five charts: how far you can reach, time to reach a target, how smooth your movements are, game turns done well, how wide your hand opens.
   - Each says "Higher is better", "Lower is better" or "Closer to 0 is better". There is no "MDC", no codes and no statuses.
2. **Empty chart.** Look at a chart for an activity not yet played.
   - Expected: "This appears after a session with this activity".

### Facts (API)

1. **As the patient.** Open http://localhost:8000/docs, authorise as a patient, and call `GET /api/sessions/{id}/facts` for one of their sessions.
   - Expected: the patient code, no name or email, at most 8 metrics (improved or worse first), and `next_session: null`.
2. **Another patient's session.**
   - Expected: `404`.
