# Day 5 test report

Date: 2026-11-09. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 586 passed |
| `npm run lint` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,114 kB) |
| `npx prettier --check src` | No problems |
| `pytest` | 296 passed, 1 warning (`httpx` deprecation) |
| `pytest` with coverage | **Not run.** `pytest-cov` is not in the agreed stack; waiting for approval to add it |
| `scripts/smoke_test.py` | Its 23 steps pass in-process under `pytest`; not yet run against a live server |

## Server

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Start a run; unknown `game_id`, engine or input source rejected | pytest | PASS | 422; starting on an ended session is 409 |
| Upload up to 50 trials; more than 50 rejected | pytest | PASS | 50 accepted, 51 and 0 rejected with 422 |
| Trials replaced by `trial_no` | pytest | PASS | Re-sending replaces the stored trial; a repeated number in one body is 422 |
| Trajectory capped at 2000 points | pytest | PASS | 2000 accepted, 2001 rejected; `NaN` rejected |
| Uploads to an ended or aborted run rejected | pytest | PASS | 409 |
| End a run with score and summary | pytest | PASS | Ending twice is 409 |
| Open runs aborted when a new run starts or the session ends | pytest | PASS | |
| Patients reach only their own sessions and runs | pytest | PASS | 404 for another patient's session or run; their run is untouched |
| Admin session detail with every trial and trajectory | pytest | PASS | Trials in `trial_no` order; 404 for an unknown session; 403 for a patient |
| Recent sessions for the admin overview | pytest | PASS | Newest first, `limit` 1–50, with finished games |
| Finished games on the dashboard and session lists | pytest | PASS | Runs still in progress left out |
| Smoke test covers a 20-trial run | pytest | PASS | **Extended in this review:** two batches of 10, then the admin detail must return trials 1–20 with their trajectories |

## Input layer

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Games read activation only through the input layer | Code search, Vitest | PASS | Nothing under `games/` reads hand measures or keys; the game test supplies activation through `context.activation` only |
| EMG source is a stub | Code review, Vitest | PASS | Never ready, always 0; marked "Implemented on Day 15" |
| Hand opening mapped to 0–1, clamped, with references from the warm-up | Vitest | PASS | Defaults 1.6 and 1.1 without a usable result |
| Keyboard ramps: 300 ms up, 200 ms down | Vitest | PASS | |
| Detector: hold, window, hysteresis, latency, peak | Vitest | PASS | |
| Real squeeze detection on camera | Manual | MANUAL | Checklist item 1 |

## Game framework and Reach and squeeze

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Settings always come from the parameter provider | Code review, Vitest | PASS | Each spawn asks the provider; the game test checks the logged settings are the provider's |
| Eight directions in a shuffled order every eight trials | Vitest | PASS | No repeat across a block boundary, over 200 seeds |
| Trials store the raw trajectory | Code review, Vitest | PASS | The game test gives the raw and smoothed fingertip different positions; every saved point is the raw one |
| Reach metrics from raw positions; straight path efficiency about 1 | Vitest | PASS | |
| Target placement, interpolation between directions, sectors, staying on screen | Vitest | PASS | Both affected sides |
| Trial states: enter, leave, dwell, squeeze success and failure, time limits | Vitest | PASS | |
| Paused time not counted in reaction or movement times | Vitest, code review | PASS | Game time stands still while paused; an interrupted trial restarts with a new spawn. **Fixed in this review:** camera frames from before a spawn are no longer saved with negative times |
| Fixed 60 Hz updates; play area fitted below the top bar | Vitest | PASS | |
| Countdown, auto-pause on hand loss and hidden tab, resume after 1 second | Vitest (runtime) | PASS | On screen: checklist items 3 and 4 |
| Game loop stops and the camera is released when leaving the page | Code review | PASS | The shell's cleanup cancels the animation frame and removes its listeners; the input manager stops its source; `useVision` stops the engine, which stops the camera tracks |
| Failed uploads retried and not lost while the page is open | Vitest (mocked axios) | PASS | 3 retries at 1, 2 and 4 s for network errors and 5xx; failed trials stay in memory and go with the next upload; a run is never ended while trials are unsent |
| All strings via `t()` | Code search | PASS | **Fixed in this review:** the game clock and countdown now use the language's own digits, as do trial numbers on the admin page |
| No video or images leave the browser | Code search | PASS | No new code reads image data; only landmarks, metrics and events are sent |
| Frame rate stays at or above 20 FPS during a game | Manual | MANUAL | Checklist item 7 |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| A camera frame captured just before a trial (re)started could be saved with a negative time | Code review | The trajectory recorder skips frames from before the spawn; test added |
| The game clock and the 3-2-1 countdown showed Latin digits in Bangla | Code review | Formatted with the language's digits (`formatClock`, tested) |
| The unsaved message said results were kept, though they are lost once the patient leaves | Code review | It now asks the patient to try saving again before continuing |
| No test ran the real game end to end | Review | Added a game test with a simulated context: settings, activation, raw trajectory, metrics, pause and a failed reach |

