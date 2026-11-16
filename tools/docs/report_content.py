"""The chapters of the technical report (tools/docs/build_report.py builds the .docx).

Every statement here comes from the code and documents named beside it. Results are copied from
docs/results-summary.md by the builder; anything not measured says PENDING.
"""

from __future__ import annotations

from typing import Any

# The control of each game, from its code (web/src/games/<game>/) and its in-game text.
GAME_NOTES: dict[str, tuple[str, str, str]] = {
    # id: (therapeutic goal, how it is controlled, the folder)
    "reach_activate": (
        "Reaching in every direction of the patient's own workspace, then a grip at the target.",
        "The fingertip (camera) reaches a circle placed by direction and distance in the reach map, holds it for a dwell time, then the hand closes (camera grip, or the muscle sensor at the flexors).",
        "web/src/games/reachActivate/",
    ),
    "balloon_pop": (
        "Shoulder elevation: raising the arm to targets above the shoulder.",
        "The hand reaches the balloons, which rise in the upward directions (45°, 90°, 135°) and hover; when the `squeeze_to_pop` setting is on, a squeeze (activation) pops them.",
        "web/src/games/balloonPop/",
    ),
    "fruit_catch": (
        "Side-to-side reaching with timing.",
        "The basket follows the hand across the workspace to catch falling fruit; the fall speed and basket width set the difficulty.",
        "web/src/games/fruitCatch/",
    ),
    "bloom": (
        "Hand opening (finger extension), which is often hard after a stroke.",
        "Opening the hand wide (camera openness, or the muscle sensor at the extensors) makes the flower bloom; a fist collects the seed.",
        "web/src/games/bloom/",
    ),
    "finger_piano": (
        "Finger individuation: touching the thumb to each finger in turn.",
        "Thumb-to-fingertip touches (camera) play the notes shown on four lanes (index, middle, ring, little).",
        "web/src/games/fingerPiano/",
    ),
    "path_trace": (
        "Smooth, controlled movement along a path (movement quality, not just reaching).",
        "The cursor (the fingertip, smoothed for display only) follows a ladybird moving at `guide_speed_sw_s` along a path, staying inside a corridor (`corridor_width_sw`); the deviation and smoothness of the raw movement are measured.",
        "web/src/games/pathTrace/",
    ),
    "paint_wall": (
        "Elbow flexion and extension.",
        "Each full sweep from the bent to the straight elbow angle (`elbow_bent_deg`, `elbow_straight_deg`) over the required share of the patient's range paints a stripe; `sweeps_needed` stripes within the time limit complete the turn.",
        "web/src/games/paintWall/",
    ),
    "pick_place": (
        "A functional task: grasp, carry and release.",
        "The hand reaches an object, a grip picks it up, the arm carries it to the box in one of four directions, and opening the hand releases it.",
        "web/src/games/pickPlace/",
    ),
    "grip_hold": (
        "Graded, steady grip force and timely release.",
        "The grip level (camera hand closing, or the muscle sensor's %MVC at the flexors) keeps a kite inside a green band for a hold time, then relaxes.",
        "web/src/games/gripHold/",
    ),
}


def build(r: Any) -> None:
    f = r.facts
    p = f.project
    r.title_page()
    r.contents()
    chapter_1(r, p)
    chapter_2(r)
    chapter_3(r)
    chapter_4(r)
    chapter_5(r)
    chapter_6(r, f)
    chapter_7(r)
    chapter_8(r)
    chapter_9(r, f)
    chapter_10(r)
    chapter_11(r, f)
    chapter_12(r)
    chapter_13(r)
    chapter_14(r, f)
    chapter_15(r)
    chapter_16(r)
    appendices(r, f)


# ---------------------------------------------------------------------------------------------


def chapter_1(r: Any, p: dict[str, Any]) -> None:
    r.h1("Introduction", new_page=False)
    r.p(
        f"{p['name']} ({p['nameLong'].split('—')[-1].strip()}) is a browser-based system for home "
        "rehabilitation of the arm and hand after stroke. It turns an ordinary laptop and webcam, "
        "with an optional forearm muscle sensor, into a guided practice station. This report explains "
        "every part of the system: what it is, how it works (with the file that does it), why it was "
        "chosen and which alternatives were rejected. It is written to prepare for questions about the "
        "design. Paths such as `web/src/vision/` are relative to the repository root."
    )
    r.h2("The problem")
    r.bullets([
        "**Practice happens at home:** after a stroke, many people keep practising arm and hand movements for months, and much of that practice is at home without a therapist (`docs/methods-draft.md`, `web/src/i18n/en.ts` about texts).",
        "**Three difficulties at home:** it is hard to know whether a movement was done well, to keep the practice at the right level of challenge, and to stay motivated.",
        "**Measurement is rare:** movement quality (reach area, smoothness, range, grip) is seldom measured outside a clinic, so progress is hard to see.",
        "**Cost and access:** dedicated rehabilitation devices are expensive; a webcam and a low-cost sensor are within reach.",
    ])
    r.h2("Aims")
    r.numbered([
        "Measure arm and hand movement with a webcam in the browser, without sending video anywhere.",
        "Add an optional low-cost surface EMG sensor (ESP32) for muscle activation, with a camera fallback.",
        "Provide nine games that each train a movement, with difficulty that adapts to each patient inside safety rules and the therapist's limits.",
        "Record movement-quality measures every session and judge change against the minimal detectable change (MDC).",
        "Give each patient a short plain-language report in English or Bangla, written by a local language model under strict rules.",
        "Give therapists and researchers a dashboard, programmes, alerts and a research mode for controlled studies.",
    ])
    r.h2("Contributions")
    r.bullets([
        "**Multimodal input with fallback:** webcam landmarks and an optional EMG envelope behind one input abstraction; a lost sensor falls back to the camera mid-game (`web/src/input/inputManager.ts`).",
        "**Three interchangeable adaptation engines:** fixed (L0), a weighted up-down staircase (L1) and a workspace-aware Bayesian engine with Thompson sampling (L2), all under one safety layer (`server/app/engine/`).",
        "**Safe LLM feedback:** \"the code calculates, the rules decide, the model only writes\", with a validator and a template fallback (`server/app/feedback/`).",
        "**Research tooling:** blinded within-subject studies (balanced Latin square), repeatability visits, pseudonymous exports, a simulation study of the engines, and validation pipelines (`analysis/`).",
        "**Engineering for trust:** privacy by design (video never leaves the browser), production safety checks, and tests with a replayed camera, a simulated sensor, a mock ESP32 and a mock model (`docs/testing.md`).",
    ])
    r.h2("Scope")
    r.bullets([
        "**In scope:** one person at home or in a clinic, one laptop, one webcam, an optional one-channel forearm EMG sensor; English and Bangla.",
        "**Not in scope:** diagnosis, treatment decisions, multi-channel EMG, other body parts (legs), and deployment beyond `localhost` without HTTPS (`docs/known-issues.md`).",
        "**Evidence so far:** a technical prototype with a pilot (n = 1, healthy) validation protocol; most clinical and validation results are PENDING (chapter 14).",
    ])
    r.h2("Not a medical device")
    r.p(
        "MuVi Rehab is a research prototype, not a medical device. It does not diagnose, does not make "
        "treatment decisions and has not been clinically validated. This is stated on the landing page, "
        "in the app's footer texts, the feedback reports' fixed safety notices "
        "(`shared/safety-notices.json`) and every guide. Any use with patients needs ethics approval and "
        "a therapist's supervision."
    )


