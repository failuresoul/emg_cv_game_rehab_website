# Validation

**What this is:** a pilot technical validation of the camera measures, with one healthy participant. The results section is filled by `analysis/validation/render_docs.py` from `analysis/results/validation/summary.json`. A part without data says **PENDING**.

**What it is not:** a clinical validation. MuVi Rehab is a research prototype, not a medical device.

## Protocol

**Participant and setting:** one healthy adult (a team member), seated in a chair with a backrest.

- **Camera:** one laptop webcam, at chest height, about 1–1.5 m away.
- **Room:** indoor light, the same room for every visit.
- **Data:** no patient data is used.

**Tools:** the development tools in the web app. Step-by-step instructions are in [docs/pending-manual-checks.md](pending-manual-checks.md#validation-session-later).

### 1. Latency

`/dev/latency` turns a large square white when the tracked wrist crosses a line.

- **Software stages:** recorded per frame: the frame read, landmarks ready, and the square drawn.
- **End-to-end latency:** a slow-motion phone video (240 fps where available) films the arm and the square together. The latency is the frames from the wrist crossing to the square changing, × 1000 / fps. There are about 20 crossings.
- **Outcomes:** mean, SD, p50 and p95, in ms.

### 2. Joint angles

`/dev/angle-validation` averages 2 s of MediaPipe's angles in 3D (world landmarks) and 2D (image only), after a 5 s countdown. The reference is a phone clinometer on the limb segment.

- **Elbow:** flexion, with the upper arm hanging (0° = straight).
- **Shoulder flexion and abduction:** the upper arm's angle from hanging down.
- **Range:** about 8 angles across the range per joint, about 25 measurements per joint.
- **Outcomes, per joint and method:** RMSE, and the Bland–Altman bias and 95% limits of agreement (bias ± 1.96 SD).

### 3. Repeatability

**The visits:** three repeatability visits on different days, set by the admin ("Repeatability visit").

- **What a visit is:** the camera check, calibration and all six warm-up exercises with the standard targets (no personalisation).
- **Conditions:** the same chair, camera place and light each time.

**Outcomes, per session measure:**

- within-subject SD = SEM;
- MDC95 = 1.96 × √2 × SEM;
- CV%.

**ICC(2,1):** reported only with 3 or more participants; here it is "not applicable (n=1)".

**What the MDCs feed:** `mdc.json`, which the app uses for its "measured (n=1, pilot)" changes (`server/app/core/mdc.py`).

### 4. Repetition counting

Guided recordings (`/dev/record-guide`) are played through the warm-up's own counters (`analysis/validation/rep_accuracy.py`). Each step's counted repetitions are compared with the scripted ones.

## Results

<!-- results:start -->

From `analysis/results/validation/summary.json`, generated 2026-11-15T20:01:38+00:00 (commit 0c25fcc). All values are **pilot** (n = 1, healthy).

### Latency

**PENDING**: No latency_manual.csv or latency_software.csv yet (see /dev/latency).

### Joint angles

**PENDING**: No angles.csv yet (see /dev/angle-validation).

### Repeatability

**PENDING**: No repeatability.csv yet (Admin > patient > Repeatability visit, 3 visits).

### Repetition counting

| Exercise           | Scripted | Counted | Error | Accuracy % | Measured range  | Rest / target  |
| ------------------ | -------- | ------- | ----- | ---------- | --------------- | -------------- |
| shoulder_flexion   | 3        | 0       | -3    | 0          | 45.14 to 103.64 | 30.00 / 90.00  |
| shoulder_abduction | 3        | 0       | -3    | 0          | 68.10 to 114.73 | 30.00 / 80.00  |
| elbow_flexion      | 10       | 0       | -10   | 0          | 66.35 to 156.81 | 70.00 / 140.00 |
| hand_open_close    | 10       | 7       | -3    | 70         | 0.75 to 1.68    | 1.20 / 1.60    |
| thumb_opposition   | 2        | 0       | -2    | 0          | 0.15 to 0.89    | 0.25 / 0.40    |

Overall: 25% (21 wrong of 28 scripted).
<!-- results:end -->

## Limitations

- **One participant (n = 1):**
  - the repeatability is one person's session-to-session noise;
  - the MDCs are pilot values, not population values;
  - no ICC can be estimated.
- **A healthy participant:** stroke survivors move differently, and may be tracked worse (spasticity, compensation, slower movement, assistive devices). The results may be better than they would be for patients.
- **One camera, one room:** a single webcam model, position and light. Other cameras, angles, distances, clothing and lighting are untested.
- **The reference instruments:** a phone clinometer has its own error (often quoted around 1–2°) and is placed by hand. The latency count is limited by the phone's frame rate (about 4 ms at 240 fps).
- **Seated rest:** the first repetition-count check (`shadik_full.json`) found the seated rest position above the shoulder exercises' 30° rest line. The thresholds have not been changed (see [the pending checks](pending-manual-checks.md)).
- **No blinding:** the same person ran the tools and was measured.

## EMG validation (Day 21)

To be filled on Day 21 with the real ESP32 and electrodes, following [docs/emg-hardware-test.md](emg-hardware-test.md).

| Measure                       | Method           | Result | Notes |
| ----------------------------- | ---------------- | ------ | ----- |
| Sample rate and gaps          | 10 min stream    |        |       |
| Rest noise (mV, SD)           | 10 s relaxed     |        |       |
| MVC repeatability (3 efforts) | CV%              |        |       |
| Onset latency (EMG vs camera) | Squeeze trials   |        |       |
| Electrode-off detection       | Electrode lifted |        |       |

| Session measure         | Visits | SEM | MDC95 |
| ----------------------- | ------ | --- | ----- |
| E2 MVC (mV)             |        |     |       |
| E5 Onset latency (ms)   |        |     |       |
| E8 Grip steadiness (SD) |        |     |       |
