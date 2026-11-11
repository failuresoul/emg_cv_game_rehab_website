# Day 9 test report (movement quality)

Date: 2026-11-11. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 987 passed (81 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,295 kB, 378 kB gzipped) |
| `pytest` | 514 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **98%** of 3,007 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 40 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |
| `generate_sparc_vectors.py` | Regenerating the vectors leaves `shared/test-vectors/sparc.json` unchanged |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/services/game_measures.py` | 100% |
| `app/schemas/progress.py` | 100% |
| `app/services/progress.py` | 99% |
| `app/schemas/game.py` | 99% |
| `scripts/seed_demo_data.py` | 99% |
| `scripts/smoke_test.py` | 98% |

## Day 9 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| FFT peaks at a sine's frequency; matches a direct DFT | Vitest | PASS | Whole and fractional bins; zero-padding |
| Resampling keeps endpoints; smoothing is zero-phase | Vitest | PASS | Moving average and forward-backward Butterworth |
| SPARC: min-jerk smoother than two sub-movements; noise lowers it | Vitest | PASS | Also size-independent |
| Shared SPARC vectors reproduced | Vitest | PASS | Within 1e-6, with the same sample count, FFT size and cut-off |
| Path shapes inside the hull; closest-point distance | Vitest | PASS | Four shapes, two hulls, several sizes and turns |
| Path trace: start hold, guide timing, corridor, metrics, outcome | Vitest | PASS | Perfect and wobbly follows; 70% threshold; lag; start time-out |
| Path trace targets capped at 200 points | Vitest, pytest | PASS | 201 points is 422 |
| Paint the wall: brush mapping, sweeps, finish and time-out, upper arm | Vitest | PASS | Personal and default ranges; jitter; wobble at the top |
| Stripe targets and elbow metrics on the server | pytest | PASS | 8 invalid cases return 422 |
| Plan defaults, measures, admin tables and charts, progress | Vitest, pytest | PASS / MANUAL | Data helpers tested; charts by hand |
| Demo data with improving smoothness and range | pytest | PASS | SPARC closer to 0 and range larger in later sessions |

## Review findings (task 5)

| Check | Result | Notes |
| --- | --- | --- |
| Both games use the framework, provider and tracking | PASS | They read only `context.params`, `context.getTracking()` (fingertip, elevation and the new raw elbow angle) and `context.compensation`. They import no camera or vision engine |
| SPARC uses RAW samples resampled to 60 Hz | PASS | Path trace: the raw trajectory → `speedFromTrajectory` → `sparc` (which resamples to 60 Hz). Paint the wall: raw elbow angles → `angularSpeed` → `sparc` |
| Paused time excluded from timings and SPARC windows | PASS | Samples are in game time (the shell converts with `toGameTime`); a pause restarts the trace or stripe in progress, so no paused gap enters a trial (`pathTraceGame.test.ts`, `paintWallGame.test.ts`) |
| Stored path points capped | PASS | `targetPoints` keeps at most 200 with both ends; the server refuses more; trajectories stay capped at 2,000 |
| Personal elbow range has safe defaults | PASS, **fixed** | Defaults (70°, 150°) without a usable warm-up, and the range is kept to at least 30°. **Fixed:** an elbow that cannot straighten to its reference could never end a sweep (see below) |
| All strings via `t()` | PASS | The canvas counter uses `t()`; no hard-coded text in today's screens |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| With a fixed "bottom of the wall" at 15%, a patient who cannot straighten past about 130° (default reference 150°) never ended a sweep, so no stripe could be finished | Code review | The bottom follows the straightest the arm has been in the stripe (at least 15%, at most half the wall); three new tests |
| The smoke test did not cover the Day 9 games | Task | Path trace and Paint the wall runs, checked in the dashboard, summary (measures), progress (`path_sparc`, `elbow_range_deg`) and admin session detail (path and stripe targets, raw path) |
| The CHANGELOG's Day 8 entry listed Day 9 fields | Review | Day 9 has its own Added and Changed sections |

## Smoke test against a live server

Not run in this review. Start the server, then in a second terminal:

```powershell
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 40 `PASS` lines, including "Patient plays a path_trace run with non-spatial targets" and "Patient plays a paint_wall run with non-spatial targets", and exit code 0. Or run `.\scripts\check.ps1` from the repository root, which starts its own temporary backend.

