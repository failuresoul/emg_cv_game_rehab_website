# Day 8

**Hand games.** Two new games train the hand rather than the arm: **Bloom** (opening the hand fully, then closing it) and **Finger piano** (touching the thumb to each finger). Both read the hand only through the input layer, and both now appear on the plan, the results and summary screens, history, the admin pages and the demo data.

## What was built

- **Hand input layer** (`web/src/input/`):
  - **Openness**, from 0 (a fist) to 1 (fully open):
    - Camera: `clamp((aperture − closedRef) / (openRef − closedRef), 0, 1)`, using the patient's own references from the latest hand open-close warm-up (defaults 1.1 and 1.6 palm lengths), smoothed with an EMA of α = 0.5. It is not ready while the affected hand is out of view.
    - Keyboard: hold O (rises over 300 ms; falls over 200 ms on release).
    - EMG: a placeholder for Day 15, where extensor activity will drive it.
  - **Finger touch**: which finger the thumb of the affected hand is touching (index, middle, ring, little or none), with `touchStart` and `touchEnd` events.
    - A touch starts below the touch distance and ends only above it plus 0.1. Only the closest finger counts, and the touch moves to another finger only when that finger is clearly closer.
    - The touch distance comes from the latest thumb opposition warm-up, or 0.3 without one.
    - Keyboard: keys 1–4 for the index to little finger.
  - **`useHandInput()`** gives openness, grip (the existing activation), the current touch and the source badge.
    - K switches all three to the keyboard together.
    - The game shell passes them to games as `context.hand`.
    - Touch times arrive in game time, so pauses never count.
  - The **Exercise Lab** shows grip, openness, the four fingers and the last touch event.
  - Shared pieces were generalised rather than copied:
    - `InputManager` works for any level source;
    - the camera grip and openness sources share one base;
    - `KeyboardSource` takes the key to hold.
- **Bloom** (`web/src/games/bloom/`, 15 flowers):
  - Each flower runs: bud → **open** (the petals follow the hand live; reach the openness demand and hold it) → bloom with a sparkle and a soft note → **close** ("Make a fist to collect the seed": grip at its demand for 300 ms) → the seed flies into a basket → rest.
  - A phase that runs out of time is a calm miss. Its `failed_phase` is saved.
  - Both phases reuse the existing `ActivationDetector`, so a drop of more than 0.05 below the demand restarts the hold.
  - The garden keeps every collected flower in rows across the bottom of the screen.
  - Beside the bud: a level bar with the demand line, and a hand icon (open or fist).
  - No cursor, no reaching. Only trunk compensation is checked.
- **Finger piano** (`web/src/games/fingerPiano/`, 12 melodies):
  - **Screen:**
    - only the active lanes, each finger with its own colour and name;
    - a hand diagram that lights the finger to use;
    - a 2-second preview of each melody.
  - **Rules:**
    - The right finger within the hit window around a note's arrival plays a pentatonic note.
    - A wrong finger plays a soft muted sound. It is recorded but does not close the note, so the right finger can still play it.
    - No touch is a missed note.
    - One touch never plays two notes, and holding a touch plays nothing more.
    - A melody is a success at 75% of its notes.
  - **Settings:**
    - Melodies come from the parameter provider: every active finger, mostly neighbouring steps, never one finger three times in a row.
    - The touch distance comes from the warm-up, kept to 0.2–0.4.
    - A gentle thumb opposition warm-up starts with the index and middle finger only.
- **Hand games everywhere:**
  - **Plan:** starts with Reach and squeeze, Balloon pop, Bloom and Finger piano ticked (about 16 minutes), and Fruit catch below them, unticked.
  - **Results, summary and history:** Bloom shows flowers grown and best openness; Finger piano shows hit rate and best finger. History also has per-finger bars.
  - **Admin session page:**
    - Bloom: a trial table and peak openness per turn, with the demand as a dashed line.
    - Finger piano: a trial table and hit rate by finger.
  - **Admin Progress tab:** a Hand games section with Bloom's peak openness and Finger piano's hit rate per session.