def chapter_2(r: Any) -> None:
    r.h1("System overview")
    r.p(
        "The system has three parts: the browser app (React and TypeScript), which does all the "
        "sensing; the server (FastAPI with SQLModel and SQLite), which keeps the data, adapts the "
        "difficulty and writes the feedback; and a local language model (Ollama) for the report text "
        "(`docs/architecture.md`)."
    )
    r.figure("diagrams/components.png", "Components: the browser does the sensing, the server stores, adapts and writes feedback, Ollama writes text")
    r.h2("Components")
    r.table(
        ["Component", "What it does", "Where"],
        [
            ["Vision engine", "MediaPipe hand and pose landmarks in the page (WASM, GPU or CPU)", "`web/src/vision/visionEngine.ts`"],
            ["Tracker and body frame", "Affected shoulder as origin, shoulder widths as unit, raw and smoothed fingertip", "`web/src/vision/tracking.ts`"],
            ["Warm-up", "Six exercises: counters, compensation, personal targets", "`web/src/warmup/`"],
            ["Games", "Nine games on one shell (fixed timestep, HUD, results, trial saving)", "`web/src/games/`"],
            ["Input sources", "Camera grip, openness, pinch, touch; EMG; keyboard; with fallback", "`web/src/input/`"],
            ["EMG pipeline", "Web Serial, protocol, envelope, readiness, calibration, %MVC", "`web/src/emg/`"],
            ["REST API", "JWT auth, patients, sessions, games, engine, feedback, studies", "`server/app/api/`"],
            ["Engines and safety", "L0, L1, L2 and the safety layer", "`server/app/engine/`"],
            ["Services", "Planner, programme, metrics, alerts, studies, exports", "`server/app/services/`"],
            ["Feedback", "Facts, rules, prompt, model, validator, template, jobs", "`server/app/feedback/`"],
            ["Firmware", "ESP32, 500 Hz sampling, serial protocol", "`firmware/emg_stream/emg_stream.ino`"],
            ["Shared specs", "Game settings, metric catalogue, safety notices", "`shared/`"],
        ],
        "The components and where they are in the code",
        [3.5, 7.5, 5.5],
    )
    r.figure("diagrams/data-flow.png", "Data flow: video stays in the browser; only numbers reach the server", 14)
    r.h2("The patient's journey")
    r.numbered([
        "Log in and press Start session on the home page (`web/src/pages/patient/PatientHomePage.tsx`); a session left part way through can be continued.",
        "Camera check: light, distance, framing and the tracked body must be green (`web/src/vision/setupChecks.ts`, `web/src/pages/session/SessionSetupPage.tsx`). The muscle sensor can be turned on here.",
        "Muscle sensor (optional): safety questions, electrode site, nine-item check, calibration (`web/src/pages/session/SessionEmgPage.tsx`).",
        "Reach calibration in 8 directions; the reach map becomes the session's workspace (`SessionCalibratePage.tsx`).",
        "Warm-up: six exercises with counters and cues (`SessionWarmupPage.tsx`).",
        "Plan: the planner's games with reasons; the patient may untick one (`SessionPlanPage.tsx`).",
        "Games: each trial's settings come from the engine after the safety layer (`SessionGamePage.tsx`, `web/src/games/shared/GameShell.tsx`).",
        "Cool-down questionnaire, then the summary with the feedback report (`SessionCooldownPage.tsx`, `SessionSummaryPage.tsx`).",
    ])
    r.figure("diagrams/session-sequence.png", "A session as a sequence diagram (docs/architecture.md)", 13.5)
    r.h2("The therapist's and researcher's journey")
    r.bullets([
        "**Overview** of patients, sessions and alerts (`web/src/pages/admin/AdminOverviewPage.tsx`).",
        "**Patients:** add, edit, deactivate; the patient page has tabs for overview, sessions, progress, programme, reports and alerts (`AdminPatientDetailPage.tsx`).",
        "**Programme:** games and their highest level, session length, rest frequency, warm-up exercises and targets, EMG site (`server/app/services/programme.py`).",
        "**Alerts:** review and resolve with a note (`AdminAlertsPage.tsx`, `server/app/services/alerts.py`).",
        "**Research:** studies, consent, exports (`AdminResearchPage.tsx`, `server/app/services/studies.py`).",
        "**System:** version, the model's health and the EMG settings (`AdminSystemPage.tsx`).",
    ])
    r.h2("Folder structure")
    r.table(
        ["Folder", "Contents"],
        [
            ["`web/src/vision/`", "MediaPipe engine, tracking, body frame, angles, setup checks"],
            ["`web/src/warmup/`", "Exercises, rep and sequence counters, compensation, personalisation"],
            ["`web/src/games/`", "One folder per game and `shared/` (GameShell)"],
            ["`web/src/input/`", "Level sources and the input manager"],
            ["`web/src/emg/`", "Muscle-sensor pipeline and settings"],
            ["`web/src/features/`, `web/src/pages/`", "Screens by area (patient, session, admin, research…)"],
            ["`web/src/i18n/`", "Every string in English and Bangla"],
            ["`web/e2e/`", "Playwright end-to-end tests; `e2e/docs/` the screenshots"],
            ["`server/app/api/`", "HTTP routes"],
            ["`server/app/engine/`", "Engines, safety layer, simulated patients (`sim/`)"],
            ["`server/app/services/`", "Planner, metrics, alerts, studies, exports, programme"],
            ["`server/app/feedback/`", "The report pipeline"],
            ["`server/app/models/`, `schemas/`", "Database tables; request and response models"],
            ["`server/tests/`", "pytest suites"],
            ["`firmware/`", "ESP32 firmware and hardware guide"],
            ["`analysis/`", "Validation, EMG validation, LLM evaluation, simulation, performance"],
            ["`shared/`", "Specs shared by the browser and the server"],
            ["`scripts/`, `tools/docs/`", "Start, stop, backup, checks, screenshots, this report"],
            ["`docs/`", "Documentation and images"],
        ],
        "The repository's main folders (the README has the full tree)",
        [5, 11.5],
    )


def chapter_3(r: Any) -> None:
    r.h1("Technology stack")
    r.p("Each technology with the reason it was chosen and the alternatives rejected. Exact versions are pinned in `web/package.json` and `server/requirements.txt`; licences are in `THIRD_PARTY_NOTICES.md`.")
    rows = [
        ["Front end", "React 19 + TypeScript 6 (strict) + Vite 8", "A typed single-page app; strict types catch errors in the maths and the protocol; Vite builds fast", "Angular (heavier), Vue (smaller team experience), plain JS (no types)"],
        ["Styling", "Tailwind CSS 4, lucide-react", "Consistent design tokens and accessible contrast without a component library", "Material UI (heavy, harder to make calm and large-text friendly), CSS modules"],
        ["Server state", "TanStack Query 5, axios", "Caching, retries, offline handling", "Redux (more boilerplate), plain fetch (no caching)"],
        ["Routing", "React Router 7", "Nested layouts and lazy pages; /dev pages only in development builds", "Next.js (server rendering is not needed; must run offline on localhost)"],
        ["Charts", "Recharts 3", "Simple, accessible SVG charts", "Chart.js (canvas, weaker accessibility), D3 (low level)"],
        ["Vision", "MediaPipe Tasks Vision 1.2.0", "Runs in the browser (WASM, GPU), so video never leaves the computer; hand and pose models", "OpenPose (server GPU, video upload), TensorFlow.js MoveNet (pose only, no hands), a Python server with OpenCV (video upload)"],
        ["Muscle sensor link", "Web Serial API", "No driver or app to install; the browser reads the ESP32 over USB", "A Python bridge (an extra program), Bluetooth (latency, pairing)"],
        ["Microcontroller", "ESP32 DevKit V1", "Cheap, 12-bit ADC, two cores (sampling on one, USB on the other)", "Arduino Uno (one core, slower USB), a commercial EMG kit (cost)"],
        ["Server", "Python 3.12, FastAPI, Pydantic", "Typed models, automatic OpenAPI docs, async for the report queue; Python for NumPy/SciPy", "Django (heavier), Node/Express (no scientific Python), Flask (no typing)"],
        ["Database", "SQLModel on SQLite (PostgreSQL possible)", "One file for a single computer; the same models work on PostgreSQL", "MongoDB (no relational integrity for sessions/trials), PostgreSQL only (needs a server)"],
        ["Auth", "PyJWT (HS256), Argon2 via pwdlib", "Standard stateless tokens; a modern memory-hard hash", "Sessions with server state; bcrypt (older)"],
        ["Maths", "NumPy, SciPy", "SPARC, kinematics, statistics, the L2 engine", "Hand-written maths (error-prone)"],
        ["Language model", "Ollama with qwen3.5:4b (local)", "Private (no data leaves the computer) and free to run; JSON-schema output", "Cloud APIs (send patient data off the computer, cost), no model (templates only: less natural)"],
        ["Tests", "pytest, Vitest, Testing Library, vitest-axe, Playwright", "Unit, accessibility and end-to-end tests, with a replayed camera and a simulated sensor", "Cypress (weaker multi-browser and WebAssembly support), Selenium (slower)"],
        ["Deployment", "Docker Compose, nginx", "One command for the release, security headers, optional GPU profile", "Manual installs only (error-prone), Kubernetes (far too heavy)"],
    ]
    r.table(["Layer", "Technology", "Why chosen", "Alternatives rejected"], rows, "The technology stack", [2.3, 3.4, 5.6, 5.2])
    r.p("Sources: `docs/llm-model-choice.md` (the model), `web/src/vision/config.ts` (MediaPipe version), `docker-compose.yml` (deployment).", italic=True)


def chapter_4(r: Any) -> None:
    r.h1("Computer vision")
    r.part(
        "MediaPipe hand and pose landmarkers",
        what="Two MediaPipe Tasks models run in the browser on each camera frame: the Hand Landmarker (21 landmarks per hand, up to two hands) and the Pose Landmarker lite (33 body landmarks), each in image and metric world coordinates.",
        how=[
            "`web/src/vision/config.ts` names the WASM files (`@mediapipe/tasks-vision@1.2.0`) and the two model files.",
            "`web/src/vision/visionEngine.ts` loads them lazily, in `VIDEO` running mode, with `numHands: 2` so the affected hand can be chosen by position.",
            "Each frame (640 × 480, up to 30 per second) goes to both models; the landmarks, not the image, are passed on.",
            "The affected hand is the detected hand whose wrist is within 0.5 shoulder widths of the pose's wrist on the affected side, so mirrored-camera handedness labels are not needed (`docs/methods-draft.md` 2.1).",
            "A landmark counts as visible above 0.5 visibility.",
        ],
        why="It runs entirely in the browser, so video never leaves the patient's computer (the project's first privacy rule), it gives hands and body together, and it runs in real time on a laptop GPU.",
        alternatives=[
            "**OpenPose or a Python server with OpenCV:** needs video uploaded to a server: rejected for privacy and cost.",
            "**TensorFlow.js MoveNet:** body only, no hand landmarks for grip and finger games.",
            "**Depth cameras (Kinect):** extra hardware the patient would have to buy.",
        ],
    )
    r.part(
        "GPU with CPU fallback",
        what="The models use the GPU delegate when the browser allows it, otherwise the CPU.",
        how=[
            "`visionEngine.ts` tries `delegate: \"GPU\"` for both models.",
            "If creating either fails, it closes what was created and tries `\"CPU\"`.",
            "The delegate in use is reported to the camera check, which shows the frame rate and \"GPU\" or \"CPU\" (the camera-check figure at the end of this chapter).",
        ],
        why="Most laptops have a GPU that WebGL can use, which keeps the frame rate high; the CPU fallback means the app still works on machines where WebGL fails.",
        alternatives=["**GPU only:** would fail on some machines.", "**CPU only:** slower on every machine."],
    )
    r.part(
        "The body frame",
        what="Every position is expressed in a frame attached to the patient: origin at the affected shoulder, unit one shoulder width (SW), +x away from the body midline on the affected side, +y up.",
        how=[
            "`web/src/vision/tracking.ts` takes each frame's pose and hand landmarks.",
            "`StableShoulderWidth` keeps the median of the last 30 frames' shoulder distance, so a single bad frame does not change the unit.",
            "The fingertip and wrist are converted into this frame (`web/src/vision/geometry.ts`).",
            "The axes stay level with the image, so leaning the trunk does not rotate \"up\" (`docs/methods-draft.md` 3).",
        ],
        why="Shoulder widths make distances comparable between people, cameras and distances from the camera, and targets can be placed in the patient's own reach.",
        alternatives=["**Pixels:** change with the distance from the camera.", "**Metric world coordinates only:** MediaPipe's world estimates are noisier in depth for a single webcam."],
    )
    r.part(
        "3D and 2D joint angles",
        what="Shoulder elevation, elbow angle and other joint angles are computed from the world (3D) landmarks when available, otherwise from image (2D) landmarks scaled to pixels.",
        how=[
            "`web/src/vision/angles.ts` computes elevation (upper arm against the shoulder-to-hip line) and the elbow angle.",
            "`web/src/vision/hand.ts` and `measures.ts` compute hand measures in palm lengths (wrist to middle-finger knuckle): opening and thumb-to-finger distances.",
            "The validation page `/dev/angle-validation` records both 3D and 2D angles for comparison with a clinometer (`web/src/dev/validation/`).",
        ],
        why="3D angles are less affected by the arm's orientation to the camera; 2D is a fallback when world landmarks are missing.",
        alternatives=["**2D only:** angles shrink when the arm points towards the camera.", "**Inverse kinematics models:** more complex, not needed for these measures."],
    )
    r.part(
        "Filtering: One Euro for the cursor only, raw values saved",
        what="Two different smoothers, each with one job, and raw values for everything saved.",
        how=[
            "The on-screen cursor (fingertip) is smoothed with a One Euro filter (min cutoff 1.0 Hz, β = 0.01; `web/src/vision/oneEuro.ts`), in `tracking.ts` as `fingertipSmoothSw`; it holds its last position through gaps under 500 ms. The pinch level uses the same filter (`web/src/input/pinchSource.ts`).",
            "Warm-up counting uses `AngleFilter` (`web/src/vision/angleFilter.ts`): a 5-frame median removes single spikes, then a moving average (α = 0.4). Its own comment: \"For counting repetitions only. Saved data must use raw values.\"",
            "Saved data uses the raw values: `fingertipRawSw`, `wristRawSw` and each repetition's `rawPeakValue` (`web/src/warmup/repCounter.ts`).",
        ],
        why="A smooth cursor is pleasant to control, but smoothing changes timings and peaks; measures (speed, smoothness, range) must come from raw data so the filter does not bias them.",
        alternatives=["**One filter for everything:** biases the saved measures.", "**Kalman filter:** needs a motion model; the One Euro filter is simpler and designed for pointing."],
    )
    r.p("Note: `docs/methods-draft.md` section 4 used to say the one-euro filter smooths values before counting; the code uses `AngleFilter` there, and the methods draft was corrected to match (Day 20).", italic=True)
    r.part(
        "Tracking quality",
        what="The camera check and the games watch the tracking all the time.",
        how=[
            "The camera check needs camera on, shoulders in view, the affected arm in view and enough light (`web/src/vision/setupChecks.ts`), and shows the frame rate and delegate.",
            "`tracking.ts` marks the hand absent after 500 ms without detection (`handPresent`, `handLostMs`).",
            "Trials record data quality, and the feedback rules can suggest better light or distance when tracking was lost often (a \"camera sometimes lost sight of your hand\" tip).",
        ],
        why="Bad tracking gives bad measures; it is better to tell the patient and record it than to silently store noise.",
        alternatives=["**No checks:** silent errors in the measures."],
    )
    r.figure("screens/camera-check.png", "The camera check with the replayed recording (landmarks only, no video)", 13)


