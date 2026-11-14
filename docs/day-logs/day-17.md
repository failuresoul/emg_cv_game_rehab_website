# Day 17

**The therapist's controls and a website for everyone.**
- Each patient has a programme that the AI, the planner and the warm-up obey.
- Research mode runs blinded, controlled comparisons of the engines.
- Every alert is in one place.
- The whole website works in English and Bangla, and meets accessibility checks.

## What was built

- **Task 1: per-patient programme** (`app/services/programme.py`, Admin → patient → Programme):
  - games and the highest level per game (the engine's cap d = level / 10);
  - minutes, games per session and rest frequency;
  - warm-up exercises and an "always gentle" preset;
  - engine mode, default muscle-sensor site, weekly goal and notes.
  - **Enforced by:** the safety layer, the planner, the patient's game list, a regular rest rule, the warm-up and the EMG step.
  - **History:** every change is kept, with the admin and a reason.
  - **Migration:** the profile's old `weekly_goal`, `engine_mode` and `max_difficulty` were copied in, with levels rounded down so a limit is never loosened.
- **Task 2: research mode** (`app/services/studies.py`, Admin → Research):
  - **Assignment:** within-subject designs use a balanced Latin square (Williams); between-subject designs use seeded permuted-block randomisation.
  - **Sessions:** each new session of an active participant plays the next condition and the study's locked games.
  - **Blinding:** the session is marked `blinded`, and the browser lets the server set the difficulty in every condition.
  - **Results:** progress, results with 95% CIs over participants, a pseudonymous export, and research consent on the profile.
- **Task 3: unified alerts** (`app/services/alerts.py`, Admin → Alerts):
  - **Types:** seven, each idempotent through a unique cause key.
  - **Workflow:** acknowledge and resolve with notes.
  - **Where:** counts on the overview, a badge in the menu, and a patient tab.
  - **Migration:** the questionnaire's flags were copied in.
- **Task 4: bilingual website:**
  - **Switch:** English / বাংলা, saved to the patient's profile.
  - **Formatting:** `en-GB` and `bn-BD`, Latin digits by default with a Bengali-digits setting, and Bangla line heights.
  - **Canvas text:** uses the Bengali font.
  - **Pseudo-localisation:** a development mode, `?pseudo=1`.
  - **Check:** `npm run i18n:check` covers key and placeholder parity, nothing left in English, and no JSX text outside `t()`.
- **Task 5: accessibility and consistency:**
  - display settings (text size, high contrast, reduce motion, sounds, voice), on the profile and in the session top bar;
  - skip links, and focus moved to the content on page and step changes;
  - chart table views and a colour-blind-safe palette;
  - admin breadcrumbs and sticky columns;
  - axe tests of ten pages in both languages;
  - lazy-loaded admin pages and games.
- **Task 6: review** (see [the test report](day-17-test-report.md#review-findings)):
  - the blinding leak is fixed;
  - games outside the programme are refused;
  - "reduce motion" now covers the games' decorative effects;
  - an access sweep test covers every route;
  - smoke test (78 steps), docs and guides.

## How to test

```powershell
# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run i18n:check; npx vitest run src/a11y; npm run lint; npm run build

# Smoke test against a live server with the mock model (two terminals)
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# The app
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
cd web; npm run dev
```

- **Database:** the new tables are created on start, the new columns added, and existing profiles and flagged sessions migrated:
  - tables: `patientprogramme`, `programmechange`, `study`, `studyparticipant`, `alert`;
  - columns: on the profile, session and game run.
- **Manual checks:** [the checklist in the test report](day-17-test-report.md#manual-checklist).

## Decisions

- **The programme is the single source** for the engine mode, the weekly goal and the level caps. The old profile columns stay in the database but are never read: older databases may have them as `NOT NULL` without a default.
- **Levels are rounded down** when migrating an old maximum difficulty (0.35 → level 3), so no limit is loosened.
- **Blinding is by behaviour, not only by hiding:**
  - in a study session the browser always asks the server for difficulty, so L0 looks like L1 and L2: the same level display, cues and messages;
  - the patient's own API answers never carry the engine or the decision text;
  - admins and the decision log keep everything.
- **One cause, one alert:** every generator writes a unique `cause_key`. A recheck, two requests at once, or a restart never duplicates an alert.
- **Questionnaire alerts keep the session's "reviewed"** in step, so the session page and older exports still show it.
- **Patients' language follows them** (profile); visitors' and admins' stays in the browser. Reports are written in the profile's language.
- **Bengali digits are opt-in:** many patients read Latin digits more easily.
- **The developer pages (`/dev/*`) stay in English;** they are not in production builds.

## Known issues

- **Bangla text:** every string, and `user-guide-patient.bn.md`, needs a native speaker's review. Overflow with the longer Bangla has been checked in code, not yet by eye (use `?pseudo=1`).
- **Large text and high contrast** are not yet checked by eye on every screen. Fixed-width spots (the landing preview cards, some canvas text) may not scale.
- **Colour contrast in the axe tests** cannot be measured in jsdom. The theme tokens are checked separately (AA and AAA), but not text on images or canvas.
- **Reduce motion** stops page animations and the games' decorative effects; the game movement itself (gameplay) is unchanged.
- **The engine's decision log** is in English in every language, as a research record.
- **A refresh during a muscle-sensor session** still loses the sensor calibration (from Day 16).
- **Study results** use completed sessions only; aborted study sessions are not counted for any condition.

## Day 18 preview

- **End-to-end tests (Playwright):**
  - a full patient session in English and in Bangla, with the camera and muscle sensor simulated;
  - the admin's programme, study and alert workflows;
  - keyboard-only runs;
  - real-browser axe checks, including colour contrast.
- **Usability test:**
  - a short scripted session with 3-5 volunteers (older adults where possible), in both languages;
  - tasks timed and observed, and the System Usability Scale afterwards;
  - findings turned into fixes.
