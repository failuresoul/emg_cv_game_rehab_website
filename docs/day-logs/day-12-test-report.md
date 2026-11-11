# Day 12 test report (adaptive difficulty and project identity)

Date: 2026-11-11. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 1,181 passed (103 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with the chunk size warning (1,468 kB, 419 kB gzipped) |
| `pytest` | 758 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **99%** of 5,234 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 55 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/engine/difficulty.py` | 96% (two defensive branches) |
| `app/engine/base.py`, `l0_fixed.py`, `l1_staircase.py`, `safety.py`, `trial_summary.py` | 100% |
| `app/services/engine_store.py`, `levels.py` | 100% |
| `app/services/adaptation.py` | 99% (the re-raise when a duplicate's stored row is missing) |
| `app/api/engine.py`, `app/schemas/engine.py` | 100% |
| `scripts/seed_demo_data.py` | 99% |

## Engine requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Settings never leave the spec bounds | pytest: `test_random_play_never_leaves_the_spec_bounds_or_the_maximum` | PASS | Every game, 120 random trials (all outcomes, random compensation, times and peaks), safety applied, every setting checked after each trial |
| d never exceeds the patient's maximum | pytest: same test at maxima 1, 0.6, 0.25 and 0; `test_never_above_the_patients_maximum` (API) | PASS | |
| Safety runs after the engine, in the documented order | pytest: `test_rules_apply_in_order_and_the_most_important_cue_wins` and one test per rule | PASS | Order: bounds, compensation, repeated failure, tiring, session time |
| Every engine call writes one log row | pytest: `test_every_engine_call_writes_exactly_one_log_row`; smoke test | PASS | A repeated trial writes nothing |
| The same trial twice at once | pytest: `test_the_same_trial_reported_twice_at_once_gives_one_answer` | PASS | Fixed in this review |
| Games never wait more than 300 ms | Vitest: `keeps the previous settings after 300 ms without an answer, never blocking`; pytest: `test_fast_enough_for_every_trial` (every call under 100 ms) | PASS | `nextParams()` never awaits the server |
| A late answer from an earlier run is ignored | Vitest: `ignores a late answer from an earlier run and starts the next run fresh` | PASS | Fixed in this review |
| Warm restart once per session per game | pytest: `test_the_warm_restart_happens_once_per_session_and_game`, `test_state_is_kept_between_trials_and_eased_between_sessions` | PASS | |
| L0 patients get exactly the admin's defaults | pytest: `test_l0_patients_get_exactly_the_admin_defaults_and_a_steady_level`, `test_l0_has_no_warm_restart` | PASS | Level steady and no override; cues still sent. Fixed in this review |
| L1 settles near the target success rate | pytest: `test_a_simulated_patient_settles_between_60_and_80_percent` | PASS | About 75% |
| Patients never see "AI" | Vitest: landing and About page tests; the game shows only "Level" and cues | PASS | The admin card is titled "AI levels" (admins only) |

## Identity requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| No visible "MotionLab" | Vitest: `branding.test.ts` (translations, JSX text and attributes, `index.html`) | PASS | Internal identifiers keep the code name |
| Every name, title, photo and logo from `project.ts` | Vitest: `identity comes only from project.ts` (all code outside `project.ts`, comments excluded) | PASS | New in this review |
| No version on public pages | Vitest: landing and About pages | PASS | Only the admin System page shows it |
| Missing images fall back | Vitest: initials for photos; names (or KUET, UQ) for logos; `assetExists` treats the app page served for a missing file as missing | PASS | A failed load also falls back |
| Headings in order, no level skipped | Vitest: landing and About pages | PASS | One `h1` each. New in this review |
| Alt text and labels | Vitest: every `<img>` has alt text; every `role="img"` has a label | PASS | Photos "Photo of {name}", logos the institution's name |
| Focus visible | Code review: global `:focus-visible` outline in the accent colour; white outline on the dark call-to-action and footer | PASS | **MANUAL:** tab through both pages |
| Contrast (WCAG AA) | Calculated for every text colour on its background | PASS | Fixed the "Collaboration" label on the teal card (about 3.6:1 → over 4.5:1); accent-coloured text uses #A84B18. **MANUAL:** a browser contrast check |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| L0 patients' stored difficulty drifted down (warm restart, safety easing), so their level moved while their settings did not, and the log claimed easing | Medium | Fixed: engines declare `adapts`; L0 has no warm restart and no easing |
| The same trial reported twice at once could fail with a database error, and the state was saved separately from its log row | Low | Fixed: one transaction; a duplicate returns the stored answer |
| The compensation rule could restore a spatial d above a maximum lowered mid-session | Low | Fixed: never above the maximum |
| The web provider would apply a late answer from an earlier run, and ignore a new run's first answers | Low (one provider per game today) | Fixed: answers carry their run |
| The "Collaboration" label on the teal card was below AA contrast | Low | Fixed |
| No admin controls for `engine_mode` and `max_difficulty` | — | Known issue: a feature, not added in a review |
| The tiring rule fires often on synthetic demo data | — | Known issue: tune on real sessions |

## Fixed in this review

- **L0 is truly fixed:** no warm restart and no easing.
- **One transaction:** the state and the log row are saved together, and a duplicate trial returns the first answer.
- **Compensation and the maximum:** the rule never restores above the maximum.
- **Late answers:** the browser ignores answers from an earlier run.
- **Contrast:** the "Collaboration" label now passes AA.
- **New tests:**
  - server: 9, in `test_engine_review.py`;
  - web: 1 for the provider, 2 for identity sources, 2 for headings and labels.

## Smoke test against a live server

Not run in this review; run it yourself:

```powershell
# Terminal 1
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
# Terminal 2
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 55 lines starting with PASS, then "All steps passed", exit code 0. The new steps:

- `PASS  Patient starts a second session for the adaptive engine`
- `PASS  Engine: 12 successes raise the level, 8 failures lower it`
- `PASS  Engine: a decision is logged at the start and after each trial`: 21 rows, the start (trial 0) and each of the 20 trials
- `PASS  Engine: quick successes then slow failures ask for a rest`
- `PASS  Patient ends the second session`

## Manual checklist

Start the server and the web app ([How to run](../../README.md#how-to-run)). Seed the demo data first: `cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py`. Log in as a patient with engine mode L1 (the default for every patient).

### Adaptive difficulty (patient)

- [ ] **Level up:** play Reach and squeeze and succeed several times in a row. The top bar shows "Level N"; after a few successes the level rises, with "Nice — a little more challenge" (at most one such message every 30 seconds); the targets get farther, smaller or need a firmer squeeze.
- [ ] **Level down:** fail a few reaches on purpose (stay still until the time runs out). The level falls ("Let's make it a bit easier") and the next targets are easier. After 3 failures in a row an encouraging message appears ("That's fine. Take your time…").
- [ ] **Posture cue:** lean your trunk towards the target on 2 of 3 reaches. The reminder "Keep your back against the chair" appears, and the reach distance stops increasing.
- [ ] **Fatigue rest overlay:** play 5 quick successful turns, then 5 slow or failed ones. After the tenth turn the rest overlay ("Time for a short rest", 30 seconds with a breathing circle) appears and the game pauses until you press Continue; the next turns are easier.
- [ ] **Session-time banner:**
  1. Stop the server and set `SESSION_FINISH_SOON_MIN=1` and `SESSION_FINISH_MIN=2` in `server/.env`, then start it again.
  2. Play for over a minute: the banner "A few more and then we finish" appears.
  3. After two minutes of play, the game finishes by itself and shows the results.
  4. Put the values back to 25 and 35 afterwards.
- [ ] **Backend-offline fallback:** start a game, then stop the server. The game keeps going with the last settings, without freezing or an error screen. The browser console shows "Keeping the previous settings: no engine answer…". Start the server again.
- [ ] **Results and summary:** the results screen shows "Level reached: X (started at Y)", as does the game's card in the session summary. The word "AI" appears nowhere.

### Adaptive difficulty (admin)

- [ ] **Adaptation chart:**
  - Open one of Salma's sessions (Admin → Patients → Demo Salma → Sessions); each game card has an Adaptation panel.
  - The panel has coloured lines for each component, a dashed level line with filled (success) and hollow (failure) dots, coloured vertical flags for compensation and tiring, and a decisions table.
  - The table lists each trial, its level, the decision, any safety override and the cue.
- [ ] **AI levels card:** on Demo Rahim's Overview tab, "Staircase (L1)", a level per game ("N of 10"), the trials learned from and when.

### Landing page

- [ ] **Desktop (1280 px or wider):**
  - The navbar is transparent at the top and turns white with a blur after scrolling.
  - The hero has the dark game preview and a gently moving EMG trace.
  - The sections come in order: stats, how it works (with a dashed line joining the steps), games (cards lift on hover), research, team, collaboration, privacy and safety, call to action, dark footer.
- [ ] **Tablet (768 px):**
  - The hamburger menu opens and closes, and Escape closes it.
  - Games show in two columns; the hero is stacked.
- [ ] **Phone (360 px, DevTools):**
  - No horizontal scroll anywhere; the stats show in two columns; the collaboration logos fit.
  - "Log in" is in the menu.
- [ ] **Reduced motion:** with "Emulate prefers-reduced-motion: reduce", the EMG trace stays still.
- [ ] **Team photos:**
  - The photos appear in circles: teal rings for Dr. Akhand and Dr. Awal, orange rings for Shadik and Nafis. The faces are framed, not cut off.
  - Dr. Akhand shows "Professor, Dept. of CSE, KUET"; Dr. Awal shows "Postdoctoral Fellow, The University of Queensland".
- [ ] **Logos:** the KUET and UQ logos appear in the hero badge, the research card and the collaboration banner, not stretched; the footer writes "KUET × UQ" as text.
- [ ] **Missing file:** rename `web/public/team/nafis.jpg` for a moment and reload: initials "NA" appear, not a broken image. Put it back.
- [ ] **Keyboard:** Tab from the top. "Skip to the content" appears first, then every link and button shows a visible outline.

### About page, login and credit line

- [ ] **About page:**
  - Open `/about` from "About" in the navbar and from "About the project".
  - It shows the research title, background, the system with "Coming soon" on reports, the team with photos, the collaboration, privacy and data handling, and the not-a-medical-device notice.
  - There is no version number anywhere.
- [ ] **Login page:** the mark, "MuVi Rehab" and the tagline at the top; the credit line and both small logos under the form.
- [ ] **Credit line:** "MuVi Rehab · Dept. of CSE, KUET · in collaboration with The University of Queensland" at the foot of admin and patient pages; none during a session.
- [ ] **Browser tab:** the new mark as the favicon, and the title "MuVi Rehab — EMG & vision rehabilitation".
- [ ] **No "MotionLab" visible:** look through the landing and About pages, login, the patient pages and a session, the admin pages including System, and the page in Bangla.
