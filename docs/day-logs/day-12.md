# Day 12

**Adaptive difficulty with a safety layer, and the project's identity.**

- **Difficulty:** each game's difficulty now follows the patient, trial by trial. An L1 staircase sets it, a safety layer always has the last word, and every decision is logged with its reason.
- **Identity:** the platform became **MuVi Rehab**, with a research landing page, an About page and one source for its identity.

## What was built

- **Engine core** (`server/app/engine/`, [docs/ai-engine.md](../ai-engine.md)):
  - every adaptable setting of the nine games belongs to a component (spatial, activation, speed, precision); one d (0–1) per component maps to the settings within their spec bounds;
  - the starting d reproduces the admin's defaults;
  - the level shown to patients is 1–10;
  - **L0** gives fixed settings; **L1** is a transformed up-down staircase (Levitt 1971), +0.06 after 2 successes and −0.08 after a failure, routed by failure type;
  - a warm restart of −0.05 once per session and game;
  - **L2** is selectable and behaves like L1 until Day 13;
  - state per patient, game and engine (`EngineState`);
  - the patient profile's `engine_mode` (L1 by default) and `max_difficulty` per game.
- **Safety layer** (`engine/safety.py`), after every decision, in order:
  1. hard bounds;
  2. compensation (no harder reaches; posture cue);
  3. 3 failures in a row (−0.15; encouragement);
  4. tiring: the last 5 trials against the first 5, at most once per 5 trials (−0.1; rest);
  5. session time (finish soon after 25 minutes, finish after 35, set by environment variables).
- **Decision log** (`AdaptationLog`) and `POST /api/engine/next`: one row per call, the same answer for a repeated trial, under 100 ms.
- **Web:**
  - every game uses the server engine through `RemoteProvider`: it never waits more than 300 ms and keeps the previous settings without an answer;
  - trials report their failure type;
  - the level appears in the game's top bar, with gentle level messages, cues and a rest overlay;
  - "Level reached: X (started at Y)" on the results screen and the summary.
- **Admin:**
  - an Adaptation panel per run: difficulty per component and level per trial, success and failure markers, safety flags and a decisions table;
  - an "AI levels" card per patient;
  - `GET /api/admin/patients/{id}/levels`;
  - `level_start` and `level_end` in the summary and the session facts.
- **Demo data:** every demo trial is replayed through the engine. Rahim's levels climb over his later sessions; Salma shows compensation and tiring overrides.
- **Identity:**
  - `web/src/config/project.ts` holds the name, tagline, research title, KUET and UQ, supervisors and team, and the version;
  - a logo mark with a generated favicon, tab title and meta description;
  - the admin System page;
  - every visible "MotionLab" renamed, guarded by tests.
- **Landing page:** navbar, hero with an animated EMG preview, stats, how it works, nine illustrated games, research, team photos, collaboration, privacy and safety, call to action and footer.
- **About page**, plus the credit line in the admin and patient footers and on the login page, with the login page's logos.
- **Review (task 8):** the fixes listed under "Fixed" in the [test report](day-12-test-report.md#fixed-in-this-review); new tests for every engine guarantee; five engine steps in the smoke test; [docs/ai-engine.md](../ai-engine.md); the API contract and changelog.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first. No new packages.

```powershell
# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a running server (start it first in another terminal)
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# Demo data with engine states and decision logs (about 10 s)
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py
```

- **Database:** the server creates the two new tables and adds the two profile columns on start; existing data is kept.
- **Your local `server/.env`:** it still says `APP_NAME=MotionLab` and `ADMIN_NAME=MotionLab Admin`; change both to MuVi Rehab. The admin's name in an existing database stays until that user is renamed.
- **Manual checks:** follow [the checklist in the test report](day-12-test-report.md#manual-checklist).

## Decisions

- **Components, not settings.** One d per component keeps the engine small and explainable ("spatial a little harder"), and lets failures point at the right kind of difficulty.
- **Asymmetric staircase.** 2 successes up, 1 failure down, with a larger step down: about 75% success in simulation, and quick relief after a failure.
- **Safety after the engine, in a fixed order,** each override written down. The engine cannot see or undo the rules.
- **The first trial uses the admin's defaults exactly.** The run is created after the countdown, so the engine starts from the second trial.
- **Patients never see "AI" or the reasons**, only a level and gentle cues; admins see everything.
- **L0 is truly fixed:** no warm restart and no easing, so the level stays steady; the safety cues still come.
- **Identity in one file;** the code name "MotionLab" stays in identifiers (storage keys, package names, the database file).
- **Team photos are square crops** (11–41 KB) of the originals, made with Windows' built-in imaging; no image library.

## Known issues

- **No admin controls yet** for `engine_mode` and `max_difficulty`: they are stored per patient but can only be changed in the database.
- **The tiring rule fires often on the demo data** (noisy synthetic outcomes); its thresholds need tuning on real sessions.
- **Demo levels:** both demo patients fall from the default level 5 in their first sessions, because demo outcomes do not depend on difficulty; Rahim's levels then rise.
- **Approximate starting values:** components with several settings reproduce the admin's defaults only approximately (for example dwell 500 → 550 ms); the first trial of each run uses the defaults exactly.
- **No printable reports yet;** the Day 15 feedback reports should take their header from `project.ts`.
- **Bundle size:** the main web bundle is about 1.47 MB (419 kB gzipped); the build warns about chunks over 500 kB.

## Day 13 preview: L2 model-based adaptation (proposed)

- An L2 engine behind the same interface: a per-component estimate of the patient's ability, choosing the difficulty predicted to give the target success rate.
- The same safety layer and decision log, and comparison with L1 on the demo data.
- Admin controls for a patient's engine mode and maximum difficulty.
