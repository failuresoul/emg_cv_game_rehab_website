# Day 5

**FPS measured during a 20-target Reach and squeeze game with a real webcam: ___**

## What was built

- **Games and trials on the server:** a game run per game played in a session, and a trial per target with its settings, target, outcome, timings, metrics, compensation and raw trajectory (up to 2000 points). Trials are uploaded in batches of up to 50 and replaced by trial number, so sending one again is safe. An admin route returns a whole session, every trajectory included, and another lists recent sessions. Session lists and the patient dashboard now carry each session's finished games. See the [API contract](../api-contract.md#games).
- **One input layer for activation** (`web/src/input/`): games read a level from 0 (relaxed) to 1 (full squeeze) and never know where it comes from. The camera source turns the affected hand's opening into that level, using this session's hand open-close warm-up as the open and closed references. A keyboard source (hold Space) is for testing, and in development builds K switches to it. The EMG source is a placeholder until Day 15. A pure activation detector decides whether a squeeze reached the demanded level, held for long enough, within the time allowed.
- **A shared game framework** (`web/src/games/shared/`): a full-screen canvas with the body frame fitted to the patient's reach (mirrored, below the top bar), fixed 60 Hz updates, a faint skeleton and a cursor, a 3-2-1 countdown, a pause when the hand is lost for half a second or the tab is hidden (carrying on one second after tracking returns), and a results screen. A trial logger uploads every 10 trials and at the end, retrying three times. A registry describes all nine games and their settings, and a fixed parameter provider (L0) gives each trial its settings, visiting all eight directions in a shuffled order every eight trials.
- **The first game, Reach and squeeze** (`reach_activate`): reach to a target placed at a share of the calibrated reach in one of eight directions, stay on it for half a second, then squeeze. Each trial records reaction time, movement time, path length and efficiency, peak speed, squeeze latency and peak, and any compensation, all from raw positions. A success scores 100 points plus up to 50 for speed; failures cost nothing.
- **The session flow:** a plan screen with Reach and squeeze, a cool-down step that ends the session as completed, and a summary with the session's time, warm-up goals and game score.
- **Dashboards:** a "Last session" card on the patient home page, a games table on each session's history page, and a new admin session page with the reach map and every target by outcome, the warm-up table, a trials table and movement time per trial. The admin overview lists recent sessions, and the patient's Sessions tab links to each session.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```sh
# From web/
npm test
npm run lint
npm run build

# From server/, with the virtual environment active
pytest

# With the server running, from server/
python scripts/smoke_test.py
```

- **The game:** log in as a patient, click **Start session**, go through the camera check, calibration and warm-up, then click **Start** on Reach and squeeze.
- **Manual checks:** follow the checklist in [the test report](day-05-test-report.md#manual-checklist).
- **Results:** see [the test report](day-05-test-report.md).

## Known issues

**Could change results**

- **No real person has played the game yet.** The state machine, metrics, uploads and pausing were tested with simulated input only. The [manual checklist](day-05-test-report.md#manual-checklist) is still to be done.
- **The squeeze level comes from the hand's opening on camera,** which is not muscle activity. A hand turned edge-on to the camera can look closed. EMG replaces it on Day 15.
- **Without a hand open-close warm-up result,** the squeeze uses fixed references (1.6 open, 1.1 closed palm lengths), which may be too hard or too easy for a given hand. The closed reference is the warm-up's low threshold, because the warm-up does not record how tightly the hand closed.
- **Entering and leaving the target are judged on the smoothed cursor,** so the enter time can lag the raw fingertip by a frame or two. All saved measures use the raw fingertip.
- **Reaction time is found to within about one frame** (33 ms), as speed is measured across two frames to ignore jitter.
- **The posture baseline for compensation is the first second of the game screen,** during the countdown. A patient who moves then gets a shifted baseline.
- **Targets near the top of the screen are moved down** to stay clear of the top bar. The saved target position is where it was drawn, but `distance_frac` keeps the intended value.

**Behaviour to improve**

- **A pause restarts the interrupted trial from the start,** so a patient who loses tracking often repeats the same target.
- **Losing the camera mid-game ends the game** as aborted. The trials played so far are saved.
- **Results that never saved are lost if the patient leaves the results screen.** They are kept while it is open, with a "Try saving again" button.
- **Refreshing the summary page after finishing starts a new active session,** because every session page starts or resumes one when it loads. The next Start session reuses it.
- **Space can still press a focused button** while the webcam is the input source. It only stops doing so once keyboard input is turned on.
- **The plan is a fixed list** until the planner arrives on Day 13.

**Technical debt**

- **No coverage report:** `pytest-cov` is not in the agreed stack, so coverage was not measured. See the [test report](day-05-test-report.md).
- **React screens still have no automated tests.** The game shell, plan, cool-down, summary and dashboard screens were checked by type checking and by hand. The game itself has an integration test with a simulated context.
- **The main JavaScript file is about 1,114 kB** (329 kB gzipped), up from about 1,030 kB on Day 4, and still needs splitting by route.
- **Today's Bangla text needs a native speaker's review,** including the game names, descriptions and admin column titles.

## Day 6 preview

This is a proposed plan, to be adjusted as needed.

1. Do the [manual checklist](day-05-test-report.md#manual-checklist), record the FPS above, and fix anything it finds.
2. **Balloon Pop** (`balloon_pop`): balloons rise slowly within the calibrated reach; reach one and squeeze to pop it. It uses the same framework, input layer, logger and provider, with balloon size, rise speed, spacing and squeeze demand as settings.
3. **Fruit Catch** (`fruit_catch`): fruit falls slowly and the patient moves a basket with the fingertip to catch it, training smooth movement from side to side. Its settings are fall speed, spacing and basket width.
4. Add both to the plan screen, and show their trials on the admin session page.
