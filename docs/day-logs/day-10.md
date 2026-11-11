# Day 10

**Functional games and the game library.**
- **Pinch:** a new input for games.
- **Pick and place:** reach, pinch to grasp, carry and release.
- **Grip and hold:** hold a steady grip in a band, then relax fully.
- **Game library:** lets the admin turn games on or off and set their starting settings.

All nine games are now built and appear on the plan, the results and summary screens, history, the admin pages and the demo data.

## What was built

- **Pinch input** (`web/src/input/pinch.ts`, `pinchSource.ts`):
  - **What it reports:** whether the thumb and index tips of the affected hand pinch, the pinch strength (0–1), and the pinch point. The point is midway between the two tips, in SW, RAW and smoothed.
  - **When it pinches:** a pinch starts below 0.25 palm lengths, or the patient's own distance from the thumb opposition warm-up, and ends only above that plus 0.1.
  - **Strength:** clamp(1 − distance / (threshold + 0.3), 0, 1).
  - **Events:** `pinchStart` and `pinchEnd` carry their times and RAW points.
  - **Keyboard (development):** hold P to pinch at the fingertip cursor.
  - **EMG:** EMG mode keeps the camera for the pinch.
  - **Where it appears:** in `useHandInput()`, the game context (`hand.getPinch()`, `hand.subscribePinch()`) and the Exercise Lab.
- **Pick and place** (`web/src/games/pickPlace/`, 12 trials):
  - **Placement:** a fruit and an open box sit inside the patient's RAW reach map, using the calibrated radii in each one's own direction. They are kept apart and on screen.
  - **Play:** move the pinch point to the fruit, then start a pinch on it to grasp it. The fruit follows the pinch. Opening the fingers inside the box places it: the lid closes with a soft note and the fruit joins the shelf. Letting go elsewhere drops it back to its start, counted as a drop, to try again until the time limit.
  - **Cursor:** an open or closed hand.
  - **Metrics (RAW pinch point):** reach time, grasp latency, carry time, carry path efficiency, drops, release error from the box's centre, carry SPARC and peak speed, and compensation.
  - **Provider:** carries go outward, inward, up and down in a shuffled order every four trials.
- **Grip and hold** (`web/src/games/gripHold/`, 8 trials):
  - **Display:** a kite flies with the grip level over a green band.
  - **Hold timer:** runs only inside the band; it pauses, not restarts, outside it.
  - **Relax:** after the hold, "Now relax your hand". The level must fall below 0.15 within 3 s.
  - **Outcome:** a miss stores the phase that ran out (`hold` or `relax`).
  - **Metrics:** time to the band, time in the band, longest hold, overshoots and the largest one, steadiness (standard deviation of the level in the band), time to relax and the input source.
  - **Webcam note:** while the grip comes from the webcam, the top bar notes that the muscle sensor will make it more precise. On Day 15 the same game reads EMG through the input layer.
- **Game specs:** `npm run export:specs` writes each game's id, labels, settings (min, max, step, default, which way is harder) and trials to `shared/game-specs.json`. It loads the registry through Vite, with no new library. A Vitest test fails when the file is out of date.
- **Game library** (backend):
  - **Table:** `GameSetting` holds, per game, whether it is enabled, its default overrides, its trials, notes and when it was updated.
  - **Checks:** the server reads `shared/game-specs.json` (or `GAME_SPECS_PATH`). An unknown game is `404`. A setting the game does not have, a value outside its range, or trials outside 5–40 is `422`.
  - **Routes:** `GET /api/admin/games`, `PUT /api/admin/games/{game_id}`, `POST /api/admin/games/{game_id}/reset`, and `GET /api/games/settings` for patients (enabled games only, with their effective defaults and trials).
- **Game library** (`/admin/games`):
  - **Cards:** one per game, with its icon, name, what it trains, an on/off switch and the number of turns.
  - **"Edit defaults":** opens a slider per setting, bounded by its range, showing which way is harder and the game's own default. Settings that are fixed, or chosen by the game for each turn, are listed but cannot be changed.
  - **Saving:** "Reset to defaults" and "Save" each confirm with a message.
  - **Later note:** "Per-patient programmes and AI limits come later."
- **Plan and games use the library:**
  - **Plan:** lists only the enabled games, with their turns and the time those take.
  - **Games:** start every trial from the admin's defaults and play the admin's number of trials.
  - **Default plan:** Reach and squeeze, Balloon pop, Bloom and Pick and place (about 16 minutes).
