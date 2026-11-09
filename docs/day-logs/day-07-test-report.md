# Day 7 test report (release v0.1.0)

Date: 2026-11-10. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 731 passed (54 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,208 kB, 353 kB gzipped) |
| `pytest` | 447 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **98%** of 2,546 statements; every module 89% or more except `scripts/seed_demo.py` (79%) |
| `scripts/smoke_test.py` | 36 steps pass in-process under `pytest`; **all 36 pass against a live server** started by `check.ps1` |
| `scripts/check.ps1` | ALL PASSED (5 steps): backend tests with coverage 141 s, frontend tests 3 s, lint 8 s, build 7 s, smoke test 4 s; the temporary backend stopped and its files were removed |

### Coverage by area

| Area | Coverage | Lowest file |
| --- | --- | --- |
| `app/api` | 99% | `games.py` 96% |
| `app/services` | 97% | `patients.py` 89% |
| `app/schemas`, `app/models`, `app/core` | 99–100% | `core/db.py` 92% |
| `scripts` | 98% | `seed_demo.py` 79% |

## Day 7 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Questionnaire saved once, validated, own session only | pytest | PASS | 409 on repeat; strict numbers and booleans; comment 300 characters; 404 for another patient's session |
| Every flag rule and `needs_review` | pytest | PASS | Pain 3/4/10, tiredness 7/8/10, new symptoms, all three, and none for enjoyment or difficulty |
| Alerts list, review with note, `open_alerts` | pytest, smoke test | PASS | Newest first; `reviewed` filter; 409 on reviewing twice; 404 without a flag |
| Fixed safety notice for pain or new symptoms only | Vitest | PASS | `shouldShowStopNotice`; exact text in `en.ts` |
| Weekly goal, editable by admin | pytest, Vitest | PASS | 1–14, strict whole numbers |
| Progress: streak, week, 28-day calendar, series | pytest | PASS | Completed sessions only; local days with `tz_offset_minutes`; Monday weeks; stopped trials left out of success |
| Session summary with previous figures | pytest, smoke test | PASS | Never compares with later sessions; skips back to the last session that has the figure |
| Better / same / lower rules | Vitest | PASS | Count, 5% relative and 5-point share rules |
| Step and game queue saved, resume decisions | pytest, Vitest | PASS | 7 steps; index past the end; 409 for an ended session; step mapping and every resume case |
| Camera, game loops and speech stop on every exit | Vitest, code review | PASS / MANUAL | The stop registry, and the camera reference count; checklist items 5–7 |
| Readable error toasts | Vitest | PASS | A message for each kind of failure; 401 left out |
| Demo data valid and repeatable; `--clear` complete | pytest | PASS | Every generated object re-validated against the schemas; identical data on two runs; a real patient untouched |
| Version 0.1.0 | pytest, code review | PASS | `/api/health`, the FastAPI app and `web/package.json` |
| Loading, empty and error states; focus; button names | Code review | PASS / MANUAL | Summary without a session fixed; no icon-only buttons without a name; focus outline never removed |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| `.coverage` and `htmlcov/` were not ignored by Git | Running coverage | Added to `.gitignore` |
| The patient guide named two buttons wrongly | Checking every label against `en.ts` | Uses **Make it easier** and **Skip this exercise** |

## Manual checklist

Use Chrome with the server and web app running (see [How to run](../../README.md#how-to-run)), good, even light, and demo data created with `python scripts/seed_demo_data.py`. Record each result here.

| # | Check | Steps | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | Version | Open `http://localhost:8000/api/health`. | `"version": "0.1.0"`. | |
| 2 | Full session | As a test patient: Start session → camera check → calibration → all six warm-up exercises → three games → cool-down → summary. | The step bar follows each step; no errors. | |
| 3 | Cool-down and notice | Answer pain 5. | The summary starts with the fixed safety notice; pain 2 shows no notice. | |
| 4 | Summary | Look at every section. | Time spent moving, warm-up goals "n of 6", repetitions, a card per game, the reach map with last time dashed, "compared with last time" lines, and the "Your feedback" box. | |
| 5 | Refresh on every step | Press F5 on setup, calibrate, warm-up, plan, a game, cool-down and summary. | The same step each time, without a prompt; the warm-up carries on at the next unfinished exercise. | |
| 6 | Resume and Start over | Close the tab mid-warm-up and open `/patient`. | "Continue your session?" Continue returns to the warm-up; Start over makes the old session Aborted and opens Setup. | |
| 7 | Exit | Exit from setup, the warm-up, and a game's pause dialog. | Home each time; the browser's camera indicator goes off. | |
| 8 | Offline | DevTools → Network → Offline. | The yellow "You are offline…" bar; actions show a readable toast. | |
| 9 | Admin alerts | As admin: Overview → Alerts → Mark reviewed with a note. | The open-alerts count goes down; the session page shows the note. | |
| 10 | Weekly goal | Patient Overview tab → Change → 3 → Save. | The patient's ring shows "…/3". | |
| 11 | Demo data | Patients list; open Demo Rahim's Progress tab; log in as Rahim. | **Demo** badges; growing reach; streak, ring, calendar and rising trends. | |
| 12 | Keyboard and focus | Tab through a session. | The orange focus ring on every control. | |
| 13 | Bangla | Switch a patient to Bangla and repeat items 2–4. | Every new text is translated. | |
| 14 | `check.ps1` | From the repository root: `.\scripts\check.ps1`. | Five PASS lines and "ALL PASSED (5 steps)". | |
| 15 | Demo script | Rehearse [the demo script](../demo-script.md) once, including the backup plan. | About 10 minutes. | |