def chapter_5(r: Any) -> None:
    r.h1("Calibration and warm-up")
    r.part(
        "Reach calibration",
        what="At the start of each session the patient reaches out in 8 directions; the furthest reach in each makes the reach map.",
        how=[
            "`web/src/pages/session/SessionCalibratePage.tsx` shows 8 stars at 0°–315° in 45° steps.",
            "The wrist moves outwards for up to 20 s of active time; a direction counts as reached at 0.6 SW (`docs/methods-draft.md` 3).",
            "The convex hull of the 8 furthest points is the reach area (measure K1, SW²), saved with `POST /api/sessions/{id}/calibration`.",
            "Games place targets inside this map; L2's priors are nudged by it (chapter 8).",
        ],
        why="Targets in the patient's own workspace are reachable but challenging, and the area itself is a progress measure.",
        alternatives=["**Fixed target positions:** too hard for some, too easy for others."],
    )
    r.figure("screens/calibration.png", "Reach calibration", 12)
    r.h2("The six warm-up exercises")
    r.table(
        ["Exercise", "Measure", "Standard rest / target"],
        [
            ["Shoulder flexion", "Arm elevation forward (°)", "30° / 90°"],
            ["Shoulder abduction", "Arm elevation sideways (°)", "30° / 80°"],
            ["Elbow flexion and extension", "Elbow angle (°)", "140° / 70°"],
            ["Forward reach", "Wrist distance forward / arm length", "0.45 / 0.80"],
            ["Hand opening and closing", "Mean wrist-to-fingertip / palm length", "1.2 / 1.6"],
            ["Thumb opposition", "Thumb-to-fingertip distance (palm lengths)", "touch 0.25, release 0.40"],
        ],
        "The warm-up exercises and their standard thresholds (`web/src/warmup/exercises.ts`, `docs/methods-draft.md` 4)",
        [4.5, 6.5, 5.5],
    )
    r.p("Each exercise has 10 target repetitions (5 rounds for opposition) and lasts at most 90 s (`exercises.ts`: `TARGET_REPS`, `THUMB_TARGET_REPS`, `MAX_DURATION_SEC`).")
    r.figure("screens/warmup-grid.png", "The six warm-up exercises", 16)
    r.part(
        "Repetition counting with hysteresis",
        what="A state machine counts a repetition when the measure goes from the rest line to the target line and back.",
        how=[
            "`web/src/warmup/repCounter.ts` has four states: `REST` → `MOVING` → `AT_TARGET` → `RETURNING` → `REST`.",
            "Hysteresis (`DEFAULT_HYSTERESIS = 3` in the measure's unit) stops noise from starting a movement or turning it round.",
            "A repetition must last 0.6–8 s (`DEFAULT_MIN_REP_MS = 600`, `DEFAULT_MAX_REP_MS = 8000`).",
            "A movement that passes 60% of the way but not the target is a partial repetition (`DEFAULT_PARTIAL_FRACTION = 0.6`).",
            "Feedback (\"higher\", \"slow\", \"almost\", \"good\") is given during the movement.",
            "Thumb opposition uses a sequence counter: touches in finger order (`web/src/warmup/sequenceCounter.ts`).",
        ],
        why="Simple thresholds double-count when the angle jitters around a line; hysteresis and timing limits make the count robust and explainable.",
        alternatives=["**Peak detection on the signal:** sensitive to noise and to slow movements.", "**A learned classifier:** needs labelled patient data the project does not have."],
    )
    r.part(
        "Compensation detection",
        what="Detects trunk movement, trunk lean and shoulder hiking, which patients use to make a movement easier.",
        how=[
            "A 2 s baseline of the usual posture is taken at the start (`web/src/warmup/compensationConfig.ts`: `baselineMs: 2000`).",
            "Thresholds: shoulder-midpoint movement 0.15 SW, trunk lean 10°, shoulder hike 0.08 SW.",
            "A threshold must stay exceeded for 300 ms (`sustainMs`), and cues are at least 5 s apart (`cueIntervalMs`).",
            "Arm exercises check all three; hand exercises only trunk movement.",
            "The cue is shown (\"Keep your back against the chair\") and each repetition records whether it was compensated (`web/src/warmup/compensation.ts`).",
        ],
        why="Compensation inflates the measured range and builds bad habits; therapists want to know about it.",
        alternatives=["**No detection:** misleading ranges.", "**Fixed absolute thresholds without a baseline:** fail with different sitting positions."],
    )
    r.figure("screens/compensation-warning.png", "A compensation cue during shoulder flexion", 12.5)
    r.part(
        "Personalised targets",
        what="Each exercise's target is adjusted from the patient's history.",
        how=[
            "`web/src/warmup/personalise.ts` reads the last results for the exercise.",
            "Raise the target one step when at least 90% of reps were full and compensation was at most 20% (`RAISE_SUCCESS`, `RAISE_MAX_COMPENSATION`).",
            "Lower it when fewer than 60% were full or compensation was 30% or more (`LOWER_SUCCESS`, `LOWER_COMPENSATION`).",
            "Steps: 5° for angles, 0.05 for ratios, 0.03 for touch distance; limits: never beyond the best peak, at most 15% past the standard target, never below the gentle preset.",
            "Each decision has a reason (`first_time`, `raised`, `lowered_reps`, `lowered_compensation`, `kept`, `limited`) shown to the therapist.",
            "Repeatability visits always use the standard preset (chapter 14).",
        ],
        why="A fixed target is too hard for some and too easy for others; small, explained steps keep it achievable and transparent.",
        alternatives=["**The same targets for everyone:** demotivating.", "**Engine-style adaptation per repetition:** too fast for a warm-up, and harder to explain."],
    )


def chapter_6(r: Any, f: Any) -> None:
    r.h1("Games")
    r.p("All nine games run on one shell, `web/src/games/shared/GameShell.tsx`: a fixed-timestep loop, the HUD (turn, score, level, time), pause, results and trial saving. Each game's settings, their bounds and the difficulty component each belongs to are in `shared/game-specs.json` (exported from the web code by `npm run export:specs` and read by the server).")
    r.figure("screens/games-grid.png", "The nine games during play (test mode, replayed movement)", 16)
    r.h2("Therapeutic goal and controls")
    rows = []
    for game in f.games:
        goal, control, folder = GAME_NOTES[game["id"]]
        rows.append([f.strings.get(game["name_key"], game["id"]), goal, control, f"`{folder}`"])
    r.table(["Game", "Therapeutic goal", "Controls", "Code"], rows, "The nine games", [2.6, 4.2, 6.6, 3.1])
    r.h2("Parameters (from shared/game-specs.json)")
    for game in f.games:
        name = f.strings.get(game["name_key"], game["id"])
        rows = []
        for param in game["params"]:
            label = f.strings.get(param["label_key"], param["name"])
            bounds = f"{param['min']}–{param['max']}" if param["min"] != param["max"] else f"fixed {param['min']}"
            harder = param["harder"] or "–"
            rows.append([label, f"`{param['name']}`", bounds, str(param["default"]), param["unit"], harder, param["component"]])
        r.table(
            ["Setting", "Name", "Range", "Default", "Unit", "Harder when", "Component"],
            rows,
            f"{name}: {game['trials_default']} trials by default, about {game['estimated_minutes']} min",
            [3.4, 3.6, 2.0, 1.5, 1.4, 1.8, 2.3],
        )
    r.part(
        "Trial logging",
        what="Every trial is saved with its settings, outcome and measures.",
        how=[
            "The game reports each trial's outcome (success, reach failure, activation failure, miss), timings and the trajectory (at most 2,000 points) to the shell (`docs/methods-draft.md` 5).",
            "The shell saves trials in batches with retries: `POST /api/games/{run}/trials` (`server/app/api/games.py`).",
            "Compensation and, when the muscle sensor is used, a capped %MVC trace (at most 1,500 points) and EMG measures are included (`web/src/emg/trialEmg.ts`).",
            "The server computes trial measures (`server/app/services/trial_metrics.py`) and the session's (`session_metrics.py`).",
        ],
        why="The engine needs every outcome, the therapist needs the details, and research needs the raw trajectory.",
        alternatives=["**Only session summaries:** the engine and SPARC need per-trial data.", "**Full-rate trajectories:** too large; 2,000 points keep the shape."],
    )
    r.figure("screens/level-display.png", "The HUD with the level the patient sees (1–10)", 16)
    r.figure("screens/game-results.png", "A game's results with the level reached", 12)