- **Both games everywhere:**
  - **Results, summary and history:** objects placed, drops and average carry time; holds completed, steadiest hold and average time to relax.
  - **Admin session page:** each game's trial table, the objects and boxes on the reach map, and time in the zone per hold.
  - **Admin Progress tab:** carry time (Movement quality), and steadiness and time to relax (Hand games), per session.
  - **Demo data:** improving carry time, drops, steadiness and time to relax.
- **Smoke test:** the admin turns Bloom off and gives Grip and hold a 5 s hold and 10 turns. The patient's settings follow, then both games' settings are put back as they were. Runs of both games appear in the summary, progress and admin session detail.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```powershell
# From the repository root: every check, with PASS or FAIL and a summary
.\scripts\check.ps1

# Or one at a time
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# The game specs: git should show no change to shared/game-specs.json afterwards
cd web; npm run export:specs

# Smoke test against a running server (start it first in another terminal)
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# Demo data with all nine games
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py
```

- **Manual checks:** follow the checklist in [the test report](day-10-test-report.md#manual-checklist).

## Decisions

- **The pinch point uses the games' own body frame.** Each pinch source keeps a `Tracker`, the same one that gives the fingertip cursor, so the pinch point and the cursor line up. The keyboard pinch uses the cursor itself.
- **Only a pinch that starts on the fruit grasps it.** A hand that arrives already pinched is asked to open first, so a fruit is never picked up by brushing past it.
- **A frame where the pinch cannot be measured changes nothing.** A lost camera frame never drops the fruit; the game pauses as usual when the hand is lost for longer.
- **A drop restarts the carry timing.** `transport_ms` and the carry measures are those of the carry that succeeded; `grasp_latency_ms` is the first grasp.
- **Fruit and box are kept apart.** If they would touch, the box moves out (up to the edge of the reach) and then the fruit in (down to 0.3 of it), both along their own directions. A very small reach keeps them as far apart as that allows.
- **Grip and hold's time in the band is a share of the hold phase only.** The relax phase is not counted. An overshoot ends only 0.03 below the band's top, so jitter at the edge counts once.
- **"Best steadiness" is the smallest standard deviation among the holds completed,** so a brief, failed hold is never the "steadiest".
- **Which defaults win:** a patient's own value from the warm-up (such as the touch distance) comes first, then the admin's default, then the game's own.
- **The admin saves only what differs from the game's own defaults and turns.** A later change to a game's own defaults therefore still reaches patients. A saved value that no longer fits a changed range is ignored.
- **Settings the admin cannot change** are those with a single value (fixed) and those that are not a difficulty, such as a target's direction, which the provider chooses each trial.
- **A game keeps the settings it started with.** Settings refreshed mid-game, after an admin change, never restart it.
- **If the settings cannot be loaded,** the plan offers every built game with its own defaults, so a session is never blocked.

## Known issues

**Needs confirming**

- **Neither new game has been played by a patient or a therapist yet.** These are first guesses to review with the supervisor:
  - Pick and place: the pinch threshold, the grasp reach and the box size.
  - Grip and hold: the band width and hold time.
- **Grip and hold from the webcam measures hand closing, not effort.** It is a stand-in until the muscle sensor (Day 15); the game says so on screen.
- **New Bangla text** needs a native speaker's review.

**Behaviour to improve**

- **The pinch is measured in 2D image space when world landmarks are missing.** A hand turned edge-on to the camera can make the thumb and index tips look closer than they are.
- **Pick and place pauses when the hand is lost,** as every game does. A brief loss of the hand in a long carry restarts the trial.
- **The game library has no history.** A setting is replaced when saved; who changed what and when is not kept beyond `updated_at`.

**Technical debt**

- **The main JavaScript file is about 1,351 kB** (391 kB gzipped) and still needs splitting by route.
- **React screens still have no automated tests;** the pure logic behind them does.
- **`httpx` deprecation warning** from Starlette's test client.

## Day 11 preview: the server metrics engine

- **Server-side metrics:** the server recomputes trial measures from the saved RAW trajectories and events, so measures no longer depend only on what the browser sends.
  - **Smoothness:** SPARC, the server's version, must reproduce `shared/test-vectors/sparc.json` to 1e-6.
  - **Reach measures:** reaction time, movement time, path length and efficiency, and peak speed.
- **Checks:** the browser's figures are compared with the server's, with differences flagged for review.
- **One place for session and progress figures,** ready for the adaptive engines (Days 12–13).