- **Server:**
  - Trial targets may have no place (`{"kind": "bloom"}`, `{"kind": "sequence", "notes": […]}`). Placed targets need all of their spatial fields.
  - New optional trial metrics for both games, validated (notes must add up; hits never exceed attempts).
  - `main_measure` and `extra_measure` for each game in the session summary (`app/services/game_measures.py`).
  - `bloom_peak_openness` and `piano_hit_rate` per session in the progress series.
  - Demo data and the smoke test include both games.
- **Review fixes (task 5):**
  - Each camera frame's hand is measured once, however many inputs read it.
  - The open-hand reference from the warm-up is capped at 2.2 palm lengths, so a tracking glitch cannot make full openness impossible. The touch distance from the warm-up is kept to 0.1–0.6.
  - The audio context is closed on every way out of a session. A session resumed straight into a game starts sound on the first button or key press.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```powershell
# From the repository root: every check, with PASS or FAIL and a summary
.\scripts\check.ps1

# Or one at a time
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a running server (start it first in another terminal)
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# Demo data with the hand games
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py
```

- **Exercise Lab** (development builds only): `/dev/exercise-lab`, Start camera, then watch the Hand input card.
- **Manual checks:** follow the checklist in [the test report](day-08-test-report.md#manual-checklist).

## Decisions

- **Finger piano's wrong fingers are forgiving.** The right finger can still play the note before its window ends. Moving the thumb to the ring finger often grazes the middle finger, and the brief asks for "no penalty beyond the record". Each note still ends as exactly one of hit, wrong finger or missed.
- **Settings are numbers**, so Finger piano's finger set is `finger_count` (2, 3 or 4), and the melody travels in the settings as `note_1` … `note_n`. The trial's target also stores it as finger names.
- **Personal starting values** come from this session's warm-up through `GameDefinition.personalDefaults` and the provider's `defaultsFor`. The adaptive engines (Day 12) start from the same values.
- **The input badge and `input_source`** stay `cv_grip` / `keyboard` / `emg` for all hand inputs. `cv_grip` now means "the webcam".
- **In EMG mode, finger touches still come from the camera.** A muscle sensor cannot tell fingers apart.
- **Bloom's headline is flowers grown**, with best openness beside it. The average time to open is still saved in the summary.
- **Peak openness per session** (admin Progress) is the mean of each turn's peak, not the single best frame, which is noisier.
- **About 16 minutes:** Bloom and Finger piano are estimated at 4 minutes each.

## Known issues

**Needs confirming**

- **Neither game has been played by a patient or a therapist yet.** The demands, hold times, hit windows and the 75% threshold are first guesses to review with the supervisor.
- **Bloom's openness is relative to the patient's own warm-up.** A patient who opened little in the warm-up blooms with little opening. That is intended, but it should be explained to therapists.
- **New Bangla text** needs a native speaker's review.

**Behaviour to improve**

- **A camera dropout during Bloom's hold** (under the 500 ms before the game pauses) reads as a closed hand and restarts the hold.
- **Finger piano's lanes and hand diagram** assume the patient sees the back of the hand. A palm-facing camera position may feel mirrored.

**Technical debt**

- **React screens still have no automated tests;** the pure logic behind them does.
- **The main JavaScript file is about 1,254 kB** (367 kB gzipped) and still needs splitting by route.
- **`httpx` deprecation warning** from Starlette's test client.

## Day 9 preview: Path Trace and Paint the Wall

- **Path Trace:** follow a curved path with the fingertip, slowly and smoothly. It will measure the distance from the path, smoothness and time, with a time limit and path width from the parameter provider.
- **Paint the Wall:** move the hand over a wall to paint it, exploring the whole reachable space. It will measure the share covered against a goal and coverage by direction, with brush size and time limit from the provider.
- Both are reaching games with placed targets and trajectories, and will appear in the plan, results, summary and admin pages as Bloom and Finger piano do today.