## Manual checklist

Sit as for the warm-up, with the affected arm and hand in view. Do the warm-up (including elbow flexion) first so Paint the wall uses your own range.

### Path trace

1. **Start circle.** Tick only Path trace on the plan.
   - Expected: a path with a soft corridor inside your reach, and a dashed start circle at one end.
   - Move your fingertip into the circle and hold still: its ring fills in about half a second, and the ladybird sets off.
2. **A perfect slow trace.** Follow the ladybird closely and slowly.
   - Expected: your trail stays teal, and the path fills in teal behind the ladybird.
   - At the end, three gold stars fade in with a soft note.
   - On the admin session page the turn shows over 90% in the corridor, a small tracking error, and a SPARC close to 0 (for example −1.4 to −1.8).
3. **A deliberately wobbly trace.** Zig-zag across the corridor while following.
   - Expected: the trail turns amber outside the corridor, and parts of the path stay unfilled.
   - One or two stars, a calm message, and the turn counts as a miss if below 70%.
   - The admin page shows a lower time in the corridor and a SPARC further from 0 (more negative) than the slow trace.
4. **Shapes and directions.** Play several turns.
   - Expected: line, arc, S-curve and part circle in turn, alternating direction.
5. **Start time-out.** Keep your hand away from the start circle for 15 seconds.
   - Expected: "That's fine. Here is a new path." and the next turn.
6. **Pause.** Hide your hand mid-trace.
   - Expected: the game pauses; when it resumes, the trace starts again from the start circle.
7. **Results.** Finish all 10 turns.
   - Expected: Stars, Average time in the corridor and Best smoothness.
   - The admin session page shows the trial table, and the path plot redraws when you choose another turn: dashed path, corridor and your raw fingertip line.

### Paint the wall

1. **Brush.** Tick only Paint the wall.
   - Expected: no cursor. With your arm straight the brush is at the bottom of the first stripe; bending the elbow raises it.
   - The orange line marks the target height, and the counter reads "0 / 3".
2. **Full sweeps.** Bend past the line and straighten, three times.
   - Expected: each sweep adds a coat (the stripe grows more colourful) and the counter goes up. After three, the stripe is finished and the next one starts to the right.
3. **Partial elbow sweeps.** Bend only halfway each time, then straighten.
   - Expected: a lighter coat up to the height reached each time, and the counter does not go up.
   - After 30 seconds the stripe ends calmly, its paint kept.
   - The admin page shows partial sweeps for that stripe.
4. **Lifting the whole arm.** While bending, raise your upper arm (lift the elbow out to the side or forward).
   - Expected: "Keep your upper arm still — move only your elbow" appears, at most every 6 seconds.
   - On the admin page, the stripe's compensation reads "Upper arm moved" and its upper-arm motion is above 20°.
5. **An elbow that does not straighten fully.** Keep your elbow a little bent at the "straight" end of each sweep.
   - Expected: sweeps still count once you bend past the line and come back towards your straightest.
6. **Results.** Finish all 8 stripes.
   - Expected: the wall is a colourful mural, and the results show Stripes finished and Best elbow range.
   - The admin page shows the trial table and the elbow range bars with the dashed target line.

### Across the app

1. **Plan.** Open the plan.
   - Expected: Reach and squeeze, Balloon pop, Bloom and Path trace ticked ("4 games · about 16 minutes"). Fruit catch, Finger piano and Paint the wall are below, unticked.
2. **Summary and history.** Play a session with both games.
   - Expected: the summary and the history detail show both games with their figures.
3. **Admin Progress.** Run the demo data (`scripts\seed_demo_data.py`) and open Demo Rahim's Progress tab.
   - Expected: "Movement quality" shows smoothness rising towards 0 and elbow range rising over the sessions.
