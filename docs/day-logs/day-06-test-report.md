# Day 6 test report

Date: 2026-11-09. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 683 passed |
| `npm run lint` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,150 kB) |
| `npx prettier --check src` | No problems |
| `pytest` | 314 passed, 1 warning (`httpx` deprecation) |
| `pytest` with coverage | **Not run.** `pytest-cov` is not in the agreed stack; waiting for approval to add it |
| `scripts/smoke_test.py` | Its 31 steps pass in-process under `pytest`; not yet run against a live server |

## Server

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Outcome `miss` accepted, alongside the other four | pytest | PASS | Every allowed outcome is uploaded in a test; `timeout` is still rejected |
| Per-game metrics accepted and range-checked | pytest | PASS | `peak_arm_elevation_deg` 0–180; lateral distance, overshoot ≥ 0; lateral efficiency 0–1; `side` only `out` or `across` |
| `summary.details` for game-specific figures | pytest | PASS | Numbers, short text, true/false and null; more than 20 keys, long text, nested objects and lists rejected |
| Finished games on every session list | pytest | PASS | Patient and admin lists and the patient's session detail |
| Smoke test covers three games | pytest | PASS | **Extended in this review:** a run each of `reach_activate`, `balloon_pop` and `fruit_catch`, 20 trials each in two batches with 10 `miss` outcomes in all; the admin detail must return 3 runs in order and 60 trials |

## Games

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Both new games use the shared framework | Code review | PASS | Same `GameDefinition`, shell, logger, trajectory recorder, compensation tally, target placement and drawing helpers as Reach and squeeze |
| Settings only from the parameter provider | Code review, Vitest | PASS | Each trial calls `context.params.next(trialNo)`; game tests check the logged settings are the provider's |
| No direct webcam or keyboard reading inside games | Code search, Vitest | PASS | Nothing under the three game folders reads the vision engine, key events, the camera or the clock; activation only through `context.activation` |
| RAW trajectories logged | Vitest | PASS | Game tests give the raw and smoothed fingertip different positions and check every saved point is raw (Balloon pop), and that catching follows the raw fingertip (Fruit catch) |
| Paused time excluded from timings | Vitest, code review | PASS | Game time stands still while paused; a balloon or fruit cut short is played again from the start with the same number and settings |
| Game loops stop and resources are released between games | Code review | PASS | Each game is a fresh shell: its animation loop, listeners, input source and logger stop on leaving, and the camera is stopped and started again (see Known issues in the day log) |
| No avoidable per-frame allocations in render loops | Code review | PASS | **Fixed in this review:** see below |
| Pop and catch logic | Vitest | PASS | Popping only after the balloon arrives, touch and touch-and-squeeze, retry after a weak squeeze, floating away; caught only if the basket covers the fruit at the line |
| Provider orders | Vitest | PASS | Nine balloon pairs per block; fruit sides alternate with three distances each; overlapping fruit get their own settings |
| Several games per session | Vitest (queue), Manual | PASS / MANUAL | Order, next game, saving and loading the queue, broken storage |
| Encouragement never repeats a message twice running | Vitest | PASS | 50 seeds × 40 trials |
| All strings via `t()` | Code search | PASS | No literal text in the new screens, labels or SVG |
| Real play with the webcam and the keyboard | Manual | MANUAL | Checklist below |
| Frame rate stays smooth | Manual | MANUAL | Checklist items 8 and 9 |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| The balloon sky and the garden made a new gradient every frame | Code review | Kept until the screen size changes |
| The reach target's glow made a new gradient every frame | Code review | Kept while the target stays where it is |
| The trial machines' `isLive` built a new array on every call (several times a frame) | Code review | A fixed set |
| Fruit catch rebuilt its list of fruit on every 60 Hz step | Code review | Counted in place; rebuilt only when a fruit finishes |
| Reach and squeeze rebuilt its trail on every step, and again for drawing | Code review | Old points dropped from the front; drawn straight from the body-frame points |

## Manual checklist

Use Chrome with the server and web app running (see [How to run](../../README.md#how-to-run)), a patient with a calibration, and good, even light. Record each result here. To use the keyboard, press **K** after the countdown starts **in each game** (it switches back to the webcam at every new game), then hold **Space** to squeeze.

| # | Check | Steps | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | Plan | Start session → camera check → calibration → warm-up → Today's games. Untick and tick a game; move one up and down. | Three games ticked, each with what it trains and "20 targets · about 4 minutes"; the total updates; Start is disabled with nothing ticked. | |
| 2 | Balloon pop with the webcam | Start with Balloon pop first. Play all 20. | Dusk sky with slow clouds, "Popped n" in the top bar. Balloons rise from below to three heights in three upward directions; touching one only works once it has stopped; popped balloons burst softly with a chime; a balloon left 7 seconds floats away with a calm message; up-and-out is on your affected arm's side. | |
| 3 | Balloon pop with the keyboard | Play another Balloon pop; press K after the countdown. | "Keyboard" badge. Popping works by touching as before (Space is not needed in touch mode). The run is saved with `input_source: keyboard`. | |
| 4 | Fruit catch with the webcam | Play all 20. | Evening garden, "Caught n". The basket follows your hand left and right but stops at the ends of your reach; fruit alternates sides; a fruit over the basket when it reaches the basket line is caught with a chime; otherwise it lands with a soft plop. | |
| 5 | Fruit catch with the keyboard | Play another; press K after the countdown. | "Keyboard" badge; the basket still follows your hand (the keyboard only stands in for squeezing). The run is saved with `input_source: keyboard`. | |
| 6 | Squeeze with K + Space | Play Reach and squeeze; press K after the countdown; reach each target and hold Space after the ring fills. | The squeeze ring fills in about 0.3 s and the target succeeds when it passes the white tick; releasing early lets the time run out with a calm message. (Balloon pop's squeeze mode cannot be chosen in the app yet; it is covered by automated tests.) | |
| 7 | Next game and results | Play with all three ticked. | After each game a results screen with score, "Targets reached n of 20" and the game's main measure; "Next game" leads to the next one; after the last, "Continue" leads to the cool-down. | |
| 8 | Pause and refresh | During Fruit catch, hide your hand for 3 seconds; switch tabs for 5 seconds; then refresh the page. | Paused with a message each time and carries on by itself; the falling fruit starts again from the top. After the refresh, Fruit catch starts again and "Next game" still follows your order. | |
| 9 | Frame rate | DevTools → More tools → Rendering → tick **Frame rendering stats**. Play at least 10 targets of each game. | The meter stays at or above 20 FPS in every game. Write the figures at the top of [day-06.md](day-06.md). | |
| 10 | Summary and history | Finish the session. Open History and the session. | Summary: time, warm-up goals, game score, and one row per game with score, "n of 20 (x%)" and its main measure. History: one section per game. | |
| 11 | Admin session page | As admin, open the session from Recent sessions. | One card per game. Reach and squeeze and Balloon pop: a reach map of targets ("Popped" / "Floated away" for balloons). Fruit catch: a strip of fruit positions with the shoulder, "Out" on your affected arm's side, "Caught" / "Not caught". Each with its own trial columns and a movement-time chart. | |