def chapter_7(r: Any) -> None:
    r.h1("Input abstraction and camera fallback")
    r.part(
        "Level sources",
        what="Every game reads its control from a \"level source\": a number from 0 to 1 and whether it is ready.",
        how=[
            "`web/src/input/types.ts` defines `LevelSource`: `isReady()`, `getLevel()`, `start()`, `stop()`, `subscribe()`.",
            "Sources: camera grip (`cvGripSource.ts`), camera openness (`opennessSource.ts`), pinch (`pinchSource.ts`), finger touch (`fingerTouchSource.ts`), the muscle sensor (`emgSource.ts`) and the keyboard (`keyboardSource.ts`, development only).",
            "`emgSource.ts` turns %MVC into a level (`clamp(%MVC / 100, 0, 1)`), smoothed 50 times a second (α = 0.3).",
        ],
        why="The games do not need to know where the control comes from, so a new sensor needs no game changes.",
        alternatives=["**Each game reading the camera or sensor directly:** duplicated code and no fallback."],
    )
    r.part(
        "The input manager and the camera fallback",
        what="Chooses a source and, while it is not ready, uses its fallback.",
        how=[
            "`web/src/input/inputManager.ts` holds the sources and a fallback map, for example `{ emg: \"cv_grip\" }` (`useActivation.ts`).",
            "The muscle sensor is preferred when today's calibration is at the matching site (flexors for grip, extensors for opening).",
            "It is not ready when unplugged, uncalibrated, at the other site, with an electrode off, or with more than the allowed share of samples lost in the last second (EMG setting `gameMaxGapsPct`, default 1%).",
            "While it is not ready the camera is used and the game says \"Muscle sensor paused — using the camera\" (`game.emgPaused`); as soon as it recovers it is used again.",
            "When the ESP32 is plugged back in, the engine reopens the same port without a chooser after 500 ms, sends PING, INFO and START, and keeps today's calibration (`web/src/emg/engine.ts`).",
        ],
        why="A home session should never stop because a cable was pulled; the camera is always there.",
        alternatives=["**Stop the game:** frustrating.", "**Silently switch:** the patient and therapist must know which source was used, so the trial records it."],
    )
    r.p("The whole path (unplug → camera fallback → replug → sensor again) is tested without hardware in `web/src/emg/hardwarePath.test.ts` (chapter 14).")


def chapter_8(r: Any) -> None:
    r.h1("AI adaptation")
    r.p("The full design is in `docs/ai-engine.md`. Principles: bounded (never outside the game's bounds or the therapist's maximum), safety wins (a safety layer after every decision), explained (every decision logged with a reason), and gentle for patients (they see only a level from 1 to 10 and sometimes a short cue).")
    r.part(
        "Difficulty components",
        what="Each game's settings are grouped into components, each a number d between 0 and 1: spatial, precision, speed and activation.",
        how=[
            "`shared/game-specs.json` gives each setting's component and whether higher or lower is harder.",
            "`server/app/engine/difficulty.py` maps each d to its settings within their bounds.",
            "The level the patient sees (1–10) is derived from the components.",
        ],
        why="Engines can reason about a few meaningful dimensions instead of many raw settings, and a failure can be blamed on the right one.",
        alternatives=["**One overall difficulty:** cannot ease only what failed.", "**Raw settings:** too many dimensions to learn quickly."],
    )
    r.part(
        "L0: fixed settings",
        what="Always the therapist's default settings; nothing adapts.",
        how=["`server/app/engine/l0_fixed.py` returns the admin's defaults, capped at the patient's maximum.", "The safety layer's cues still reach the patient, but the level never moves."],
        why="The control condition for research, and an option when a therapist wants fixed settings.",
        alternatives=["**No control condition:** studies could not show what adaptation adds."],
    )
    r.part(
        "L1: weighted transformed up-down staircase (default)",
        what="A staircase per component: two successes in a row make one component harder, one failure makes the component it points at easier.",
        how=[
            "`server/app/engine/l1_staircase.py`: step up 0.06 after 2 successes in a row; step down 0.08 after a failure.",
            "After two successes, the component with the most room below the patient's maximum moves (ties take turns).",
            "After a failure, the component the failure type points at moves: `reach_fail` → spatial then precision; `activation_fail` → activation; `miss` → speed then spatial; otherwise every component by 0.04.",
            "An aborted trial changes nothing.",
            "Warm restart: the first time a game is played in a new session, every d is eased by 0.05.",
            "Levitt's 2-down-1-up rule converges near 70.7% success; with the unequal steps (Kaernbach's weighted up-down idea) a simulated patient settles near 75%, inside the 60–80% band aimed for in motor practice (`docs/ai-engine.md`).",
        ],
        why="Simple, proven, explainable to a therapist, and it converges in a few trials. In simulation it was the most robust engine for moderate and severe patients, so it is the default.",
        alternatives=["**Equal steps (plain 2-down-1-up):** ~70.7%, but eases slower after a failure.", "**3-down-1-up (~79%):** too slow to respond in short sessions.", "**PID-style control on success rate:** needs a long history and tuning."],
    )
    r.part(
        "L2: Bayesian, workspace-aware, Thompson sampling",
        what="Keeps Beta beliefs about the chance of success for each direction sector and distance ring, and for each level of the other components, and chooses the next trial by Thompson sampling aimed at 70% success.",
        how=[
            "`server/app/engine/l2_bayes.py`. Sectors: Reach and squeeze uses 8 directions, Balloon pop the upward 45°/90°/135°, Pick and place four carry directions, Path trace outward and inward, Fruit catch two sides.",
            "Rings of distance with Beta priors: R1 0.40–0.55 Beta(4,1), R2 0.55–0.85 Beta(3,2), R3 0.85–1.00 Beta(2,2), R4 stretch 1.00–1.10 Beta(1,3), opened once R3's mean exceeds 0.8 from at least 5 trials.",
            "Priors are nudged by the calibration (a short direction: rings 2–4 0.1 less likely) and the warm-up (forward reach and hand opening, compensation).",
            "Other components have 6 levels (d = 0, 0.2 … 1) with priors centred near 0.7 at the default level.",
            "Updates: success adds 1 to α of the sector and every level used; a failure counts only against what it points at (a reach failure may be shared between sector and precision in proportion to how likely each was).",
            "Choosing: each of the k required parts aims at 0.70^(1/k); the sector maximises −|θ − aim| + 0.05 × min(2, trials since chosen / 10) × the posterior mean (a coverage bonus weighted by plausibility); each level component takes the level whose draw is closest to the aim.",
            "Monotone levels: after each update, isotonic regression by pool-adjacent violators keeps an easier level never less likely than a harder one.",
            "Forgetting between sessions: α ← α₀ + 0.7(α − α₀), the same for β (30% back towards the prior).",
            "No sector more than twice in a row; compensated rings are skipped; draws are seeded so the same state gives the same choice.",
        ],
        why="It learns where in the workspace the patient struggles and practises there, which a staircase cannot; Thompson sampling balances exploring and practising naturally.",
        alternatives=["**Deep reinforcement learning:** needs far more data than one patient gives, and is hard to explain or bound.", "**Epsilon-greedy:** explores blindly.", "**Upper confidence bound:** aims at the most likely success, not a 70% target."],
    )
    r.part(
        "The safety layer",
        what="`server/app/engine/safety.py` runs after every engine decision and can block or reverse it; the engine cannot override it. Its rules apply in this order.",
        how=[
            "Hard bounds: every d within [0, the therapist's maximum].",
            "Compensation in 2 of the last 3 trials: spatial components may not get harder.",
            "3 failures in a row: every component eased by 0.15.",
            "Tiring (last 5 trials against the first 5: success down 0.4, movement time up over 30%, or activation peak down over 20%): every component eased by 0.1 and a rest suggested.",
            "Session time: \"finish soon\" after 25 minutes of active play and \"finish\" after 35 (`SESSION_FINISH_SOON_MIN`, `SESSION_FINISH_MIN`).",
        ],
        why="Adaptation must never push a tired or compensating patient harder; separating safety from the engine means every engine gets the same guarantees.",
        alternatives=["**Safety inside each engine:** duplicated, and one engine could forget a rule."],
    )
    r.part(
        "The decision log (AdaptationLog)",
        what="Every engine decision is stored with its reason.",
        how=["`server/app/models/adaptation_log.py`: the state before and after, the plain-language reason, any safety override, and L2's samples in `details`.", "The admin's session page shows it; patients never see the reasons (and never see the word \"AI\")."],
        why="Therapists and researchers must be able to see why the difficulty changed; it also makes debugging and research analysis possible.",
        alternatives=["**No log:** a black box nobody could trust."],
    )
    r.part(
        "The session planner",
        what="Chooses and orders 2–6 games for each session within the programme.",
        how=[
            "`server/app/services/planner.py` scores each allowed game by need (its measures against the baseline: worse, no detectable change, improved), recency and enjoyment.",
            "After high fatigue, pain or \"too hard\" it plans a lighter day.",
            "Every chosen game gets a plain-language reason (shown with \"Why this game?\").",
            "In a study, the study's locked games are played instead (chapter 12).",
        ],
        why="Practice should target what needs work while staying varied and enjoyable.",
        alternatives=["**A fixed list:** ignores progress.", "**Random choice:** no therapeutic reasoning."],
    )
    r.figure("screens/session-plan.png", "The plan with a reason for each game", 12.5)
    r.h2("Simulation")
    r.p("`analysis/run_simulation.py` and `server/app/engine/sim/` simulate patients whose success per component follows 1 / (1 + e^(−k(ability − demand))), with fatigue within a session and learning between sessions, running the server's real engines and safety layer. 20 patients per profile (mild, moderate, severe) and engine; Reach and squeeze 10 sessions × 40 trials. Measures: success, challenge error from 0.7, time in the 60–80% zone, convergence, compensation, coverage, learning gain (`docs/simulation-results.md`). These are simulated patients, not people.")
    rows = [row for row in r.facts.results if row[2] == "simulation"]
    if rows:
        r.table(["Result", "Value [95% CI]", "Label", "Source"], [list(row) for row in rows], "Simulation results (from docs/results-summary.md)", [6.8, 3.6, 2.0, 4.1])
    r.p("Interpretation (`docs/known-issues.md`): L2 kept mild patients closer to the target than L1 but did worse for moderate and severe profiles, mainly because 24–32 independent sector beliefs learn slowly in 40-trial sessions; L1 is therefore the default and L2 is offered alongside it.")


