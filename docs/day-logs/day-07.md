# Day 7

**Release v0.1.0.** The whole session works from login to summary, with progress dashboards, safety alerts, demo data and release docs.

## What was built

- **Cool-down and safety flags:**
  - The cool-down is a minute of guided rest, then a questionnaire with very large controls: pain 0–10 with faces, tiredness 0–10, enjoyment 1–5 stars, difficulty, "something new or unusual" and a comment. It is stored as `SessionFeedback` (field names fixed for the LLM module).
  - Rules in `server/app/services/safety.py` (thresholds to be confirmed with the supervisor):
    - pain 4 or more → `pain`;
    - new symptoms → `new_symptoms`;
    - tiredness 8 or more → `high_fatigue`.
  - Any flag sets `needs_review`. For pain or new symptoms, the summary shows a fixed safety notice.
  - Admins see open alerts on the overview and mark them reviewed with a note. `open_alerts` is now a real count.
  - The routes are `/api/sessions/{id}/questionnaire`, not `/feedback`, which stays reserved for the teammate's LLM module.
- **Summary and dashboards:**
  - `GET /api/sessions/{id}/summary` returns active time, warm-up, games, reach, questionnaire and flags, with the previous figures for comparison.
  - `GET /api/patient/progress` (and the admin version) returns the streak, sessions this week, a 28-day calendar, per-session trends, and the first and latest reach, all in the patient's local days.
  - The summary page shows "Well done", a figure card per section with a rule-based better / same / lower line, a card per game, and the reach map with last time dashed.
  - The patient home has a streak, a weekly goal ring, a 4-week calendar and three trend charts. The Progress page shows the same charts larger, plus first versus latest reach.
  - The admin patient overview has a Practice section with an editable weekly goal, the streak, this week and the last session.
- **A robust session flow:**
  - `Session.current_step` and `game_queue`, saved with `PATCH /api/sessions/{id}/progress`.
  - A refresh lands on the same step: the warm-up continues at the first unfinished exercise, the games at the current game, and the summary shows the finished session.
  - "Continue your session" or "Start over" on the home page, and when a session page is not the saved step.
  - A step bar in the session header, and Exit from any step, including the game's pause dialog.
  - `stopSession()` stops game loops, the camera and speech on every way out. The camera is reference-counted.
  - An error page, an offline banner and readable error toasts.
- **Demo data:** `server/scripts/seed_demo_data.py` creates Demo Rahim and Demo Salma, with 6–8 completed sessions each over 14 days. The data comes from a fixed seed, and `--clear` removes only demo patients. The admin list shows a Demo badge.
- **Release:**
  - Version 0.1.0 in `web/package.json`, the API and `/api/health`.
  - `scripts/check.ps1` runs every check plus the smoke test against a temporary backend.
  - The smoke test now covers the cool-down pain flag, alerts, review, progress and the summary.
  - Backend coverage with `pytest-cov`.
  - New docs: `CHANGELOG.md`, the patient guide, the admin guide and the demo script.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```powershell
# From the repository root: every check, with PASS or FAIL and a summary
.\scripts\check.ps1

# Demo data, from server/ with the virtual environment active
python scripts/seed_demo_data.py
```

- **Manual checks:** follow the checklist in [the test report](day-07-test-report.md#manual-checklist).
- **Demo:** follow [the demo script](../demo-script.md).

## Decisions

- **Questionnaire route:** `/api/sessions/{id}/questionnaire`, because `/feedback` is reserved for the LLM module ([API contract](../api-contract.md)).
- **Streak:** a day without a session yet today does not break the streak until the day is over. Only completed sessions count. Weeks start on Monday, in the patient's local time zone (`tz_offset_minutes`).
- **Better / same / lower:**

  | Figure | Counts as "the same" when |
  | --- | --- |
  | Warm-up goals reached | exactly equal |
  | Reps and reach area | within 5% |
  | Game success rate | within 5 percentage points |

  "Lower" is worded gently.
- **Game success rate** leaves out trials the patient stopped (`aborted`).
- **The session ends at the cool-down,** and the finished session's id is kept for the tab, so a refresh on the summary does not start a new session.
- **Toasts:** the global error toast leaves out:
  - first loads, which already show Try again;
  - 401 errors, which go back to the login page;
  - forms whose message is about a field;
  - background saves.
- **`pytest-cov`** was added to `server/requirements.txt` (approved for this release).

## Known issues

**Needs confirming**

- **Safety thresholds** (pain 4, tiredness 8) are provisional and must be confirmed with the supervisor.
- **The safety notice and all of today's Bangla text** need a native speaker's review.
- **No real person has played a full v0.1 session end to end yet.** The flow was checked with automated tests and the smoke test.

**Behaviour to improve**

- **A step saved just before a refresh** (within a fraction of a second) may not have reached the server, so the "Continue your session?" prompt can appear once.
- **Skipping several warm-up exercises** needs Show me, Got it and the countdown before Skip appears.
- **The keyboard switch (K)** is still per game and only in development builds.
- **Visiting a session page by address with no active session** starts a new session there, as before.

**Technical debt**

- **React screens still have no automated tests;** the pure logic behind them does.
- **The main JavaScript file is about 1,208 kB** (353 kB gzipped) and still needs splitting by route.
- **`check.ps1` is Windows-only;** the commands it runs work on any system (see the README).
- **`httpx` deprecation warning** from Starlette's test client.
