# Day 9

**Movement quality.** Shared, tested tools measure how smooth a movement is (SPARC), and two new games use them: **Path trace** (smooth, controlled arm movement following a guide) and **Paint the wall** (bending and straightening the elbow through a large range while keeping the upper arm still). Both appear on the plan, the results and summary screens, history, the admin pages and the demo data.

## What was built

- **Movement-quality tools** (`web/src/metrics/`, pure TypeScript, no new libraries):
  - A radix-2 FFT with zero-padding.
  - Resampling of irregular samples to a fixed rate (60 Hz by default), keeping both endpoints.
  - A zero-phase moving average and a forward-backward 2nd-order Butterworth filter, for analysis only.
  - `speedFromTrajectory` (SW/s) and `angularSpeed` (deg/s).
  - **SPARC** (Balasubramanian et al. 2015), as in the paper's reference code: resample to 60 Hz, zero-pad (level 4), normalise the spectrum by 0 Hz, cut at the last frequency up to 10 Hz above 0.05, then minus the arc length.
  - Path shapes (line, arc, S-curve, part circle) fitted inside the reach hull, with length, point-at-distance and closest-point helpers.
  - **Test vectors** in `shared/test-vectors/sparc.json` (minimum-jerk reach −1.401, two sub-movements −1.590, noisy reach −1.531). An independent pure-Python reference generated them, using a direct DFT rather than an FFT. The web app reproduces them to 1e-6, and the server's version on Day 11 must too.
- **Path trace** (`web/src/games/pathTrace/`, 10 traces):
  - **Placement:** the path lies inside the patient's RAW reach hull, centred `ringFrac` of the way out and running across the reach. It is `pathLengthFrac` of the reach diameter long, shortened only if it would not fit.
  - **Play:** hold the start circle for 500 ms, then follow a ladybird at the guide speed. The trail is teal inside the corridor and amber outside, and the path fills in behind the guide where it was followed.
  - **End:** 1–3 stars and a soft note.
  - **Metrics:** from the RAW fingertip during the trace: tracking error, path error, time in the corridor, lag, coverage, SPARC and peak speed.
  - **Outcome:** a success from 70% in the corridor. Not holding the start circle within 15 s is a calm `reach_fail`.
  - **Provider:** cycles the four shapes and alternates outward and inward, so each shape is traced both ways every eight trials.
- **Paint the wall** (`web/src/games/paintWall/`, 8 stripes):
  - **Brush:** the elbow angle moves the brush. Straight is the bottom of the wall; the patient's most bent (from the latest elbow flexion warm-up, defaults 70° and 150°) is the top.
  - **Coats:** a full sweep (straight, bent to the target, straight) adds a coat. A partial one adds a lighter coat up to the height reached.
  - **Ending:** the stripe is finished after the sweeps needed, or kept partly painted at the time limit. The stripes become a mural.
  - **Upper arm:** moving it more than 20° from its start during a sweep is flagged (`upper_arm` compensation), with "Keep your upper arm still — move only your elbow".
  - **Metrics:** range reached, most bent and most straight, full and partial sweeps, mean sweep time, elbow SPARC (from the raw angles) and upper-arm motion.
- **Both games everywhere:**
  - **Plan:** Reach and squeeze, Balloon pop, Bloom and Path trace ticked (about 16 minutes); the others unticked.
  - **Results, summary and history:** stars, time in the corridor and best smoothness; stripes finished and best elbow range.
  - **Admin session page:** game-specific trial tables, the path with the raw fingertip per turn, and elbow range per stripe with the target.
  - **Admin Progress tab:** a Movement quality section (SPARC and elbow range per session).
  - **Demo data** with improving smoothness and range.
- **Server:**
  - Path targets (`shape`, up to 200 `points`) and stripe targets (`index`, `target_frac`).
  - Tracing and elbow metrics, validated.
  - The summary's `extra_measures` list (renamed from Day 8's unreleased `extra_measure`).
  - `path_sparc` and `elbow_range_deg` per session in the progress series.
  - The smoke test plays both games.
- **Review fix (task 5):**
  - The problem: Paint the wall's "bottom of the wall" was fixed at 15% of the wall. An elbow that cannot straighten as far as its reference (for example the default 150° without a warm-up) could never end a sweep, so its stripes could never be finished.
  - The fix: the bottom follows the straightest the arm has been in the stripe, at most half the wall.

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

# Demo data with every game
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py

# Regenerate the SPARC test vectors (no packages needed); git should show no change
python shared/test-vectors/generate_sparc_vectors.py
```

- **Manual checks:** follow the checklist in [the test report](day-09-test-report.md#manual-checklist).

## Decisions

- **SPARC follows the paper's reference code.** The cut-off is the last frequency whose normalised magnitude is at least 0.05. Resampling uses round(duration × 60) + 1 evenly spaced points, so the endpoints are kept exactly.
- **Path placement:** across the reach at `ringFrac` of the distance from the shoulder to the edge, so the path stays at about the same distance from the body. "Outward" means the path ends farther out (larger x).
- **A trace's `movement_ms` is null.** The guide sets the pace, and the shared summary would otherwise call the trace duration a "reach time".
- **Paint the wall's most straight angle is the warm-up's high threshold.** The warm-up records how far each rep bent but not how straight the arm then was, and every counted rep started above that threshold. The range is kept to at least 30°. It travels as the settings `elbow_bent_deg` and `elbow_straight_deg`, so every stripe saves the range it used.
- **The upper-arm reference** is its elevation at its first sighting in the stripe. Only movement during a sweep counts, and the reminder shows at most every 6 s.
- **A pause restarts the trace or stripe in progress.** No paused time can enter a trial's timings or SPARC window, because samples are taken in game time and the interrupted trial is discarded.
- **`extra_measures` is a list.** Path trace shows two extra figures, so the summary's Day 8 `extra_measure` was renamed before release.

## Known issues

**Needs confirming**

- **Neither game has been played by a patient or a therapist yet.** The guide speed, corridor width, 70% success threshold, sweeps needed and the 20° upper-arm limit are first guesses to review with the supervisor.
- **SPARC from a 30 Hz webcam fingertip** includes tracking jitter. Values are useful for comparing sessions of the same patient, not as absolute norms.
- **New Bangla text** needs a native speaker's review.

**Behaviour to improve**

- **Paint the wall pauses when the hand (fingertip) is lost,** as every game does, although the elbow angle comes from the body tracker. A hand turned away from the camera can pause the game while the elbow is still visible.
- **The upper-arm reference is taken when the stripe starts.** A patient who starts with the arm raised and then settles may be flagged once.

**Technical debt**

- **The main JavaScript file is about 1,295 kB** (378 kB gzipped) and still needs splitting by route.
- **React screens still have no automated tests;** the pure logic behind them does.
- **`httpx` deprecation warning** from Starlette's test client.

## Day 10 preview: Pick & Place, Grip & Hold, and the game library

- **Pick & Place:** reach to an object, close the hand to pick it up, carry it to a place and open the hand to let it go. It combines reach, grip and release, with the hand input from Day 8 and the reach placement of the arm games.
- **Grip & Hold:** squeeze and hold a steady grip at a target level for longer and longer, with a calm visual and measures of hold time and steadiness.
- **Game library:** a page listing all nine games with what each trains, its settings and recent results, ready for the planner (Day 13) to choose from.