def chapter_9(r: Any, f: Any) -> None:
    r.h1("Metrics")
    r.part(
        "The metric catalogue",
        what="One shared list of every measure: id, name, unit, whether higher, lower or closer to zero is better, source and level (trial or session).",
        how=["`shared/metrics-catalog.json` is read by the server (`server/app/services/metrics_catalog.py`) and listed in `docs/data-dictionary.md`.", "Trial measures: `server/app/services/trial_metrics.py`; session measures: `session_metrics.py`; kinematics: `server/app/metrics/`."],
        why="One definition for the server, the dashboards, the reports and the research exports.",
        alternatives=["**Measures defined in several places:** they drift apart."],
    )
    rows = [[m["id"], m["name"], m["unit"], m["better_when"], m["level"]] for m in f.metrics]
    r.table(["Id", "Measure", "Unit", "Better when", "Level"], rows, "The metric catalogue (shared/metrics-catalog.json)", [1.3, 6.5, 2.5, 3, 2.2])
    r.part(
        "SPARC smoothness",
        what="The spectral arc length of the speed profile: smoother movements give values closer to zero.",
        how=["The speed profile is resampled (`web/src/metrics/resample.ts`, `server/app/metrics/sparc.py`).", "Its Fourier magnitude spectrum is normalised; the arc length of the spectrum up to an adaptive cut-off is SPARC (Balasubramanian et al., 2015).", "The browser and the server share test vectors (`shared/test-vectors/`)."],
        why="Robust to movement duration and amplitude, and widely used in rehabilitation research.",
        alternatives=["**Jerk-based measures:** very sensitive to noise and duration.", "**Number of speed peaks:** coarse (it is kept as a secondary measure)."],
    )
    r.part(
        "Baselines and MDC",
        what="Change is judged against the patient's own baseline in units of the minimal detectable change (MDC).",
        how=[
            "Baseline: the mean of the first two sessions with the measure.",
            "From the third session: (latest − baseline) / MDC; improved at ≥ +1 MDC, worse at ≤ −1, otherwise no detectable change (`docs/methods-draft.md` 10).",
            "MDC95 = 1.96 × √2 × SEM, from repeatability visits (`analysis/validation/stats.py`).",
            "`server/app/core/mdc.py` uses measured MDCs from `analysis/results/validation/mdc.json` only when it is labelled REAL DATA (never the demo folder); otherwise provisional placeholders (`PROVISIONAL_MDC`), and the admin's table shows \"provisional\".",
        ],
        why="A change smaller than the measurement's own noise is not a real change; saying \"improved\" for noise would mislead patients.",
        alternatives=["**Percent change:** ignores measurement noise.", "**Statistical tests per session:** too few data points."],
    )
    r.p("Status: the measured MDCs are PENDING (the repeatability visits have not been done); every MDC in use is provisional.", italic=True)
    r.part(
        "Progress and alerts",
        what="Progress pages for patients and therapists, and alerts for therapists.",
        how=[
            "Patients see streak, weekly goal, a 4-week calendar and trend charts (`web/src/pages/patient/PatientProgressPage.tsx`).",
            "Therapists see measures with MDC badges, reach maps over time and warm-up decisions (`web/src/features/admin/`).",
            "`server/app/services/alerts.py` raises: pain, new symptoms, high fatigue, sharp decline, missed sessions, repeated device problems, and many template reports.",
        ],
        why="Patients stay motivated by visible progress; therapists act on problems early.",
        alternatives=["**Email or SMS alerts:** not wanted (no personal contact data leaves the system)."],
    )
    r.figure("screens/progress-charts.png", "A patient's progress charts", 12.5)


def chapter_10(r: Any) -> None:
    r.h1("LLM feedback")
    r.p("Principle: \"the code calculates, the rules decide, the model only writes\" (`docs/ai-engine.md`, `server/app/feedback/README.md`).")
    r.part(
        "The pipeline",
        what="A short report after each session, written by a local model from facts, checked, and replaced by a template if the check fails.",
        how=[
            "Facts: `server/app/services/session_facts.py` builds a JSON of the session's measures with their MDC status, the games, the questionnaire and a patient code (no name) (`docs/session-facts.md`).",
            "Rules: `server/app/feedback/rules.py` chooses up to three suggestions from a fixed catalogue of 13 types (`catalogue.yaml`) and detects red flags (pain, new symptoms).",
            "Prompt: `prompt.py` gives the model the facts and the chosen suggestions, with a JSON schema for the answer.",
            "Model: `llm.py` calls Ollama (`qwen3.5:4b`, temperature 0.2, top-p 0.9, 700 tokens at most).",
            "Validator: `validate.py` checks every number against the facts, that direction words (\"improved\", \"worse\") agree with the MDC status, banned medical words (`banned.txt`, `banned_bn.txt`), the script of the language and word limits; up to 2 retries with the errors listed.",
            "Fallback: if every attempt fails, `fallback.py` writes a deterministic template report.",
            "Safety notices: red flags add fixed notices from `shared/safety-notices.json`, added by the code, never by the model.",
        ],
        why="A language model writes naturally but can invent numbers or give medical advice; letting it only phrase what code computed and rules chose keeps it safe.",
        alternatives=["**Templates only:** safe but repetitive.", "**A model writing freely from raw data:** hallucinated numbers and advice.", "**A cloud model:** sends data off the computer."],
    )
    r.figure("screens/report-en.png", "A feedback report in English (test mode: the template's text)", 12.5)
    r.part(
        "Bangla",
        what="Reports in Bangla, chosen by `LLM_BN_STRATEGY`.",
        how=["`direct`: the model writes Bangla; `translate`: English, then translated; `template`: no model.", "The validator checks the Bangla script and Bangla banned words.", "`analysis/llm/eval_bangla.py` compares the strategies (PENDING)."],
        why="Small models write Bangla less reliably than English, so the strategy can be chosen by evaluation.",
        alternatives=["**English only:** excludes many patients in Bangladesh."],
    )
    r.figure("screens/report-bn.png", "The same report in Bangla", 12.5)
    r.part(
        "The job queue",
        what="Reports are background jobs, one at a time.",
        how=[
            "`server/app/feedback/jobs.py`: an in-process asyncio priority queue with one worker, so only one generation uses the GPU at a time; patients' reports go before blind-review reports.",
            "Rows (`LlmReport`) go `queued` → `running` → `done`, `fallback` or `failed`.",
            "Each attempt is limited by `LLM_TIMEOUT_S` (60 s) and the job by `LLM_JOB_LIMIT_S` (120 s); then the template is used. Unreachable Ollama: the template at once.",
            "The questionnaire queues the report; it waits up to `FEEDBACK_SESSION_END_WAIT_S` for the session to end.",
            "Jobs left by a stop are queued again at start-up.",
        ],
        why="A single laptop GPU cannot run two generations at once; a queue keeps the API responsive.",
        alternatives=["**Celery and Redis:** extra services for a single-computer system."],
    )
    r.h2("Privacy, evaluation and hardware limits")
    r.bullets([
        "**Privacy:** the model is local (Ollama on the same computer) and gets only the facts JSON with a patient code.",
        "**Evaluation:** automatic metrics (validity at the first attempt, numeric faithfulness, direction errors, banned words, template rate, latency) and a blind human comparison (accuracy, safety, helpfulness, clarity, tone, 1–5) are designed (`docs/llm-evaluation.md`); the results are PENDING.",
        "**4 GB GPU:** the project laptop has an NVIDIA RTX 3050 with 4 GB. `qwen3.5:4b` (3.3 GB) does not fit entirely: it runs about 50% CPU / 50% GPU at about 19 tokens per second (`docs/ai-engine.md`, `analysis/llm/compare_models.py`). Smaller candidates (`qwen3.5:2b`, `phi4-mini`) fit; their speed and the final choice are PENDING (`docs/llm-model-choice.md`).",
    ])


