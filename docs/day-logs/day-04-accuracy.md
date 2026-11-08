# Day 4 accuracy test

These tests check the new exercises, compensation detection and personalisation against what a person actually did.

## Before you start

1. From `web/`, run `npm run dev`. The Exercise Lab does not need the server; the personalisation test does.
2. Open <http://localhost:5173/dev/exercise-lab> and click **Start camera**.
3. Sit 1–1.5 m from the screen, facing the camera, with your shoulders, arm and hand in view. Sit back against the chair.
4. Choose the **Exercise**, **Preset** (standard) and **Affected side** (the arm you are moving). Leave the thresholds at their defaults: a changed slider makes the row invalid.
5. Before each row, sit still and click **Re-baseline**, then wait until the Compensation card says "Baseline: ready".

To keep the raw data for a row, click **Record** before starting, then **Stop** and **Download CSV** afterwards.

## 1. Rep accuracy

**Pass rule: every |Difference| <= 1.** Difference = Counted − Manual.

For each row, click **Reset**, then do 10 repetitions (5 full sequences for thumb opposition) at a natural pace. Press **Manual count** each time you complete one, with your other hand or a helper. Count only repetitions that reached the target. Copy the lab's **Manual** and **Full** values.

- **forward_reach:** start with your hand close to your body; reach straight forward and back.
- **hand_open_close:** start with a fist; open wide, then close again.
- **thumb_opposition:** touch your thumb to your index, middle, ring and little finger in that order. One sequence is one repetition.

Date: ___

| Person | Exercise | Manual | Counted | Difference |
| --- | --- | --- | --- | --- |
| 1 | `forward_reach` | | | |
| 1 | `hand_open_close` | | | |
| 1 | `thumb_opposition` | | | |
| 2 | `forward_reach` | | | |
| 2 | `hand_open_close` | | | |
| 2 | `thumb_opposition` | | | |

**Result (PASS or FAIL): ___**

## 2. Compensation

**Pass rule: 10 normal reps flag <= 1; 10 deliberate leans flag >= 8.**

Count "compensated (…)" lines in the lab's event log after each set; the log keeps the last 20 events, so note the count after every few reps, or record a CSV and count reps there.

- **Normal reps:** do 10 reps sitting back against the chair, without leaning or shrugging.
- **Deliberate leans:** do 10 reps, each time leaning your trunk forward or sideways by about a hand's width for most of the rep. For `hand_open_close`, move your whole trunk forward instead, as only trunk movement is checked for hand exercises.

| Person | Exercise | 10 normal reps: flagged count (pass <= 1) | 10 deliberate leans: flagged count (pass >= 8) |
| --- | --- | --- | --- |
| 1 | `shoulder_flexion` | | |
| 1 | `forward_reach` | | |
| 1 | `hand_open_close` | | |
| 2 | `shoulder_flexion` | | |
| 2 | `forward_reach` | | |
| 2 | `hand_open_close` | | |

**Result (PASS or FAIL): ___**

## 3. Personalisation

This needs the server and a test patient. Run several warm-ups in separate sessions, and vary how well you do. After each session, note the next session's goal from the exercise's intro screen, and check it against the rule.

**The rule.** From the last result: at least 90% of target reps with under 20% compensation raises the goal one step; under 60% of target reps, or over 30% compensation, lowers it one step; otherwise it stays. A step is 5° for angles, 0.05 for reach and hand opening, and 0.03 of touch distance for the thumb. The goal never goes past the best so far plus one step, nor 15% past the standard goal, nor easier than the gentle goal.

The admin Progress tab shows each decision with its reason, under **Latest personalisation decisions**.

| Session | Exercise | Reps | Compensation % | Goal before | Goal after | Reason | Correct? (yes/no) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |

**Result (PASS if every row is "yes"): ___**
