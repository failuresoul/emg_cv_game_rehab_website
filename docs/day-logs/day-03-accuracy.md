# Day 3 accuracy test

This test checks the rep counter against a person's own count, using real movement.

**Pass rule: every |Difference| <= 1.**

Difference = Counted reps − Manual reps.

## How to run it

1. From `web/`, run `npm run dev`. The server is not needed.
2. Open <http://localhost:5173/dev/exercise-lab> and click **Start camera**.
3. Sit 1–1.5 m from the screen, facing the camera, with your shoulders and arm in view.
4. Choose the **Exercise**, **Preset** and **Affected side**. Use the side of the arm you are moving.
5. Click **Reset**, then rest your arm in its starting position: down at your side, or straight for the elbow exercise.
6. Do 10 repetitions at a natural pace. Press **Manual count** once each time you finish a repetition, using your other hand or asking a helper.
7. Copy the numbers into the table:
   - **Manual reps:** the lab's **Manual** value.
   - **Counted reps:** the lab's **Full** value.
   - **Partial reps:** the lab's **Partial** value.
8. Work out the difference, and note anything unusual, such as lost tracking, poor lighting, or whether the hips were in view.

Repeat for each row. Only count a repetition manually if you reached the target. Leave the thresholds at their defaults, as a changed slider makes the row invalid. To keep the raw data for a row, click **Record** before starting, then **Stop** and **Download CSV** afterwards.

## Results

Date: ___

| Person | Exercise | Preset | Manual reps | Counted reps | Difference | Partial reps | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `shoulder_flexion` | standard | | | | | |
| 1 | `shoulder_abduction` | standard | | | | | |
| 1 | `elbow_flexion` | standard | | | | | |
| 2 | `shoulder_flexion` | standard | | | | | |
| 2 | `shoulder_abduction` | standard | | | | | |
| 2 | `elbow_flexion` | standard | | | | | |

**Result (PASS or FAIL): ___**
