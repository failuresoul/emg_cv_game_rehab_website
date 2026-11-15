# Pending manual checks

Checks that need a person, a camera or a device, and cannot run in the automated tests.

## Validation session (later)

One person can do all of these alone. Run the app in development:

```powershell
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
cd web; npm run dev
```

**Where the files go:** put every file in `analysis/validation/` under the name shown. Then run:

```powershell
server\.venv\Scripts\python.exe analysis\validation\run_validation.py
```

A file that is not there yet leaves its section PENDING. Results are written to `analysis/results/validation/`.

### 1. Latency (`/dev/latency`)

1. Open `http://localhost:5173/dev/latency` and allow the camera. Choose the affected side.
2. Put the phone on a stand so it films your arm and the square together. Use slow motion (240 fps if it has it).
3. Click **Start recording**.
4. Start the phone video, then raise and lower your wrist across the yellow line about 20 times, slowly.
5. Stop the video, click **Stop recording**, then **Download timing CSV**. Save it as `latency_software.csv`.
6. On the video, for each crossing, count the frames from the wrist passing the line to the square changing. Latency in ms = frames × 1000 / video fps.
7. Save the counts as `latency_manual.csv` with the columns `trial,latency_ms`, one row per crossing.

### 2. Joint angles (`/dev/angle-validation`)

You need a phone clinometer app (a level or angle app). Hold or strap the phone along the limb segment.

1. Open `http://localhost:5173/dev/angle-validation`, allow the camera, and choose the side.
2. Choose the joint:
   - **elbow:** upper arm hanging straight down, clinometer on the forearm, 0° = straight;
   - **shoulder_flexion:** straight arm forward, clinometer on the upper arm;
   - **shoulder_abduction:** straight arm out to the side, clinometer on the upper arm.
3. Press **Space**. Take the pose during the 5 beeps and hold still until the chime (2 s).
4. Read the clinometer, type the angle, and press Enter (Save row). Delete a row if the pose slipped.
5. Repeat at about 8 angles across the range, for each joint (about 25 rows per joint).
6. Click **Download CSV** and save it as `angles.csv`. The rows also stay in this browser.

### 3. Repeatability visits (3 visits, on different days)

1. As the admin: **Patients** → your test patient → **Repeatability visit** → **Visit 1**.
2. As that patient: start a session.
   - **What happens:** it is the camera check, calibration and all six warm-up exercises with the standard targets. Then **Finish the visit** ends it.
   - **Keep it the same each time:** the same chair, camera place and light, at about the same time of day.
3. Repeat with **Visit 2** and **Visit 3** on two other days.
4. As the admin: on the patient's page, click **Download repeatability CSV** and save it as `repeatability.csv`.

### 4. Repetition counting (no session needed)

1. Record a guided session at `/dev/record-guide` (or use `shadik_full.json`).
2. Run `server\.venv\Scripts\python.exe analysis\validation\rep_accuracy.py --recording <file> --side <left|right>`. It writes `rep_accuracy.csv` with the counts against the script.

**First result (2026-11-17, `shadik_full.json`, right side, standard targets):**

| Exercise                  | Counted | Scripted | Measured range | Targets (rest / target) |
| ------------------------- | ------- | -------- | -------------- | ----------------------- |
| Shoulder flexion          | 0       | 3        | 45°–104°       | 30° / 90°               |
| Shoulder abduction        | 0       | 3        | 68°–115°       | 30° / 80°               |
| Elbow                     | 0       | 10       | 66°–157°       | 140° / 70°              |
| Hand open and close       | 7       | 10       | 0.75–1.68      | 1.2 / 1.6               |
| Thumb opposition (rounds) | 0       | 2        | 0.15–0.89      | 0.25 / 0.40             |

**Why:**

- **The shoulder exercises:** the seated "rest" position never went below the 30° rest line. The counters need the arm back at rest to start a repetition.
- **Elbow and hand:** they only just reached their targets.

**To decide in the validation session:** check this against your own counts on video. Then choose whether the standard thresholds (`web/src/warmup/exercises.ts`) should change, for example a 45° shoulder rest line for seated patients. The thresholds have not been changed yet.