## Manual checklist

Use Chrome with the server and web app running (see [How to run](../../README.md#how-to-run)), a patient with a calibration, and good, even light. Record each result here.

| # | Check | Steps | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | 20-target game with the webcam grip | Start session → camera check → calibration → warm-up (do hand open-close) → **Start** on Reach and squeeze. Play all 20 targets by reaching and closing the hand. | "Webcam" badge. Each target appears inside your reach, mirrored like the camera view; the ring fills in about half a second; the squeeze meter rises as the hand closes and the target succeeds when it passes the white tick. Directions vary and none repeats immediately. Turn counter reaches "Turn 20 of 20". | |
| 2 | The same game with the keyboard | Start another game, press **K** during the countdown, then reach each target with the hand and hold **Space** to squeeze. | Amber "Keyboard" badge; the meter fills in about 0.3 s and empties in about 0.2 s; the page does not scroll. The run is saved with `input_source: keyboard` (check on the admin page, item 6). | |
| 3 | Pause on hand loss | During a reach, put the hand down out of view for 3 seconds, then bring it back. | After about half a second, "Paused" with the hand message and no Resume button needed. About a second after the hand is back, play carries on with the same turn number, and that turn's target appears again from the start. The timer did not count the pause. | |
| 4 | Pause on tab switch | During a reach, switch to another tab for 5 seconds, then come back with the hand in view. | "Paused" with the "another screen" message; it carries on by itself about a second later. The timer did not count the time away. | |
| 5 | Results screen | Finish the 20 targets (or Pause → **End game** for a shorter check). | Chime, then score, "Targets reached n of 20", average reach time in seconds, "Saved", and **Continue** → Time to rest → **Finish session** → summary with time, warm-up goals and game score → **Back to home**. Home shows the Last session card with the score and success rate. | |
| 6 | Saved trials on the admin page | As admin, open the overview → Recent sessions → this session. | Header with patient, date, duration and device. Reach map with a marker per target (green circle, amber square, blue diamond; ring if compensated). Trials table with 20 rows, sectors like `D3R2`, reaction and movement in ms, path efficiency 0–1. A bar chart of movement time per trial. A deliberately missed target shows as an amber square and a gap in the chart. | |
| 7 | Frame rate during the game | Before playing, open DevTools → More tools → Rendering → tick **Frame rendering stats**. Play at least 10 targets. Afterwards, open `/dev/exercise-lab`, start the camera with two hands in view and read the FPS shown. | The on-page meter stays at or above 20 FPS throughout the game, and the Exercise Lab shows the detection rate at or above 20 FPS on the same machine. Write both numbers at the top of [day-05.md](day-05.md). | |
| 8 | Saving with the network off | During a game, turn the network off in DevTools (Network → Offline) for 15 seconds around turn 10, then back on. Finish the game. | "Saving…" then "Not saved yet…" while offline; the game carries on. After it ends online, "Saved"; the admin page shows all 20 trials. | |
