# Day 10 test report (pick and place, grip and hold, game library)

Date: 2026-11-11. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 1,092 passed (92 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,351 kB, 391 kB gzipped) |
| `npm run export:specs` | Writes `shared/game-specs.json` (9 games); the Vitest check fails on a stale file (tried) |
| `pytest` | 565 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **98%** of 3,389 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 45 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/models/game_setting.py` | 100% |
| `app/schemas/game_setting.py` | 100% |
| `app/services/game_settings.py` | 100% |
| `app/services/game_measures.py` | 100% |
| `app/services/game_specs.py` | 98% |
| `app/services/progress.py` | 99% |
| `app/schemas/game.py` | 99% |
| `scripts/seed_demo_data.py` | 99% |
| `scripts/smoke_test.py` | 98% |

## Day 10 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Pinch on and off with hysteresis; no flicker at the threshold | Vitest | PASS | 0.25 and 0.35; jitter gives one pinch |
| Pinch point is the midpoint of thumb and index tips, in SW | Vitest | PASS | A full camera frame through the body frame |
| Personal pinch distance from the warm-up; keyboard pinch | Vitest | PASS | P key, repeats, blur and stop |
| Pick and place: placement inside the reach for both sides | Vitest, pytest | PASS | Four carries, four angles, three distances; demo data too |
| Grasp only near the object; carrying; release inside or outside; time-out | Vitest | PASS | A pinch already held asks to open first; lost frames never drop |
| Pick and place metrics and target | Vitest, pytest | PASS | Straight minimum-jerk carry: efficiency 1, SPARC below 0 |
| Grip and hold: the timer pauses outside the band | Vitest | PASS | Below and above the band; resumes where it was |
| Success, relax time-out, hold time-out, overshoots, steadiness, time in band | Vitest | PASS | `failed_phase` `hold` or `relax`; input source saved |
| Webcam note only with the webcam | Vitest | PASS | Not shown with the keyboard or EMG |
| Specs exported and checked | Vitest | PASS | Every default inside its range |
| Game settings: validation, reset, patient view hides disabled games | pytest | PASS | 26 tests; ranges, unknown settings and games, trials 5–40 |
| Plan and provider use the settings | Vitest | PASS / MANUAL | Data helpers tested; plan screen by hand |
| Default plan: Reach and squeeze, Balloon pop, Bloom, Pick and place, about 16 minutes | Vitest | PASS | |
| Results, summary and history for both games | Vitest, pytest | PASS / MANUAL | Measures tested on both sides; screens by hand |
| Admin session tables, reach map and time in band chart | Vitest | PASS / MANUAL | Columns and chart data tested; charts by hand |
| Admin Progress: carry time, steadiness and time to relax | Vitest, pytest | PASS / MANUAL | Series and chart points tested |
| Demo data for both games, improving over the sessions | pytest | PASS | Carry time, drops, steadiness, time in band |

## Review findings (task 5)

| Check | Result | Notes |
| --- | --- | --- |
| All nine games use the framework, provider and input layer only | PASS | Each reads `context.params.next()`, `context.getTracking()`, `context.activation` and `context.hand`. Imports from `@/input` and `@/vision` in games are pure helpers only (`ActivationDetector`, finger names, geometry) |
| GameSetting defaults are respected | PASS, **fixed** | The provider and the shell use the admin's defaults and trials. **Fixed:** settings refreshed mid-game could restart the game (see below) |
| Nothing reads the camera outside the vision engine | PASS | `getUserMedia` and the video element appear only in `vision/visionEngine.ts` |
| All strings via `t()` | PASS | Today's screens, charts and table headers use `t()`; the two canvas texts (Finger piano labels, Paint the wall counter) come from `t()`; the new games draw no text |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| If the admin changed a game's settings while a patient was playing it, the settings refreshed on the patient's next window focus (after 5 minutes) would restart the game with a new run | Code review | Each game keeps the settings it started with |
| Path trace and Paint the wall outcomes read "Reached and squeezed" on the admin session page | Review | Each game names its outcomes in its own words ("Followed well", "Stripe finished", "Placed", "Held and relaxed" …) |

## Smoke test against a live server

Not run in this review. Start the server, then in a second terminal:

```powershell
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 45 `PASS` lines and exit code 0, including:

- "Admin turns Bloom off and changes a Grip and hold default"
- "Patient's game settings follow the admin's"
- "Admin puts both games' settings back"
- "Patient plays a pick_place run with non-spatial targets"
- "Patient plays a grip_hold run with non-spatial targets"

Afterwards, `/admin/games` shows Bloom and Grip and hold exactly as before. Or run `.\scripts\check.ps1` from the repository root, which starts its own temporary backend.

## Manual checklist

Sit as for the warm-up, with the affected arm and hand in view. Do the warm-up (including thumb opposition and hand open-close) first, so the pinch and grip use your own values.

