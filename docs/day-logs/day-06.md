# Day 6

**FPS measured during each game with a real webcam (Reach and squeeze / Balloon pop / Fruit catch): ___ / ___ / ___**

## What was built

- **Balloon Pop** (`balloon_pop`): balloons rise to a share of the calibrated reach in one of three upward directions (up-and-out, up, up-and-across), sway gently and wait; touching one once it has arrived pops it, otherwise it floats away (a `miss`). A squeeze-to-pop mode is built in but not yet used (see Known issues). Each trial records the reach measures, the peak arm elevation and compensation. The fixed provider plays all nine direction-and-height pairs in a shuffled order every nine balloons.
- **Fruit Catch** (`fruit_catch`): fruit falls at alternating sides, outward and across the body, within the calibrated sideways reach; a basket on a line just below the shoulder follows the raw fingertip's x. Caught fruit scores; missed fruit lands softly. Each trial records sideways distance, reaction and movement time, sideways path efficiency, overshoot and side. The provider alternates sides with three distances on each.
- **Several games per session:** the plan lists the three games with what they train, their length and about 12 minutes in total; the patient can untick a game or change the order. Start plays them one after another: game, results, next game, then the cool-down. The order is kept for the browser tab, so a refresh carries on at the right game.
- **Shared pieces:** encouragement messages (varied, a streak message every third success in a row, calm ones after a miss, never the same twice running); a results screen with each game's main measure (average reach time, highest balloon popped, widest catch); target placement, the compensation tally and the squeeze ring now shared by all games; optional game backgrounds and top-bar figures in the game shell.
- **Results everywhere:** the session summary has a row per game; patient history has a section per game; the admin session page has, for each run, the game's own trial columns, a reach map of targets (Reach and squeeze, Balloon pop) or a strip of fruit positions across the sideways reach (Fruit catch), and movement time per trial.
- **Server:** the `miss` outcome, optional per-game metrics (`peak_arm_elevation_deg`, `lateral_distance_sw`, `lateral_path_efficiency`, `overshoot_sw`, `side`) and `summary.details` for game-specific figures. See the [API contract](../api-contract.md#games).

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

- **The games:** log in as a patient, click **Start session**, go through the camera check, calibration and warm-up, then on **Today's games** click **Start**.
- **Manual checks:** follow the checklist in [the test report](day-06-test-report.md#manual-checklist).
- **Results:** see [the test report](day-06-test-report.md).

## Known issues

**Could change results**

- **No real person has played Balloon pop or Fruit catch yet.** The games were tested with simulated input only.
- **Balloon pop's squeeze-to-pop mode cannot be reached in the app.** The fixed provider sends the default (touch only), and there is no switch. The mode is covered by automated tests; choosing it is for the adaptive engine or a therapist setting later.
- **A balloon can only be popped once it has risen,** so a hand already resting where it stops pops it at once.
- **Fruit catch measures sideways movement only.** Raising or lowering the hand while moving the basket is ignored by its measures.
- **Sectors are rings of the full reach,** so Fruit catch's default middle distance (0.7 of a 0.7 spread) is often ring 1.

**Behaviour to improve**

- **Keyboard input switches back to the webcam at the start of every game.** Press K again in each game when testing with the keyboard.
- **The camera restarts between games,** which takes a second or two before the countdown.
- **Refreshing during a game starts that game again.** The server marks the interrupted run as aborted when the new one starts; its trials not yet uploaded (up to 9) are lost.
- **Encouragement replaced each game's own lines** ("Pop!", "Caught it!"). They can come back as a game's first message if wanted.
- **A missed balloon and a missed fruit look like a reach that did not arrive** on the admin page (amber square), with their own labels.

**Technical debt**

- **No coverage report:** `pytest-cov` is not in the agreed stack, so coverage was not measured. See the [test report](day-06-test-report.md).
- **React screens still have no automated tests.** The plan, results, summary, history and admin pages were checked by type checking and by hand; the game logic and each game's play-through are tested with simulated contexts.
- **The main JavaScript file is about 1,150 kB** (339 kB gzipped), up from about 1,114 kB on Day 5, and still needs splitting by route.
- **The game shell now measures arm angles on every frame for every game,** although only Balloon pop uses them. It is cheap, but could be turned on per game.
- **Today's Bangla text needs a native speaker's review,** including the encouragement messages and admin column titles.

## Day 7 preview

This is a proposed plan, to be adjusted as needed.

1. Do the [manual checklist](day-06-test-report.md#manual-checklist) and record the FPS above.
2. Review the full session flow end to end: login, setup, calibration, warm-up, plan, three games, cool-down, summary, history and the admin pages, fixing anything rough along the way.
3. Tidy the known issues that affect patients most (keyboard input per game, the camera restart between games).
4. Tag **v0.1**: a complete session with three games, saved and shown to patients and therapists.
