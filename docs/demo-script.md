# MuVi Rehab v0.1: 10-minute supervisor demo

What to click and what to say, in order. Times are a guide; the whole demo takes about 10 minutes.

## Before the demo (15 minutes earlier)

1. **Start the backend** from `server/`, with the virtual environment active:
   ```sh
   uvicorn app.main:app --port 8000
   ```
2. **Start the frontend** from `web/`:
   ```sh
   npm run dev
   ```
   Use the development server, not a production build: the keyboard backup (**K**) only works there.
3. **Create the demo data** from `server/`:
   ```sh
   python scripts/seed_demo_data.py
   ```
   Write down the two passwords it prints.
4. **Prepare a demo patient for the live session.** Use a real test patient (not Demo Rahim or Salma), with the **affected side matching the arm you will use**. Log in as that patient once, so the browser has already asked for camera permission.
5. **Open two browser windows:**
   - **Admin:** Chrome, logged in as admin.
   - **Patient:** a Chrome **incognito** or second-profile window, so both logins can stay open.
6. **Check the room:** a lamp in front of you, a plain wall behind, the laptop on a table, and a chair 1 to 1.5 metres away.
7. **Run the camera check once** to confirm the light and distance, then click **Exit** and **Leave session**.

## The demo

### 1. Landing page: research and team (0:00–0:45)

**Click:** open `http://localhost:5173`.

**Say:** "MuVi Rehab, Muscle + Vision Rehabilitation, is a research prototype for home arm and hand practice after stroke. The patient needs a webcam, and later a forearm EMG sensor. Video never leaves the browser: MediaPipe runs locally, and only landmarks and measures go to the server."

- **Click** **Research** in the top bar. Read the research title, and point to KUET's Department of CSE and the collaboration with The University of Queensland, with both logos.
- Point to the three aims: multimodal EMG and vision sensing, safe and explainable adaptive difficulty, and measurable movement-quality outcomes.
- **Click** **Team**. "Supervised by Professor Akhand at KUET and Dr. Awal at The University of Queensland; built by Nurul Absar Shadik and Nafis Ahammad."
- Optional: **click** **About** for the background, the system overview and how data is handled. Point to "Research prototype — not a medical device".

### 2. Admin overview with demo data (0:45–2:30)

**Click:** switch to the **Admin** window, then **Overview**.

**Say:** "This is the therapist's view. Two demo patients have two weeks of synthetic data, made by a seed script so the data is the same every time."

- Point to the four counts. "**Open alerts** is 1: Salma reported pain 5 after one session."
- Point to the **Alerts** card: patient code, date, the **Pain** flag.
- **Click** **Patients**. "Demo patients are clearly marked."
- **Click** **View** on **Demo Rahim**.
  - **Overview** tab: "His weekly goal is 5 sessions. Here are this week's count, his streak and last session. I can change the goal here."
  - **Progress** tab: "His reach map against the previous one, dashed: it has grown. Below are the warm-up charts and every personalisation decision, with its reason."

### 3. Live session as the patient (2:30–7:00)

**Click:** switch to the **Patient** window and show the **home page** briefly: streak, weekly ring, calendar, trends. Then click **Start session**.

**Say:** "The bar at the top shows the five steps. The current step is saved on the server, so a refresh or a return lands on the same step."

**Camera check (about 30 seconds)**

- Click **Allow camera**. Sit back until the checklist is green, then click **Continue to calibration**.
- **Say:** "It checks light, distance and that the affected arm is visible. This is the skeleton only: the camera image is never shown or sent."

**Calibration (about 1 minute)**

- Click **Start** and reach to the stars.
- **Say:** "This measures the comfortable reach in 8 directions, in shoulder widths from the affected shoulder. The games place their targets inside this map."

**Warm-up: 2 exercises (about 1.5 minutes)**

- Click **Start**. For the first exercise click **Show me**, then **Got it**, and do a few repetitions.
- **Say:** "Repetitions are counted from 3D joint angles. Leaning the trunk is detected as compensation: there is a gentle cue, and the rep still counts."
- Lean a little on purpose to show **Check your posture**.
- After the second exercise, skip the other four to save time (about 10 seconds each). For each, click **Show me**, then **Got it**, wait for the countdown, then click **Skip this exercise** and confirm with **Skip this exercise**. Finally click **Continue** on the warm-up summary.
- **Say:** "Targets adapt each session: one step harder after a near-perfect set with little compensation, easier after a hard one."

**One game (about 1.5 minutes)**

- On **Today's games**, untick everything except **Reach and squeeze**, then click **Start**.
- Play about 8 targets: reach, hold, close your hand to squeeze.
- **Say:** "Difficulty comes from a parameter provider. Today it is fixed; adaptive versions come later. Squeezing comes from an input layer: the webcam reads hand opening now, and EMG plugs in later."
- To finish early: click **Pause**, then **End game**, then **Continue**.

**Cool-down (about 30 seconds)**

- Click **Skip to the questions**. Answer **pain 5**, tiredness 4, 4 stars, **Just right**, **No**. Click **Send answers and finish**.

### 4. Summary (7:00–8:00)

**Say:**

- "The calm safety notice appears because pain was 4 or more. Its wording is fixed and gives no other medical advice."
- "The summary shows time spent moving, warm-up goals, a card for the game, and the reach map against last time. Each figure has a rule-based 'compared with last time' line."
- "The **Your feedback** box is where the LLM report will appear later."

### 5. Admin session page and alerts (8:00–9:30)

**Click:** switch to the **Admin** window and reload the **Overview**.

- **Say:** "The new alert is already here, and the open-alerts count went up."
- **Click** the patient code in the alert to open the **session page**: the reach map with every target coloured by outcome, the warm-up table, the trial table and movement chart, and the questionnaire with the **Pain** flag.
- **Click** **Mark reviewed**, type "Phoned the patient", and confirm. "The alert leaves the list and the note is kept on the session."

### 6. Close (9:30–10:00)

**Say:** "That is version 0.1: a complete, resumable session with three games, progress for patients and therapists, and safety flags. Next come more games, adaptive difficulty, EMG input and the LLM feedback report."

## Backup plan: the camera fails

If the camera is refused, not found, too dark or too slow:

1. **Don't troubleshoot for more than 30 seconds.** Say: "The camera isn't cooperating in this room, so I'll show recorded data and keyboard input instead."
2. **Show the demo data in the patient view.** Log the patient window in as **Demo Rahim** (password from step 3). Show the home page (streak, weekly ring, calendar, trends), **Progress** (charts, first and latest reach maps) and **History** (a session with its games).
3. **Show a game with the keyboard.** This needs the camera running to place the cursor. If the camera works but squeezing is unreliable:
   - start the game;
   - press **K** after the countdown starts (development server only); the badge changes to **Keyboard**;
   - reach with your hand and hold **Space** to squeeze.

   Press **K** again in each game.
4. **Show the alert flow with the demo data.** On the admin **Overview**, Salma's pain alert is waiting. Open it, show the questionnaire, and click **Mark reviewed**.
5. **If the backend fails,** restart it (`uvicorn app.main:app --port 8000`) and reload. Sessions resume at their saved step.

## After the demo

Remove the demo patients with `python scripts/seed_demo_data.py --clear`. Deactivate the live test patient if you no longer need it.
