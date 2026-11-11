# Day 11

**The server metrics engine.** The server now works out its own measures from the RAW data the browser saves, rather than relying only on what the browser reports.

- **Per trial:** each trial gets the server's own measures and a data-quality record.
- **Per session:** each session gets one clean row per measure.
- **Over time:** changes are judged against the patient's baseline.
- **Who reads them:** admin and patient dashboards, the facts the LLM feedback module will read, and CSV exports for research.

## What was built

- **Metrics library** (`server/app/metrics/`, numpy and scipy; pure, no database):
  - `signal`: resampling to 60 Hz, exactly as the web app; a zero-phase 2nd-order Butterworth low-pass (6 Hz), safe for very short signals; speed and angular speed.
  - `sparc`: SPARC step for step as `web/src/metrics/sparc.ts`. It reproduces every case of `shared/test-vectors/sparc.json` to about 1e-15, with the same sample count, FFT size and cut-off.
  - `kinematics`:
    - reaction time: the filtered speed above 0.15 SW/s for 50 ms;
    - movement time, path length, straight distance, efficiency and peak speed;
    - speed peaks (prominence above 10% of the peak);
    - distance to a path and time in a corridor.
  - `aggregate`: count, mean, median, quartiles and IQR, success and flagged rates; empty input gives None.
- **Metrics catalogue** (`shared/metrics-catalog.json`): 25 measures (K1, K5–K10, K12, R1–R4, H1–H6, G1–G4, P1–P3), each with its unit, which way is better, source and description.
- **Server trial measures** (`services/trial_metrics.py`), when a game run ends or an admin recomputes:
  - **Spatial games:** K5–K10 from the RAW trajectory and timings.
  - **Other games:** the browser's figures, checked against the schema and copied.
  - **Data quality:** points, sampling rate, gaps over 200 ms, and every measure more than 10% from the browser's, with both values kept.
- **Session measures** (`SessionMetric`, `services/session_metrics.py`), when the questionnaire is sent, the session ends or an admin recomputes:
  - per-game medians of trial measures;
  - the best value for range measures;
  - rates for success and compensation.
- **Backfill:** `scripts/backfill_metrics.py` computes both levels for older sessions. Demo data now includes them.
- **Changes against the baseline** (`services/progress.py`, `core/mdc.py`):
  - the baseline is the mean of the first two sessions with the measure;
  - the change is in provisional MDC units, positive when better;
  - the status is improved, worse, no detectable change, or no baseline.
- **Endpoints:**
  - the patient's own series (`/api/patient/progress/metrics`);
  - the admin's metrics table (`/api/admin/patients/{id}/metrics`);
  - the session facts for the feedback module (`/api/sessions/{id}/facts`; [docs/session-facts.md](../session-facts.md));
  - the admin recompute (`/api/admin/metrics/recompute`);
  - two CSV exports.
- **Dashboards:**
  - **Admin Progress tab:** a Metrics section first. It has a table (measure, baseline, latest, change, change in MDC, status badge, sessions), a note that the MDC values are provisional, and a picker that draws any measure with its baseline dashed.
  - **Admin session page:** a Session metrics card, and a data-quality badge on each game run (Data OK, Tracking gaps, Measures differ, Not checked yet).
  - **Patient progress page:** five charts in plain words, each saying which way is better, with no codes or statistics: how far you can reach, time to reach a target, how smooth your movements are, game turns done well, how wide your hand opens.
- **Exports (admin only, by patient code):**
  - "Export metrics (CSV)" on the patient page: that patient's session measures, one row each.
  - "Export all trials (CSV)" on /admin/research: every trial with its settings, outcome, server measures and data quality.
- **Smoke test:** after the session ends, it checks the session metrics, the admin's metrics table, the facts (no name or email) and both exports.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first. numpy and scipy are new: install them.

```powershell
cd server; .venv\Scripts\python.exe -m pip install -r requirements.txt

# From the repository root: every check, with PASS or FAIL and a summary
.\scripts\check.ps1

# Or one at a time
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a running server (start it first in another terminal)
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# Server measures for sessions saved before today (prints a report)
cd server; .venv\Scripts\python.exe scripts\backfill_metrics.py

# Demo data, now with server measures
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py
```

- **Docker:** rebuild the server image (`docker compose up --build`) so it has numpy and scipy. The compose files mount `shared/` for the catalogue.
- **Manual checks:** follow the checklist in [the test report](day-11-test-report.md#manual-checklist).

## Decisions

- **The server recomputes only what the trajectory holds.**
  - Spatial games get K5–K10.
  - Paint the wall, Bloom, Finger piano and Grip and hold measure elbow angles, hand shape and grip level, which are not saved as trajectories. Their browser figures are checked against the schema and copied.
- **Onset and peaks use a filtered speed.** The trajectory is resampled to 60 Hz and filtered at 6 Hz first. Path measures use the RAW points; SPARC uses the RAW speed, as the web app does.
- **Mismatches are expected.** The browser's reaction time starts at the first point above 0.15 SW/s, while the server's needs 50 ms above it on a filtered speed. Both values are kept, and the server's are used for session measures.
- **The browser's value is a fallback only where the server did not compute a measure.** A server value of None (no movement onset found) stays None, rather than mixing two definitions.
- **The baseline is the first two sessions that have the measure,** so a game added later still gets one. A change is judged only from the third such session.
- **The MDC values are placeholders, marked PROVISIONAL** in `core/mdc.py`, in every admin table row and in the UI note. Patients never see MDC or statuses.
- **The facts are deliberately small:** codes, numbers, short labels and at most 8 measures.
  - The order is improved and worse first, then key unchanged ones.
  - Never a name, an email or the free-text comment.
- **Exports are pseudonymous** (patient codes), with `is_demo` so demo data can be filtered out.
- **A failure never fails the patient's request.** Recomputing when a run or a session ends logs failures; an admin can recompute later.

## Known issues

**Needs confirming**

- **The MDC values are placeholders** until they are measured from repeated sessions (Day 19). Until then, "improved" and "worse" are only rough guides.
- **Directions in the facts have no minimum trial count.** With 2–3 Reach and squeeze trials per direction, one miss can make a direction "weak".
- **New Bangla text** needs a native speaker's review.

**Behaviour to improve**

- **Sessions that expire** (left open past two hours) are not given session measures automatically. Run the admin recompute, or the backfill with `--session-id`.
- **Weeks in the facts' adherence are UTC weeks.** The facts endpoint has no time-zone offset.
- **The patient progress page no longer shows the warm-up goals chart** (it still shows on the dashboard).

**Technical debt**

- **The main JavaScript file is about 1,376 kB** (398 kB gzipped) and still needs splitting by route.
- **The seed tests take about a minute,** as seeding now recomputes every demo trial.
- **React screens still have no automated tests;** the pure logic behind them does.
- **`httpx` deprecation warning** from Starlette's test client.

## Day 12 preview: AI adaptive difficulty (L1) and safety

- **L1 parameter provider:** behind the same interface as FixedProvider. Each game's difficulty settings move within the ranges of `shared/game-specs.json` and the admin's limits, aiming at a target success rate from the recent trials (for example a staircase or a simple Bayesian update).
- **Safety rules first:**
  - difficulty only rises when the patient is succeeding without compensation;
  - it eases after pain or fatigue flags, or when compensation rises;
  - it never jumps more than one step at a time.
- **Every decision logged** with its reason, for the admin and the research exports.