def chapter_11(r: Any, f: Any) -> None:
    r.h1("EMG (muscle sensor)")
    r.part(
        "The sensor and its envelope",
        what="An Advancer Technologies Muscle Sensor V3.0: one channel, three snap electrodes, output SIG an envelope (amplified, rectified and smoothed EMG).",
        how=["The envelope says how strongly the muscle works, when a contraction starts and ends, and how steady it is.", "It cannot give frequency measures such as fatigue spectra (`firmware/README.md`)."],
        why="Low cost, simple to wire, and the envelope is exactly what grip level and onsets need.",
        alternatives=["**Raw EMG front-ends (for example ADS1292):** more complex, higher sampling needed.", "**Multi-channel research systems:** expensive."],
    )
    r.part(
        "Wiring and the voltage divider",
        what="Two 9 V batteries power the sensor (±9 V); SIG reaches ESP32 GPIO34 through a divider that keeps the pin at or below 3.0 V.",
        how=[
            "Battery 1 (+) → +Vs; the batteries' midpoint → sensor GND; battery 2 (−) → −Vs.",
            "SIG → R_top 20 kΩ → GPIO34 → R_bottom 10 kΩ → GND (ratio 0.33: 8 V becomes 2.7 V); common ground to the ESP32.",
            "Measure V_max at SIG first and keep R_bottom / (R_top + R_bottom) ≤ 3.0 / V_max; optional Schottky clamp to 3V3.",
            "GPIO34 is input-only on ADC1, which works alongside the radio (`firmware/README.md`, `docs/hardware-day.md`).",
        ],
        why="SIG can reach about 8 V, which would damage the ESP32 (above about 3.6 V).",
        alternatives=["**A level-shifter IC:** unnecessary for a slow envelope.", "**Mains power:** never allowed while electrodes are on a person."],
    )
    r.part(
        "Firmware and protocol",
        what="`firmware/emg_stream/emg_stream.ino` samples at 500 Hz and streams text lines at 230400 baud.",
        how=[
            "A FreeRTOS task on core 0 reads the ADC every 2 ms (`vTaskDelayUntil`) into a static queue; it never prints or allocates.",
            "`loop()` on core 1 prints `E,<counter>,<mV>` per sample and `S,<counter>,<dropped>,<version>,<ADC|SIM>` once a second.",
            "Commands: `START`, `STOP`, `PING` (→ `PONG,<version>`), `RATE <hz>` (100–1000), `SIM ON|OFF` (a simulated envelope), `INFO` (→ `I,key=value,…`); replies `OK,…` or `ERR,…`.",
            "After `START`, samples are skipped until counter 0, so none from before the restart slips out (Day 20).",
            "The browser parser (`web/src/emg/protocol.ts`) and the Python parser (`analysis/tools/emg_protocol.py`) follow the same rules, tested against `firmware/test-lines.txt`.",
        ],
        why="A counter on every sample makes lost data visible; text lines are easy to test in the Serial Monitor.",
        alternatives=["**Binary packets:** faster but hard to debug by hand; 500 Hz text fits easily in 230400 baud."],
    )
    r.part(
        "Timing",
        what="Sample times come from the counter, not the arrival time.",
        how=["`web/src/emg/clock.ts` (`SampleClock`) maps counters to times at the known rate and detects gaps and restarts.", "Arrival statistics give the measured rate and lost samples over recent windows (`engine.ts`: `arrivalStats`)."],
        why="USB delivers samples in bursts; counter-based times are exact and gaps are counted precisely.",
        alternatives=["**Arrival timestamps:** jittery by tens of milliseconds."],
    )
    r.part(
        "The nine-item readiness check",
        what="Like the camera check: nine items, each green or red with its value and a hint.",
        how=[
            "`web/src/emg/readiness.ts`: 1 Web Serial available, 2 connected, 3 PONG within 2 s, 4 rate 490–510 per second over 2 s, 5 lost samples under 0.5% over 5 s, 6 electrode contact (SD over 1 s above 2 mV), 7 no saturation (≥ 3000 mV) over 5 s, 8 relaxed and stable (SD ≤ 40 mV, mean ≤ 800 mV over 2 s), 9 a test squeeze (peak ≥ 3 × the relaxed mean with an onset).",
            "Items 1–8 must stay green for 2 s, then the test squeeze passes once.",
            "Every threshold is an EMG setting (Appendix and below), editable by an admin.",
        ],
        why="Most EMG problems are set-up problems (electrodes, batteries, gain); a checklist finds them before calibration.",
        alternatives=["**Calibrate straight away:** a bad set-up would give a bad calibration."],
    )
    r.figure("screens/emg-readiness.png", "The nine-item sensor check (simulated sensor)", 13)
    r.part(
        "Rest and MVC calibration, %MVC",
        what="The relaxed level and the maximum voluntary contraction (MVC) give each session's scale.",
        how=[
            "`web/src/emg/calibration.ts` and `emgFlow.ts`: 10 s relaxed (accepted if the smoothed SD is between 2 and 40 mV and the mean is at most 800 mV).",
            "Three 3 s maximum efforts after a 3 s countdown, with rests; each counts as its highest 0.5 s mean; a saturated effort is repeated; an extra effort if they differ by more than 15%.",
            "MVC = the mean of the efforts (or the three closest of four); it must be at least 3 × the rest mean.",
            "%MVC = (envelope − rest) / (MVC − rest) × 100, clamped to 0–120 (`processing.ts`); onsets at rest mean + 3 SD for 50 ms, offsets after 100 ms below.",
            "The calibration is stored as numbers only: `POST /api/sessions/{id}/emg-calibration`.",
        ],
        why="Raw millivolts differ between people, electrode placements and days; %MVC makes the level comparable and meaningful.",
        alternatives=["**Fixed millivolt thresholds:** fail for most people.", "**Calibrating once for all sessions:** electrode placement changes every day."],
    )
    r.figure("screens/emg-calibration.png", "EMG calibration: a maximum effort", 12)
    rows = [[key, str(rule["default"]), f"{rule['min']}–{rule['max']}", rule["unit"], rule["group"]] for key, rule in f.emg_settings.items()]
    r.table(["Setting", "Default", "Limits", "Unit", "Group"], rows, "Every EMG threshold (web/src/emg/emgSettings.json; Admin → System → EMG settings)", [4.6, 2.2, 3, 1.6, 2.6])
    r.figure("screens/emg-settings.png", "The admin's EMG settings panel", 13)
    r.h2("Testing without hardware and safety")
    r.bullets([
        "**Mock board:** `web/src/emg/mockSerial.ts` plays the firmware protocol behind the Web Serial interface (rate, noise, lost counters, saturation, garbled lines, slow PONG, unplug and replug), tested end to end in `hardwarePath.test.ts`.",
        "**Board simulation:** firmware `SIM ON` data goes through the same path, with a \"Board simulation\" badge and the mode stored with the calibration.",
        "**`/dev/emg-monitor`:** a development page with a live plot, readiness, commands and \"Record 30 s CSV\"; `analysis/emg/emg_validation.py` analyses the recordings (results PENDING).",
        "**Safety:** the laptop runs on battery with the charger unplugged whenever electrodes are on a person; the sensor runs on batteries only; the safety questions must be answered before connecting (`docs/hardware-day.md`).",
        "**Status:** the real ESP32 and electrodes have not been tested yet (Day 21); every EMG hardware result is PENDING.",
    ])


def chapter_12(r: Any) -> None:
    r.h1("Dashboards and research mode")
    r.figure("screens/admin-dashboard.png", "The admin overview", 13)
    r.part(
        "Programmes",
        what="What each patient may do: the therapist's limits, which every engine and the planner respect.",
        how=[
            "`server/app/services/programme.py` stores the enabled games and each one's highest level, games per session, session length, rest frequency, warm-up exercises and targets, and the EMG default site.",
            "Every change is kept with its reason (`ProgrammeChange`).",
        ],
        why="The therapist stays in control; the AI adapts only inside these limits.",
        alternatives=["**No limits:** unsafe."],
    )
    r.figure("screens/patient-programme.png", "A patient's programme", 13)
    r.part(
        "Research mode: Latin square and blinding",
        what="Controlled studies comparing the engines (L0, L1, L2).",
        how=[
            "`server/app/services/studies.py`: a within-subject design (every participant plays every condition in an order from a balanced Latin square) or between-subject (balanced randomisation).",
            "Only patients with recorded research consent can be enrolled; conditions are assigned in turn.",
            "During a study, each session plays the next condition with the study's locked games; the programme's highest levels and the safety rules still apply.",
            "Blinding: patients are never told the condition; the session pages and API responses do not reveal it (`web/e2e/research.spec.ts` checks this).",
            "Results per condition: success rate, challenge error, time in the 60–80% zone, compensation, level, enjoyment, fatigue, report ratings, with 95% confidence intervals.",
        ],
        why="Order effects (learning, fatigue) bias comparisons; a balanced Latin square spreads them across conditions.",
        alternatives=["**A fixed order:** confounds the engine with practice.", "**Unblinded sessions:** expectation effects."],
    )
    r.figure("screens/research-mode.png", "Research mode with an active study", 13)
    r.part(
        "Exports and repeatability visits",
        what="Pseudonymous CSV exports and planned repeatability visits.",
        how=[
            "Exports use patient codes only, never names or emails; demo patients are left out unless `include_demo` (`server/app/services/exports.py`).",
            "Repeatability visits: the admin marks the next session as visit 1–3; it is the camera check, calibration and the warm-up with standard targets; `GET /api/admin/patients/{id}/repeatability.csv` exports the values for the MDC analysis.",
        ],
        why="Research data must be analysable without exposing identity; MDCs need repeated identical measurements.",
        alternatives=["**Exporting names:** a privacy risk."],
    )
    r.figure("screens/alerts.png", "Alerts for the therapist", 13)


def chapter_13(r: Any) -> None:
    r.h1("Privacy, security and safety")
    r.h2("Privacy")
    r.bullets([
        "**Video never leaves the browser:** MediaPipe runs in the page; only landmark-derived numbers are sent. `web/e2e/privacy.spec.ts` checks every request of a whole session.",
        "**EMG as numbers only:** the calibration, per-trial measures and a capped %MVC trace.",
        "**The language model is local** and receives a patient code, never a name or email.",
        "**Pseudonymous exports**; research consent recorded with its date.",
        "**Fonts** load from Google Fonts; no session data is sent with them (`docs/security.md`).",
    ])
    r.h2("Security (docs/security.md)")
    r.table(
        ["Area", "Measure", "Where"],
        [
            ["Passwords", "Argon2 hashes (pwdlib)", "`server/app/core/security.py`"],
            ["Tokens", "JWT HS256, expiry `JWT_EXPIRE_MINUTES` (720)", "`server/app/core/security.py`"],
            ["Access", "Patients only reach their own data; admin routes need the admin role", "`server/app/api/deps.py`, `tests/test_access_sweep.py`"],
            ["Login limit", "5 failures per email in 15 minutes, then 429", "`server/app/services/login_limits.py`"],
            ["Requests", "JSON bodies at most 8 MB (413) and depth 32 (422); safe error messages", "`server/app/core/hardening.py`"],
            ["Headers", "Security headers and a content security policy", "`web/src/security/`, `web/security-headers.conf`, nginx"],
            ["Production", "Refuses to start with a default or short admin password or JWT secret; test routes only with `APP_ENV=test`", "`server/app/core/config.py`, `main.py`"],
            ["Build", "No secrets, test code or /dev pages in the production bundle", "`web/scripts/scan-bundle.mjs`"],
            ["Dependencies", "Pinned exactly; `npm audit --omit=dev` and `pip-audit`", "`web/package.json`, `server/requirements.txt`"],
        ],
        "Security measures",
        [2.8, 8.2, 5.5],
    )
    r.h2("Safety")
    r.bullets([
        "**The safety layer** after every engine decision (chapter 8) and the therapist's programme limits.",
        "**Fixed safety notices** for pain or new symptoms, added by the code, not the model; medical words banned from reports.",
        "**Alerts** for pain, new symptoms, high fatigue and sharp declines.",
        "**The muscle sensor:** battery-only, charger unplugged, safety questions first, a voltage divider protecting the ESP32.",
        "**Not a medical device:** no diagnosis and no treatment decisions.",
    ])
    r.figure("screens/accessibility-settings.png", "Display and sound settings (text size, contrast, motion, sounds, voice)", 12)


