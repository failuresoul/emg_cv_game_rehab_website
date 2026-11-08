# Day 4

**FPS measured during the warm-up with a real webcam, two hands in view: ___**

## What was built

- **Warm-up results on the server:** one row per exercise per session, saved again to replace it. Patients read their own sessions and their recent history for each exercise; admins read a patient's history per exercise. Session lists, the session detail and the patient dashboard now carry a warm-up summary. See the [API contract](../api-contract.md#warm-up-results).
- **Hand and reach measures:** the affected hand is chosen by where it is, not by MediaPipe's handedness. Hand opening and thumb-to-finger distances are in palm lengths. Forward reach is the share of arm length the wrist is in front of the shoulder.
- **Three more exercises:** forward reach, hand open and close, and thumb opposition. Thumb opposition uses a new sequence counter (index, middle, ring, little finger in order).
- **Compensation:** trunk displacement, trunk lean and shoulder hike are measured against a 2-second baseline. A rep is flagged when a threshold stays exceeded for 300 ms, and it still counts. Cues are shown at most every 5 seconds. Hand exercises check only trunk displacement. All thresholds are in `web/src/warmup/compensationConfig.ts`.
- **Personalised targets:** each exercise's target moves one step from the last result: harder after at least 9 of 10 reps with under 20% compensation, easier after under 6 of 10 or over 30% compensation. It never goes past the best peak plus a step, nor 15% past the standard target, nor easier than gentle. Every change has a reason, which is saved with the result.
- **The full warm-up:** six exercises, a plain-words goal on each intro, a 20-second breathing rest between exercises, and a summary table that is saved as soon as it opens.
- **Dashboards:** a "Last warm-up" card on the patient home page, the warm-up table on each session's history page, and a warm-up section in the admin Progress tab (charts and personalisation decisions). The admin Sessions tab has a warm-up column.

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

- **Warm-up:** log in as a patient, click **Start session**, then go through the camera check and calibration to reach the warm-up.
- **Accuracy:** follow [the accuracy test](day-04-accuracy.md).
- **Results:** see [the test report](day-04-test-report.md).

## Known issues

**Could change results**

- **No real person has done the new exercises yet.** Counting, hand selection and compensation were tested with synthetic landmarks only. The [accuracy test](day-04-accuracy.md) is still to be filled in.
- **Trunk displacement in 3D is relative to the hips.** MediaPipe's world landmarks are centred between the hips, so leaning is detected but sliding the whole body along the chair is not.
- **Forward movement is hard to see in 2D.** Without world landmarks, moving towards the camera shows mostly as a change of size.
- **A big shoulder hike can also flag "lean"** when the hips are hidden, as the shoulder line is then the only trunk reference.
- **The posture baseline assumes the patient sits still for the first 2 seconds** of each exercise. Only the Exercise Lab can re-baseline.
- **Detecting two hands costs some FPS.** It is needed to pick the affected hand when both are in view.

**Behaviour to improve**

- **A save to an ended session fails with 409,** and the summary then offers "Try again" for ever. It cannot happen in the normal flow, where the session ends after the warm-up.
- **Results are lost if the patient leaves the session pages before a failed save succeeds.** They stay in memory while the warm-up page is open.
- **Retries also repeat requests the server rejected as invalid (422),** which only delays the "Try again" button.
- **The forward-reach demo cannot show depth,** like the other frontal demos.
- **Partial thumb sequences are not recorded.** A sequence that times out leaves no partial rep.
- **The admin reason column shows the saved English summary,** in every language.

**Technical debt**

- **No coverage report:** `pytest-cov` is not in the agreed stack, so coverage was not measured. See the [test report](day-04-test-report.md).
- **React screens still have no automated tests.** The summary, rest and dashboard screens were checked by type checking and by hand.
- **The main JavaScript file is about 1,030 kB** (305 kB gzipped), up from about 930 kB on Day 3, and still needs splitting by route.
- **Today's Bangla text needs a native speaker's review,** including the finger names and goal sentences.

## Day 5 preview

This is a proposed plan, to be adjusted as needed.

1. Fill in [the accuracy test](day-04-accuracy.md) and adjust thresholds where a check fails.
2. Build `/session/plan`, choosing today's games from the warm-up results.
3. Start the first game at `/session/game/:gameId`, using the reach map and the same tracking.
4. Mark the session as completed at the end of the flow.
