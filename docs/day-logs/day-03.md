# Day 3

**FPS measured during the warm-up with a real webcam: ___**

## What was built

- **Joint angles:** arm elevation, elevation plane and elbow flexion for the affected arm, from MediaPipe's 3D world landmarks. Falls back to the vertical when the hips are hidden and to image landmarks when world landmarks are missing. Each value reports its source, trunk reference and confidence.
- **Angle filter:** a 5-frame median followed by a moving average, used for counting only.
- **Rep counter:** counts full and partial reps in both directions, and ignores noise, too-fast movements and movements longer than 8 seconds. A pause never creates or completes a rep.
- **Exercise engine:** three exercises with standard and gentle presets, and a runner from intro to done, with pausing and skipping.
- **Warm-up page:** `/session/warmup` has an overview, instructions, a stick-figure demo, a countdown, a live counter and angle gauge, feedback, a tracking-loss overlay, sound, optional voice, and a summary. Results are kept in `SessionContext`.
- **Exercise Lab:** `/dev/exercise-lab`, a development-only tool for checking angles and counts, with adjustable thresholds, a live chart, a manual count and CSV recording.

No backend code changed today. Warm-up results are not saved to the server until Day 4.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```sh
# From web/
npm test
npm run lint
npm run build

# From server/, with the virtual environment active
pytest
```

- **Warm-up:** log in as a patient, click **Start session**, then go through the camera check and calibration to reach the warm-up.
- **Accuracy:** follow [the accuracy test](day-03-accuracy.md).
- **Results:** see [the test report](day-03-test-report.md).

## Known issues

**Could change results**

- **No real person has done the warm-up yet.** Browser tests used simulated arm positions, so counting accuracy is unknown until the [accuracy test](day-03-accuracy.md) is filled in.
- **A patient who cannot reach the starting position cannot score.** Elbow flexion needs the elbow straighter than 140° (125° on gentle), and shoulder exercises need elevation under 30°. The screen now asks them to lower or straighten the arm, but they cannot progress. Day 4's personalisation needs to solve this.
- **Elevation plane may be unreliable.** It depends on depth estimated from one webcam, so "Raise it forward" and "Raise it out to the side" could be wrong. These messages never affect the count.
- **Leaning affects elevation when the hips are hidden.** "Down" is then straight down in the camera's view rather than along the trunk, which is the usual case when seated at a desk.

**Behaviour to improve**

- **The forward and sideways demos look almost the same.** A flat stick figure facing the viewer cannot show depth.
- **Warm-up results are lost on a page refresh.** They stay in memory until Day 4.
- **"Make it easier" during an exercise loses its reps,** because the exercise restarts at the countdown so that each result has one preset.
- **Measuring continues behind the Exit dialog,** on both the calibration and warm-up pages.
- **A session stays active after the warm-up,** because nothing marks it completed until the later session steps exist.
- **The warm-up can be opened without a calibration,** by going to its address directly. It does not use the calibration yet.
- **Voice instructions are always in English,** as specified, including for Bangla patients.
- **"About 6 minutes" is a fixed estimate.** It has not been timed on a real session.

**Technical debt**

- **The filtered plane does not handle the jump at ±180°.** This only arises when reaching far back and across the body.
- **Too-fast and too-slow movements are not recorded,** so they cannot be analysed later.
- **The Exercise Lab's text does not use `t()`,** on purpose: anything in the translation files would ship to production.
- **Today's browser checks were throwaway scripts** and are not in the repository. React screens still have no committed automated tests.
- **The main JavaScript file is about 930 kB,** and needs splitting by route. Today's Bangla text also needs a native speaker's review.

## Day 4 preview

This is a proposed plan, to be adjusted as needed.

1. Fill in [the accuracy test](day-03-accuracy.md) and adjust the counter if any difference is more than 1.
2. Save warm-up results to the server, using raw peaks, with API tests.
3. Personalise thresholds from history through `getThresholds`, including for patients who cannot reach the default starting position.
4. Mark sessions as completed, and link warm-up results to the patient and admin pages.