def chapter_14(r: Any, f: Any) -> None:
    r.h1("Testing and validation")
    r.part(
        "Test strategy",
        what="Unit, integration and end-to-end tests, all runnable without a webcam, sensor or model.",
        how=[
            "Server: pytest (`server/tests/`), with coverage (`docs/testing.md`).",
            "Web: Vitest for pure logic (vision maths, counters, input, metrics, EMG), accessibility with vitest-axe, and translations (`npm run i18n:check`).",
            "End to end: Playwright starts its own API (test mode, mock model, its own database) and web app (test mode) (`web/playwright.config.ts`).",
            "Replay camera: recorded or synthetic landmarks replace the camera (`web/src/testing/`, `?replay=` and `synth:` presets).",
            "Simulated sensor and mock ESP32: `web/src/emg/simulated.ts`, `mockSerial.ts`.",
            "Mock model: `LLM_PROVIDER=mock` writes a valid report in test mode.",
            "Everything at once: `.\\scripts\\check.ps1` (and `-E2E`).",
        ],
        why="The system depends on a camera, a sensor and a model; replacing each with a deterministic double makes every test repeatable on any computer.",
        alternatives=["**Manual testing only:** slow and not repeatable."],
    )
    r.table(
        ["Check", "Result (Day 20)", "Source"],
        [
            ["pytest", "1,472 passed", "Day 20 task 2 full run"],
            ["Vitest", "1,625 passed (145 files)", "Day 20 task 3"],
            ["Playwright fast", "28 passed (Day 18); EMG and admin specs re-run Day 20", "`docs/testing.md`"],
            ["Playwright full", "Not run yet", "`docs/testing.md`"],
            ["Bundle scan", "0 findings", "`npm run scan:bundle`"],
        ],
        "Test results",
        [4, 6.5, 6],
    )
    rows = [list(row) for row in f.results if row[2] != "simulation"]
    r.table(["Result", "Value", "Label", "Source"], rows, "Validation and engineering results (from docs/results-summary.md); PENDING means not measured yet", [6.2, 4.2, 2.1, 4.0])
    r.h2("Validation status")
    r.bullets([
        "**Protocol (pilot, n = 1, healthy):** latency (slow-motion video and stage timings), joint angles against a phone clinometer (RMSE, Bland–Altman), repeatability over three visits (SEM, MDC95, CV%; ICC only with three or more participants), repetition counting on guided recordings (`docs/validation.md`).",
        "**Done:** repetition counting on one guided recording, which counted 25% of the scripted repetitions because the seated arm stayed above the shoulder exercises' 30° rest line; the thresholds are to be decided after the validation session (`docs/known-issues.md`).",
        "**PENDING:** latency, joint angles, MDCs, the LLM evaluation, usability (SUS) and the EMG hardware validation.",
        "**Engineering:** `/api/engine/next` p95 21.5 ms (L1) and 23.9 ms (L2); a load test of 10 patients for 305 s with 0 errors in 11,890 requests and p95 140 ms; 60 FPS in all 9 games on replay (`docs/performance.md`).",
    ])


def chapter_15(r: Any) -> None:
    r.h1("Limitations and future work")
    r.h2("Limitations (docs/known-issues.md)")
    r.bullets([
        "**No clinical evidence yet:** the pilot validation, the LLM evaluation and usability are PENDING; every MDC is provisional.",
        "**Seated repetition counting:** the shoulder rest line was not reached when seated in the one recording checked.",
        "**L2 engine:** worse than L1 for moderate and severe simulated patients.",
        "**Hardware:** the real muscle sensor is untested; a refresh during an EMG session loses the sensor calibration; the frame rate with a real webcam on the target laptop is not measured.",
        "**One camera, one room:** other cameras, angles, lighting and clothing are untested.",
        "**Security:** no HTTPS in the app (needed beyond localhost); the login limit is in memory; tokens cannot be revoked one by one.",
        "**Language:** the Bangla strings and guides need a native speaker's review.",
        "**The model:** `qwen3.5:4b` does not fit fully in a 4 GB GPU; the final model choice is PENDING.",
    ])
    r.h2("Future work")
    r.numbered([
        "Day 21: wire, flash and tune the muscle sensor; record and analyse EMG validation data (`docs/hardware-day.md`).",
        "The pilot validation session: latency, angles, repeatability, measured MDCs (`docs/pending-manual-checks.md`).",
        "The LLM evaluation (automatic and blind human) and the final model choice.",
        "A usability test (SUS) with patients and therapists, with ethics approval.",
        "Tune the seated thresholds and L2's sector learning (for example sharing beliefs between neighbouring sectors).",
        "HTTPS deployment, token revocation, and studies with patients.",
    ])


