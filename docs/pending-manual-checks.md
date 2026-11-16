# Pending manual checks

These checks need a person, a camera or a device, so they cannot run in the automated tests.

## Checklist (in the order to do them)

Every item is PENDING until you tick it. The step-by-step tests are in the [manual testing guide](MuVi_Rehab_Testing_Guide.docx) (test IDs in brackets).

1. **Your local `server/.env`:** set `APP_NAME=MuVi Rehab`. It still says the code name, which shows in `/api/health` and `/api/version`. The default in the code and `.env.example` is already right. *Now, before testing.*
2. **The whole manual testing guide** with your real webcam and Ollama: sections 1–10 and 13; note your report generation time (T7.1). *Before tagging v1.0.0.*
3. **One full automated run:** `.\scripts\check.ps1 -E2E`, plus the Playwright full project (`npm run e2e:full`, about 15 min; not run yet). *Before tagging v1.0.0.* See `docs/testing.md`.
4. **By eye:** large text, high contrast and keyboard-only (T2.6, T2.7), and the layouts at phone width (T2.8). *Before tagging v1.0.0.* Checklist in `day-logs/day-17-test-report.md`.
5. **The model's licence:** check `qwen3.5:4b`'s licence on its model card and remove the VERIFY mark in `THIRD_PARTY_NOTICES.md`. *Before tagging v1.0.0.*
6. **Bangla:** check by eye, then a native speaker's review of the strings and the patient guide. *Before tagging v1.0.0.*
7. **The real muscle sensor (Day 21):** wiring, flashing, readiness, calibration, games and three or more 30 s recordings per site, then `analysis/emg/emg_validation.py`. Runbook: [hardware-day.md](hardware-day.md); record: [emg-hardware-test.md](emg-hardware-test.md). Label recordings with a patient code, never a name: they are committed with the analysis data.
8. **Frame rate with the real webcam and MediaPipe** on the target laptop. *Day 21.* See `docs/performance.md`.
9. **The validation session:** latency and joint angles ([below](#validation-session-later)).
10. **Repeatability visits 1, 2 and 3**, on different days ([below](#3-repeatability-visits-3-visits-on-different-days)). Then run `analysis/validation/run_validation.py` and `render_docs.py`; the app then uses the measured MDCs, and the admin's Metrics shows "measured (n=1, pilot)".
11. **Decide the seated rest thresholds** of the shoulder exercises (counts were 0 of 3), after item 9 ([below](#4-repetition-counting-no-session-needed)).
12. **The LLM evaluation** (automatic and blind human; `docs/llm-evaluation.md`), then choose the model (`docs/llm-model-choice.md`).
13. **Usability test:** 3–5 volunteers, both languages, System Usability Scale (Day 18 preview in `day-logs/day-17.md`); needs ethics approval for patients.
14. **Release 1.0.0:** the final checklist in the testing guide (section 15), then tag `v1.0.0`.

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