### Pick and place

1. **Start.** Tick only Pick and place on the plan.
   - Expected: a fruit and an open box inside your reach, a shelf along the bottom, and an open-hand cursor between your thumb and index tips.
2. **Grasp.** Move the hand to the fruit and pinch.
   - Expected: the cursor becomes a closed hand, the fruit follows the pinch, and a dashed ring stays where it started. "Carry it to the box and open your fingers."
3. **Place.** Carry the fruit over the box and open your fingers.
   - Expected: the rim glows yellow while over the box; on release the fruit sinks in, the lid flaps close slowly with a soft note, and the fruit appears on the shelf ("Placed 1").
4. **Drop.** Let go halfway.
   - Expected: the fruit goes back to its start with a soft plop and "It went back to its place. Try again when you are ready."
5. **Already pinched.** Reach the fruit with the fingers already pinched.
   - Expected: "Open your fingers first, then pinch the fruit"; nothing is picked up until you open and pinch again.
6. **Time-out.** Wait 15 seconds without placing.
   - Expected: "That's fine. Here is a new one."
7. **Directions.** Over four turns, carries go outward, inward, up and down.
8. **Keyboard.** Press K, then hold P.
   - Expected: you pinch at the fingertip cursor.
9. **Results.** Finish all 12 turns.
   - Expected: Objects placed, Drops, Average carry time.
   - The admin session page shows the trial table (reach, grasp, carry, drops, release error, outcome) and the objects (by outcome) and boxes (orange diamonds) on the reach map.

### Grip and hold

1. **Start.** Tick only Grip and hold.
   - Expected: a kite low over a meadow, a green zone in the sky, "Holds 0", and the note "Using hand closing — the muscle sensor will make this more precise".
2. **Hold.** Close the hand partly so the kite rises into the zone.
   - Expected: the zone brightens and the gold ring fills.
3. **Pause, not reset.** Squeeze too hard, or open the hand, so the kite leaves the zone.
   - Expected: the ring stops without emptying, then carries on when you come back.
4. **Relax.** After 3 seconds in the zone: "Now relax your hand" and a dashed line.
   - Expected: open the hand fully. The kite glows softly with a note, and "Holds 1".
5. **Relax missed.** Keep squeezing after the prompt.
   - Expected: "That's fine. Let your hand rest for a moment."
   - The admin page shows "Ran out of time: Relaxing".
6. **Keyboard.** Press K.
   - Expected: the note disappears; hold Space to fly the kite.
7. **Results.** Finish all 8 holds.
   - Expected: Holds completed, Steadiest hold (±%), Average time to relax.
   - The admin page shows the trial table, including the input source, and the time in the zone per hold.

### Game Library

1. **Open.** Open `/admin/games`.
   - Expected: the note "Per-patient programmes and AI limits come later", and nine cards, each with icon, name, what it trains, "Shown to patients" on and its turns.
2. **Edit defaults.** On Grip and hold, open "Edit defaults".
   - Expected: sliders with each range, "Lower is harder" or "Higher is harder", and the game's default. Relax level and rest time are listed as fixed.
   - Pick and place lists "Carry direction" as chosen by the game for each turn.
3. **Save.** Set the green zone size to 0.2 and turns to 10, and save.
   - Expected: "Grip and hold saved", a "Custom settings" badge and "Last saved".
4. **Turns check.** Type 3 in turns.
   - Expected: an error, and Save is disabled.
5. **Turn a game off.** Switch Bloom off and save.
   - Expected: "Hidden from patients".
6. **Patient view.** As a patient, start a session.
   - Expected: the plan has no Bloom, ticks Reach and squeeze, Balloon pop and Pick and place, and shows Grip and hold with 10 turns. Playing Grip and hold shows a narrower zone.
7. **Reset.** Use "Reset to defaults" on both games.
   - Expected: the badges go and the plan is as before.

### One session with all nine games enabled

1. **Plan.** Make sure every game is on in the Game Library. Start a session and open the plan.
   - Expected: nine games; Reach and squeeze, Balloon pop, Bloom and Pick and place ticked ("4 games · about 16 minutes").
2. **Play.** Tick all nine and play them in order (a few turns each is enough; End game moves on).
   - Expected: each game starts from the plan, its results screen leads to the next, and the last leads to the cool-down.
3. **Summary.** Finish the cool-down.
   - Expected: the summary lists all nine games with their figures, Pick and place and Grip and hold included. The history detail shows the same.
4. **Admin session page.** Open the session on the admin side.
   - Expected: nine run cards, each with its own table and chart.
5. **Admin Progress.** Run the demo data (`scripts\seed_demo_data.py`) and open Demo Rahim's Progress tab.
   - Expected: Hand games shows steadiness falling and time to relax falling; Movement quality shows carry time falling over the sessions.