QA: list[tuple[str, list[tuple[str, str]]]] = [
    ("Motivation", [
        ("Why home rehabilitation?", "Much of the practice after a stroke happens at home, where nobody measures it or keeps it at the right difficulty."),
        ("Why a webcam?", "Every laptop has one, so there is nothing to buy; it measures arm and hand movement without touching the patient."),
        ("Why add EMG at all?", "The camera sees movement but not effort; EMG shows muscle activation even when movement is small, which matters for weak patients."),
        ("Who is it for?", "People after stroke with arm and hand weakness who can sit in front of a laptop, supervised by a therapist."),
        ("What is new compared with existing exergames?", "Camera and EMG behind one input layer with fallback, three comparable adaptation engines under a safety layer, measures judged against MDC, and safe local LLM feedback, all in a browser."),
    ]),
    ("Design", [
        ("Why a browser app?", "No installation, works on any laptop, and MediaPipe runs in the page so video stays private."),
        ("Why a server at all?", "To store sessions, run the engines and the planner, compute measures and write reports, and give therapists a dashboard."),
        ("Why SQLite?", "One file on one computer; the same SQLModel models work with PostgreSQL for a server deployment."),
        ("Why FastAPI?", "Typed request models, automatic API docs, async for the report queue, and Python for NumPy and SciPy."),
        ("How do the browser and server agree on game settings?", "Through `shared/game-specs.json`, exported from the web code and read by the server; tests check both."),
        ("What happens if the network drops?", "Trials are saved in batches with retries; an offline banner shows; the session is resumable."),
    ]),
    ("Computer vision", [
        ("Which models do you use?", "MediaPipe Hand Landmarker and Pose Landmarker (lite), Tasks API 1.2.0, in the browser."),
        ("How do you pick the affected hand?", "By position: the hand whose wrist is within 0.5 shoulder widths of the pose's affected wrist; handedness labels are unreliable with mirrored cameras."),
        ("Why shoulder widths?", "They make distances independent of the person's size and distance from the camera."),
        ("Do you smooth the data?", "Only for display (One Euro on the cursor) and for counting (median plus moving average); saved data is raw."),
        ("What if the GPU is not available?", "The models fall back to the CPU automatically."),
        ("How accurate are the angles?", "PENDING: the clinometer comparison (RMSE and Bland–Altman) has not been run yet."),
        ("What frame rate?", "Up to 30 frames per second from the camera; the measured frame rate on the target laptop is PENDING."),
    ]),
    ("AI adaptation", [
        ("What does \"AI\" mean here?", "The adaptation engines and planner; patients see only a level from 1 to 10."),
        ("Why 70% success?", "Motor-learning practice aims for a challenging but achievable zone (60–80%); 70% is its centre."),
        ("How does L1 work?", "Two successes in a row make one component harder (+0.06); one failure eases the component it points at (−0.08); it settles near 75% in simulation."),
        ("How does L2 work?", "Beta beliefs per direction sector and difficulty level, Thompson sampling aimed at 70% per trial, monotone levels, and 30% forgetting between sessions."),
        ("Why Thompson sampling?", "It balances trying uncertain options and practising known ones naturally, and can aim at a target rate rather than the best."),
        ("Why not deep reinforcement learning?", "It needs far more data than one patient provides, and its decisions are hard to bound and explain."),
        ("Can the AI make it dangerously hard?", "No: the safety layer runs after every decision, enforces the therapist's maximum, and eases difficulty after failures, compensation or tiring."),
        ("Which engine is best?", "In simulation L1 was most robust for moderate and severe profiles; L2 better for mild. Real-patient comparison is PENDING."),
        ("How do you compare engines fairly?", "Within-subject studies with a balanced Latin-square order and blinding."),
    ]),
    ("LLM feedback", [
        ("Why use a language model?", "To write natural, encouraging text; templates alone are repetitive."),
        ("How do you stop hallucinations?", "The model only phrases facts and rule-chosen suggestions; a validator checks every number and direction word; failures fall back to a template."),
        ("Is any patient data sent to the cloud?", "No: the model runs locally in Ollama and gets only a facts JSON with a patient code."),
        ("What if the model says something medical?", "Medical words are banned and checked; red flags get fixed safety notices added by code."),
        ("Why qwen3.5:4b?", "It is the configured default; it runs locally with JSON-schema output; the final choice after the evaluation is PENDING."),
        ("How fast is it on your laptop?", "About 19 tokens per second, half on the 4 GB GPU and half on the CPU (`docs/ai-engine.md`)."),
        ("How is Bangla handled?", "Direct Bangla, English then translation, or template, chosen by `LLM_BN_STRATEGY` and to be decided by evaluation."),
        ("How good are the reports?", "PENDING: automatic metrics and a blind human comparison are designed but not run."),
    ]),
    ("EMG", [
        ("Which sensor and why?", "Muscle Sensor V3.0: cheap, one channel, an envelope output that directly gives activation level and onsets."),
        ("How is it connected?", "SIG through a 20 kΩ/10 kΩ divider to ESP32 GPIO34; the ESP32 streams 500 Hz over USB to the browser by Web Serial."),
        ("Is it electrically safe?", "Battery-powered sensor, laptop on battery with the charger unplugged while electrodes are on, and safety questions before use."),
        ("What is %MVC?", "The envelope above rest as a percentage of the maximum voluntary contraction, from each session's calibration."),
        ("How do you know the data is good?", "A nine-item check: connection, response, rate, gaps, contact, saturation, relaxed stability, and a test squeeze."),
        ("What if the sensor fails mid-game?", "The game switches to the camera and says so, and switches back when it recovers."),
        ("Has it been tested on real hardware?", "Not yet: Day 21. The whole software path is tested with a mock ESP32 that plays the real protocol."),
        ("Why not raw EMG?", "Raw EMG needs higher sampling and processing; the envelope is all the games need."),
    ]),
    ("Games", [
        ("How did you choose the nine games?", "Each trains a movement important after stroke: reaching, shoulder elevation, elbow, hand opening, finger individuation, grip, smoothness and a functional task."),
        ("How do games adapt?", "Each setting belongs to a difficulty component that the engine sets each trial, within the spec bounds and the therapist's maximum."),
        ("What is logged per trial?", "Settings, outcome, timings, trajectory (≤ 2,000 points), compensation and, with EMG, a %MVC trace (≤ 1,500 points)."),
        ("Are the games accessible?", "Large text options, high contrast, reduced motion, sounds and voice, keyboard and screen-reader support, English and Bangla."),
        ("Why a fixed timestep?", "So the game's physics and timing do not depend on the frame rate (60 FPS on replay)."),
    ]),
    ("Validation", [
        ("What have you validated?", "Engineering performance and repetition counting on one recording; the pilot validation is PENDING."),
        ("Why n = 1?", "It is a technical pilot to check the measurement chain before any study with patients; results are reported as descriptive."),
        ("How will you compute MDC?", "From three repeatability visits: SEM from within-subject SD, MDC95 = 1.96 × √2 × SEM."),
        ("Why did repetition counting get 25%?", "Seated, the arm did not return below the shoulder exercises' 30° rest line, so repetitions did not complete; the thresholds will be tuned after the validation session."),
        ("How do you test without a camera?", "Recorded or synthetic landmarks replay through the real code; the e2e tests run whole sessions this way."),
        ("Is the simulation evidence of clinical benefit?", "No: it compares engine behaviour on simulated patients only."),
    ]),
    ("Ethics and privacy", [
        ("Is it a medical device?", "No; it is a research prototype with no diagnosis or treatment decisions."),
        ("What data do you store?", "Numbers: landmark-derived measures, trials, questionnaire answers, EMG numbers; never video or images."),
        ("How is research data protected?", "Pseudonymous exports by patient code, recorded consent, and local storage."),
        ("What about ethics approval?", "Needed before any study with patients; not yet obtained (PENDING)."),
    ]),
    ("Limitations", [
        ("What are the main limitations?", "No clinical validation yet, provisional MDCs, untested EMG hardware, one camera setting, and no HTTPS beyond localhost."),
        ("What would you do with more time?", "Run the validation and usability studies, tune thresholds and L2, test the sensor, and a pilot with patients."),
        ("Does it work with any webcam?", "It needs a working webcam and Chrome or Edge; other cameras and lighting conditions are untested."),
    ]),
    ("Why not X?", [
        ("Why not a mobile app?", "A laptop gives a bigger screen and a fixed camera position; a browser needs no app store."),
        ("Why not Kinect or a depth camera?", "Extra hardware to buy; a webcam is already there."),
        ("Why not a cloud LLM such as GPT?", "Patient data would leave the computer, and it costs money per report."),
        ("Why not Unity for the games?", "A browser app needs no installation and shares one codebase with the dashboards."),
        ("Why not Bluetooth for the sensor?", "USB serial is simpler, faster and needs no pairing; it also powers the ESP32."),
        ("Why not PostgreSQL by default?", "A single computer does not need a database server; PostgreSQL is supported when needed."),
        ("Why not use handedness from MediaPipe?", "It is unreliable with mirrored cameras; position relative to the pose is more robust."),
    ]),
]


def chapter_16(r: Any) -> None:
    r.h1("Presentation Q&A")
    r.p("Likely questions with short answers, grouped by topic. The chapters above give the details and the files; numbers not yet measured are PENDING.")
    total = 0
    for group, items in QA:
        r.h2(group)
        for question, answer in items:
            total += 1
            paragraph = r.doc.add_paragraph()
            paragraph.add_run(f"Q{total}. {question}").bold = True
            r._rich(r.doc.add_paragraph(), answer)
    r.p(f"{total} questions in all.", italic=True)


def appendices(r: Any, f: Any) -> None:
    r.page_break()
    r.doc.add_heading("Appendix A. API endpoints", level=1)
    r.p("From `docs/api-contract.md` (every route starts with `/api`; the full request and response bodies are there).")
    r.table(["Method", "Path", "Who", "Purpose"], [list(route) for route in f.routes], "API endpoints", [1.6, 6.0, 2.2, 6.7])
    r.page_break()
    r.doc.add_heading("Appendix B. Database tables", level=1)
    r.p("From `docs/data-dictionary.md` (generated from the models in `server/app/models/`).")
    r.table(["Table", "Purpose", "Columns"], [[f"`{name}`", desc, str(cols)] for name, desc, cols in f.tables], "Database tables", [3.6, 11, 1.9])
    r.page_break()
    r.doc.add_heading("Appendix C. Configuration settings", level=1)
    r.p("From `server/.env.example` (copied to `server/.env`). The muscle-sensor thresholds are not here: they are EMG settings (Table in chapter 11).")
    r.table(["Setting", "Example value", "Meaning"], [[f"`{k}`", v or "(empty)", c] for k, v, c in f.settings], "Server settings", [5.0, 4.2, 7.3])
    r.page_break()
    r.doc.add_heading("Appendix D. Glossary", level=1)
    glossary = [
        ("Body frame", "Coordinates with the affected shoulder as origin and shoulder widths as unit."),
        ("Compensation", "Using the trunk or shoulder to make an arm movement easier."),
        ("Delegate", "Where MediaPipe runs its model: GPU or CPU."),
        ("EMG", "Electromyography: the electrical activity of a muscle."),
        ("Envelope", "Rectified and smoothed EMG amplitude."),
        ("Landmark", "A body or hand point estimated by MediaPipe."),
        ("Latin square", "An order design where each condition appears once in each position across participants."),
        ("MDC", "Minimal detectable change: the smallest change larger than measurement noise (MDC95 = 1.96 × √2 × SEM)."),
        ("MVC", "Maximum voluntary contraction: the strongest effort, the 100% of %MVC."),
        ("One Euro filter", "An adaptive low-pass filter for pointing, smoothing slow movements more than fast ones."),
        ("Pool-adjacent violators", "An algorithm for isotonic (monotone) regression."),
        ("SEM", "Standard error of measurement: the within-subject standard deviation."),
        ("SPARC", "Spectral arc length: a smoothness measure from the speed profile."),
        ("SW", "Shoulder width, the unit of distance."),
        ("Thompson sampling", "Choosing an option by drawing from each option's posterior and picking the best draw."),
        ("Web Serial", "A browser API (Chrome, Edge) for reading a USB serial device."),
    ]
    r.table(["Term", "Meaning"], [[term, meaning] for term, meaning in glossary], "Glossary", [4, 12.5])
    r.page_break()
    r.doc.add_heading("Appendix E. References (verify each before use)", level=1)
    r.p("These are the references named in the code and documents (`docs/methods-draft.md`, `docs/ai-engine.md`). Each must be checked (authors, year, title, journal, pages, DOI) before use.", italic=True)
    references = [
        "Ayer M, Brunk HD, Ewing GM, Reid WT, Silverman E (1955). An empirical distribution function for sampling with incomplete information. Annals of Mathematical Statistics 26(4):641–647. [verify]",
        "Balasubramanian S, Melendez-Calderon A, Roby-Brami A, Burdet E (2015). On the analysis of movement smoothness. Journal of NeuroEngineering and Rehabilitation 12:112. [verify]",
        "Bland JM, Altman DG (1986). Statistical methods for assessing agreement between two methods of clinical measurement. Lancet 1(8476):307–310. [verify]",
        "Kaernbach C (1991). Simple adaptive testing with the weighted up-down method. Perception & Psychophysics 49(3):227–229. [verify]",
        "Levitt H (1971). Transformed up-down methods in psychoacoustics. Journal of the Acoustical Society of America 49(2B):467–477. [verify]",
        "Lugaresi C, et al. (2019). MediaPipe: a framework for building perception pipelines. arXiv:1906.08172. [verify]",
        "McGraw KO, Wong SP (1996). Forming inferences about some intraclass correlation coefficients. Psychological Methods 1(1):30–46. [verify]",
        "Russo D, Van Roy B, Kazerouni A, Osband I, Wen Z (2018). A tutorial on Thompson sampling. Foundations and Trends in Machine Learning 11(1):1–96. [verify]",
        "Shrout PE, Fleiss JL (1979). Intraclass correlations: uses in assessing rater reliability. Psychological Bulletin 86(2):420–428. [verify]",
        "Thompson WR (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. Biometrika 25(3/4):285–294. [verify]",
        "Weir JP (2005). Quantifying test-retest reliability using the intraclass correlation coefficient and the SEM. Journal of Strength and Conditioning Research 19(1):231–240. [verify]",
    ]
    r.numbered(references)
