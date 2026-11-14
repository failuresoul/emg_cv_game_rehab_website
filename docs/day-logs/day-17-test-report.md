# Day 17 test report (programme, research mode, alerts, bilingual and accessible website)

Date: 2026-11-14. Nothing in this report failed at the end of the review. **MANUAL** means a person still has to check it; it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `pytest --cov=app --cov=scripts` | 1,301 passed, 1 warning (`httpx` deprecation); **98%** of 10,065 statements |
| `npm test` (Vitest) | 1,469 passed (133 files) |
| `npm run i18n:check` | 15 passed: key and placeholder parity, nothing left in English, no JSX text outside `t()` |
| Accessibility (`npx vitest run src/a11y`) | 32 passed: axe on 10 pages × 2 languages with 0 violations, contrast tokens (AA normal, AAA high contrast), display settings |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds; main chunk 573 kB (169 kB gzipped), down from 1,737 kB (485 kB) |
| `scripts/smoke_test.py` | 78 steps pass in-process under `pytest` (with the mock model); **not yet run against a live server** |
| `npm audit --omit=dev` | 0 vulnerabilities (9 moderate in development tools only: `minimatch` via the linters) |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/models/programme.py`, `app/api/engine.py`, `app/api/patient.py` | 100% |
| `app/api/admin.py`, `app/api/studies.py`, `app/schemas/programme.py`, `app/services/planner.py`, `app/services/studies.py`, `scripts/smoke_test.py` | 99% |
| `app/services/adaptation.py` | 98% |
| `app/api/games.py` | 97% |
| `app/services/alerts.py` | 96% |
| `app/services/programme.py` | 95% |

## Day 17 requirements

| Requirement | How checked | Result |
| --- | --- | --- |
| Programme limits enforced everywhere | pytest `test_programme.py`: the engine cap (API and engine store), planner games, count, minutes and lighter days, the patient's game list, the regular rest rule, the patient's view (warm-up exercises, preset, EMG site), a game outside the programme refused (new); Vitest: warm-up order, forced preset, EMG default; smoke step "The plan and the engine obey the programme" | PASS |
| Old profile fields migrated | pytest `test_profiles_from_before_day_17_get_a_programme_from_their_old_fields` (levels rounded down, old fields never read again) | PASS |
| Study conditions blinded | pytest: the session shows only `blinded`; plans identical across conditions; a study run's `engine`, and the engine answer's `engine`, `decision` and `safety_override` are empty for the patient (new); Vitest: the locked plan; the game always uses the server engine in a study session; smoke step "Two blinded study sessions play the two conditions" | PASS (fixed in this review) |
| Study conditions logged | pytest: each run and session stores the study and condition; the admin session detail and the decision log keep the engine; export rows per trial | PASS |
| Latin square and randomisation balanced | pytest `test_the_latin_square_is_balanced_for_position_and_carry_over`, `test_between_subject_randomisation_is_balanced_and_reproducible` | PASS |
| Alerts idempotent | pytest `test_alerts.py`: every generator run twice; migration twice; the unique cause key | PASS |
| No hard-coded strings | `npm run i18n:check` over every component (developer pages exempt) | PASS |
| Bangla font and formatting | Vitest: locales `en-GB`, `bn-BD-u-nu-latn`, `bn-BD` with Bengali digits; the font loads with Bangla; canvas text uses the Bengali font stack | PASS; **MANUAL** by eye |
| Display settings applied in games too | Code review: the HUD is in `rem` (scales with text size); the high-contrast tokens cover the session background; sounds off silences game audio (`isMuted`); the voice setting starts the warm-up and calibration voice; "reduce motion" now also removes the games' decorative effects (fixed in this review) | PASS; **MANUAL** by eye |
| Patients cannot reach admin routes or other patients' data | pytest `test_access_sweep.py` (new): all 52 admin routes, read from the app's own route list, answer 403 to a patient and 401 without login; all 9 patient routes with an id answer 404 for another patient's data | PASS |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| In a study session the patient's own API answers named the condition: a game run's `engine`, and every `/api/engine/next` answer's `engine`, `decision` and `safety_override`. The app never shows them, but they are visible in the browser's network tools | High (blinding) | Fixed: left out for study runs in patient routes; admins and the decision log keep them; tests added |
| A patient could start a game outside their programme, or one turned off in the Game Library, through the API (the app only hid it) | Medium | Fixed: refused with `403`; a study session allows the study's games; tests added |
| "Reduce motion" did not cover the games' decorative effects (Reach and squeeze's success burst, Bloom's sparkle) | Low | Fixed: both are left out with "reduce motion" |
| No single test proved that every admin route refuses patients | Low | `test_access_sweep.py` checks every route from the app's own route list; no fault found |
| The smoke test did not cover the programme, studies, the new alerts or the language switch | — | Seven steps added (78 in all) |
| The patient guide still described v0.1 (three games, no reports) | — | Updated, and written in Bangla |

## Smoke test against a live server

Not run in this review; run it yourself, with the mock model so the reports take seconds:

```powershell
# Terminal 1
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
# Terminal 2
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 78 `PASS` lines, then `All steps passed`, exit code 0. The new steps:

