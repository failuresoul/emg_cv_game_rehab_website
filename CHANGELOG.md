# Changelog

All notable changes to MotionLab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added (Day 8)

- **Hand input layer:** how open the affected hand is (0 a fist, 1 fully open) from the patient's own hand open-close warm-up, and which finger the thumb touches (one at a time, with hysteresis) from the thumb opposition warm-up. Keyboard stand-ins for testing: hold O to open, keys 1–4 for the index to little finger. `useHandInput()` gives games openness, grip, the current touch and the input badge; K switches all of them to the keyboard together. The Exercise Lab shows openness and touches.
- **Bloom:** open the hand fully and hold it to make a flower bloom, then make a fist to collect its seed; the garden grows with each flower. Records time to open, peak openness, hold steadiness, time to close, peak grip and opening speed; a time-out is a calm miss with the phase that ran out.
- **Finger piano:** notes slide down finger lanes; touch the thumb to the right finger as each reaches the line to play a pentatonic note. A wrong finger is recorded but costs nothing. Records hits, wrong fingers, missed notes, hit rate, timing error and per-finger tallies. Melodies use every finger and never one finger three times in a row; the touch distance and a gentle start (index and middle only) come from the warm-up.
- **Hand games everywhere:** the plan now starts with Reach and squeeze, Balloon pop, Bloom and Finger piano ticked (about 16 minutes) and Fruit catch unticked; results, the session summary and history show flowers grown and best openness, and hit rate, best finger and per-finger bars; the admin session page has an openness chart and per-finger bars; the admin Progress tab has a Hand games section.
- **API:** trial targets may be unplaced (`{"kind": "bloom"}`, `{"kind": "sequence", "notes": […]}`); new optional trial metrics for both games; `main_measure` and `extra_measure` for each game in the session summary; `bloom_peak_openness` and `piano_hit_rate` in the progress series. See [the API contract](docs/api-contract.md).
- **Demo data and smoke test** include Bloom and Finger piano runs.

### Changed

- Games can choose their compensation checks (hand games check the trunk only), hide the fingertip cursor and the squeeze meter, and start from the patient's own settings from this session's warm-up.
- The hand is measured once per camera frame however many inputs read it.
- Sound now stops (its audio context is closed) on every way out of a session, and a session resumed straight into a game starts sound on the first button or key press.
- Warm-up references are kept within safe limits: an open-hand reference of at most 2.2 palm lengths and a touch distance of 0.1–0.6.

## [0.1.0] - 2026-11-10

The first release: a complete home session, from login to summary, with three games, progress dashboards for patients and an admin area for therapists and researchers. Webcam video and images never leave the browser; only landmarks, measures and events reach the server.

### Accounts and patients (Day 1)

- Login with JWT tokens and Argon2 password hashing; admin and patient roles; the admin account is created on first start from `server/.env`.
- Patient management for admins: list, search, create, edit, deactivate and activate, with patient codes (`P001`, `P002`, …).
- Patient self sign-up, and English and Bangla text throughout (`t()`).
- Landing page, role-based routing, and patient and admin layouts.

### Camera check and calibration (Days 1–2)

- Camera check on `/session/setup`: MediaPipe hand and pose tracking in the browser, a skeleton view and a live checklist (light, distance, framing).
- Body frame with its origin at the affected shoulder and the shoulder width as the unit; a One Euro filter for the on-screen cursor only, while saved data stays raw.
- Reach calibration in 8 directions with a countdown, hold, quality rules and redo; a reach map with the previous one dashed for comparison.
- Sessions that can be started, resumed, ended and that expire after 2 hours.

### Warm-up (Days 3–4)

- Six guided exercises: shoulder flexion, shoulder abduction, elbow flexion, forward reach, hand open and close, and thumb opposition.
- Joint angles from 3D landmarks, rep counting with full and partial reps, demos, countdowns, gauges, voice and sound, pause and skip.
- Compensation detection (trunk displacement, trunk lean, shoulder hike) with gentle cues; flagged reps still count.
- Personalised targets that move one step from the last result, with the reason saved; standard and gentle presets.
- Results saved per exercise, with history for patients and admins.

### Games (Days 5–6)

- A shared game framework: full-screen canvas fitted to the patient's reach, fixed-step updates, pause on lost hand or hidden tab, countdown, results screen and trial upload in batches.
- One input layer for "squeeze": webcam hand opening, or the keyboard for testing (EMG later).
- **Reach and squeeze**, **Balloon pop** and **Fruit catch**, each recording outcomes, timings, movement measures, compensation and raw trajectories.
- A plan screen to choose and order the session's games, played one after another; encouragement messages.
- Admin session page with the reach map of targets, per-game trial tables and movement charts.

### Complete session, progress and safety (Day 7)

- **Cool-down:** a minute of guided rest, then a questionnaire (pain, tiredness, enjoyment, difficulty, anything new or unusual, comment).
- **Safety flags:** pain of 4 or more, new symptoms, or tiredness of 8 or more flag the session for review (thresholds to be confirmed with the supervisor). The summary shows a fixed safety notice for pain or new symptoms. Admins see open alerts and mark them reviewed with a note.
- **Summary:** time spent moving, warm-up goals and repetitions, a card per game, the reach map against last time, and a calm "compared with last time" line for each.
- **Progress:** streak, weekly goal ring (goal set by the therapist), a 4-week calendar and trends for reach area, warm-up goals and game success, on the patient home and progress pages; practice figures on the admin patient overview.
- **Robust session flow:** the current step and game queue are saved on the server, so a refresh or a return lands on the same step; "Continue your session" or "Start over"; a step bar; Exit from any step, which stops the camera and game loops.
- **Error handling:** a friendly error page ("your progress is saved"), an offline banner and readable error messages.
- **Demo data:** `server/scripts/seed_demo_data.py` creates two demo patients with two weeks of synthetic sessions, marked **Demo** in the admin list.
- **Performance:** the game screen no longer re-renders on every camera frame; fewer per-frame allocations in the game loop and skeleton drawing.
- **Checks:** `scripts/check.ps1` runs every test, lint, build and the smoke test against a temporary backend; backend coverage with `pytest-cov`.

### Known limitations

- The LLM feedback report, adaptive difficulty (L1/L2) and EMG input are not part of this release.
- Six planned games (Bloom, Finger piano, Path trace, Paint wall, Pick and place, Grip hold) are listed as coming soon.
- Safety thresholds are provisional and must be confirmed with the supervisor.
- Bangla text still needs a native speaker's review.
- No automated tests yet for React screens; they are checked by type checking and by hand.

[Unreleased]: https://github.com/failuresoul/emg_cv_game_rehab_website/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/failuresoul/emg_cv_game_rehab_website/releases/tag/v0.1.0