- "Admin sets a programme: three games, reach capped at level 3"
- "The plan and the engine obey the programme"
- "Admin records consent, creates a study and enrols the patient"
- "Two blinded study sessions play the two conditions"
- "The study's progress, results and export"
- "Three stopped sessions raise a device alert, which is resolved"
- "The patient switches to Bangla and their report follows"

## Manual checklist

Run the app (`cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload` and `cd web; npm run dev`) with a test patient and the admin.

### Programme limits

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | Admin → patient → Programme: turn off 6 games (keep three), set Reach and squeeze to level 3, games per session 2-3, minutes 12, rest every 3 minutes; Save with a reason | The dialog lists every change; the history shows them with your name and the reason | MANUAL |
| 2 | As the patient, start a session | The plan has only those games, 2 or 3 of them | MANUAL |
| 3 | Play Reach and squeeze, succeeding every time | The level shown never goes above 4 | MANUAL |
| 4 | Keep playing for 3 minutes | A rest screen appears | MANUAL |
| 5 | Programme: turn off two warm-up exercises and choose "Always gentle"; start a session | The warm-up has 4 exercises with gentle targets and no "easier" link | MANUAL |
| 6 | Programme: default muscle-sensor site "extensors"; turn on the sensor at setup | Extensors is preselected | MANUAL |

### Study flow

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | Admin → Research: record research consent for the test patient | The date is saved; the patient appears in the enrol list | MANUAL |
| 2 | New study: within-subject, L0 and L2, 1 session each, Grip and hold; enrol; Start study | Progress shows the order and "0 of 1" for each condition | MANUAL |
| 3 | As the patient, run two sessions | Both plans show only Grip and hold with "set for you"; the game looks the same in both (level shown, cues); nothing names the condition | MANUAL |
| 4 | DevTools → Network during a study game: look at `/api/engine/next` and `/games` answers | `engine` is `null`, `decision` is empty | MANUAL |
| 5 | Admin: progress, then Results, then Download | "Complete"; bars for both conditions; the CSV has the patient code only | MANUAL |
| 6 | Withdraw a participant of a second study; run a session as them | Their normal plan returns | MANUAL |

### Alerts workflow

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | As the patient, send a questionnaire with pain 6 and fatigue 9 | Admin → Alerts: High "Pain" and Medium "High fatigue"; the menu badge counts them; the overview card shows them | MANUAL |
| 2 | Acknowledge one with a note, then resolve it | Status changes; only "Resolve" is offered after acknowledging | MANUAL |
| 3 | Open the session; Mark reviewed | The other alert is resolved; the questionnaire card shows the note | MANUAL |
| 4 | Start and Exit three sessions in a row | A Low "Repeated device problems" alert | MANUAL |
| 5 | Filters: High only, by type, "Open and acknowledged"; the patient's Alerts tab | Each list follows | MANUAL |

### Bangla full session

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | As the patient, switch to বাংলা | The whole site in Bangla, with the Bengali font; the choice survives logging in elsewhere | MANUAL |
| 2 | Run a full session: setup, calibration, warm-up, three games, cool-down, summary | Every screen, message, cue and result in Bangla; no clipped Bengali marks; numbers in Latin digits | MANUAL |
| 3 | The summary's feedback report | Written in Bangla; read aloud only if the device has a Bangla voice | MANUAL |
| 4 | Profile → "Show numbers in Bengali digits", then look at home, Progress and a game HUD | Numbers in ১২৩ | MANUAL |
| 5 | `?pseudo=1` on the main pages (development build) | Note any overflowing button or card | MANUAL |

### Display settings

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | Profile → Extra large text | Text grows on every page and in the session; nothing clipped or overlapping | MANUAL |
| 2 | High contrast | Darker text and lines everywhere, including the session screens | MANUAL |
| 3 | Reduce motion (and, separately, the system setting) | No moving animations; no success burst in Reach and squeeze, no sparkle in Bloom | MANUAL |
| 4 | Sounds off | No beeps or chimes in the warm-up or games | MANUAL |
| 5 | Spoken instructions on (with a voice for the language) | The warm-up reads its instructions aloud | MANUAL |
| 6 | In a session, the top bar's Display button | The same settings in a dialog; changes apply at once | MANUAL |

### Keyboard-only navigation

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | On any page, press Tab once | "Skip to content" appears; Enter moves to the content | MANUAL |
| 2 | Log in, start a session and go through every step with Tab, Enter and Space only | Every control can be reached and used; the focus ring is always visible; after each step change the focus is on the new step | MANUAL |
| 3 | Open and close every dialog (Display, the programme save, alert notes) with the keyboard | Focus stays inside; Esc closes; focus returns to the button | MANUAL |
| 4 | Admin: patient list, programme sliders, studies, alerts table | All reachable and usable; sliders move with the arrow keys | MANUAL |
| 5 | With a screen reader (NVDA or Narrator): warm-up rep counts, game feedback, chart "View as table" | Each new rep and message is read; the table lists the chart's values | MANUAL |
