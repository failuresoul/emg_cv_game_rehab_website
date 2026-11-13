# Changelog

All notable changes to MuVi Rehab (code name MotionLab). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added (Day 16)

- **ESP32 firmware** (`firmware/emg_stream/emg_stream.ino`, [firmware/README.md](firmware/README.md)):
  - 500 Hz sampling of the Advancer Muscle Sensor V3.0 on GPIO34, in a FreeRTOS task on core 0 that never prints or allocates;
  - a line protocol at 230400 baud (`E` samples, `S` status, `I` info) and the commands `START`, `STOP`, `PING`, `RATE`, `SIM ON/OFF` and `INFO`;
  - a hardware guide (wiring, the 3.0 V voltage divider, electrodes, safety) and `firmware/test-lines.txt`, shared by the browser and Python tests;
  - `analysis/tools/serial_rate.py` (pyserial) to measure the rate, gaps and drops.
- **EMG in the browser** (`web/src/emg/`):
  - Web Serial and a simulated sensor (development builds only, unless the browser's `localStorage` key `muvi-simulated-emg` is set to `on`; **M** squeezes);
  - a sample clock, a 50 ms envelope, %MVC, onset and offset detection, saturation and flat-line checks;
  - one engine for the whole app, and `/dev/emg-lab` (development only).
- **Muscle sensor check and calibration** (`/session/emg`, when "Use the muscle sensor today" is on at setup):
  - safety and electrode placement (laptop on battery, fresh batteries, electrodes on), then nine readiness checks that must stay green for 2 s, and a test squeeze;
  - rest for 10 s, three strongest efforts (an extra one if they differ by more than 15%), and a summary;
  - `EmgCalibration`, saved with the readiness results; the server refuses a real sensor without `battery_ok`;
  - the session's "Muscle sensor" status dot; Skip at every stage.
- **EMG in the games:**
  - `EmgSource`: level = clamp(%MVC / 100) with smoothing; the flexors drive grip in Reach and squeeze and Grip and hold, the extensors drive opening in Bloom;
  - when the sensor pauses (unplugged, an electrode off, more than 1% of samples lost) the webcam takes over, with an amber dot and "Muscle sensor paused — using the camera", and the sensor takes back over when it recovers;
  - the HUD badge ("Muscle sensor", "Camera", "Keyboard") and `input_source: "emg"`;
  - each trial saves a %MVC trace (50 Hz, at most 1500 points) and its measures: peak, mean when active, onset latency, relaxation time, time in band and steadiness.
- **EMG measures** (`shared/metrics-catalog.json`): E2 MVC, E3 activation success with EMG, E5 onset latency, E6 relaxation time, E8 grip steadiness (EMG) and E9 within-session fatigue slope, in session measures and the facts. A worse E6 brings the "relax after a squeeze" suggestion.
- **Dashboards:** the admin session page's "Muscle sensor" card (calibration, readiness, per-trial traces with onset and offset), EMG trends on the Progress tab, and the EMG level in the Exercise Lab.
- **Smoke test:** a fourth session with an EMG calibration and a Grip and hold run with the sensor (71 steps).
- **Docs:** [EMG hardware test](docs/emg-hardware-test.md), the API contract's "Muscle sensor (EMG)" section, and the README's hardware section.

### Changed (Day 16)

- The game badge for the webcam now reads "Camera".
- The Day 14 LLM test set leaves out the EMG measures, so it stays the seeded set the models were compared on.

### Fixed (Day 16 review)

- After choosing the simulated sensor (which skips the safety questions), the check stage still offered to connect a real one. A real sensor now always needs the safety answers first.
- The serial port stayed open after leaving the session pages or the EMG lab; leaving now closes it and forgets the day's calibration.
- After the USB was unplugged in a game, the sensor never came back without a click; plugging it in again now reopens the port and starts the stream, so the game switches back by itself.
- A board that restarted (its start-up line says it is not streaming) was never started again; the engine now sends `START` again.
- The simulated sensor could be connected through the engine in a production build without `muvi-simulated-emg` set; the engine now refuses it.

### Added (Day 15)

- **Report API with background jobs** (`server/app/api/feedback.py`, `feedback/store.py`, `feedback/jobs.py`):
  - one worker writes reports one at a time (one generation on the GPU), patients' reports before review reports;
  - limits of `LLM_TIMEOUT_S` per attempt and 120 s per job, then the template;
  - restart recovery and background model warm-up;
  - submitting the questionnaire queues the report in the patient's language;
  - `LlmReport` stores the report, notices, facts snapshot, candidates, model, prompt version, strategy, timings, validation errors and raw output, with older versions kept;
  - `ReportRating` stores ratings;
  - endpoints to request, poll, read, list, monitor and rate reports, plus feedback health.
- **Reports in the app:**
  - "Your feedback" on the summary, with a calm preparing card; fixed safety notices first; summary, highlight and tip cards with icons; next time; disclaimer;
  - read aloud (hidden without a voice), print, and "Was this helpful?";
  - the patient's Reports pages and "Latest feedback" on home;
  - admin: a Reports tab (patient view, therapist summary, validation info, ratings, Regenerate), the session's report, and LLM health on System.
- **Bangla reports:**
  - `LLM_BN_STRATEGY` = `direct`, `translate` (English, then the patient text translated and checked again, numbers preserved) or `template`;
  - Bangla tips, banned list, template sentences and notices, marked for native review;
  - `analysis/llm/eval_bangla.py`: a blind side-by-side comparison;
  - an English / বাংলা toggle;
  - Noto Sans Bengali loaded only when Bangla is shown.
- **Blind human review** (Admin → Research → Report review; [docs/llm-evaluation.md](docs/llm-evaluation.md)):
  - review sets of LLM and template reports from the same facts, under random codes;
  - a rubric (accuracy, safety, helpfulness, clarity, tone, unsafe, unsupported sentence);
  - results per version, % unsafe and weighted Cohen's kappa;
  - CSV export.
- **Smoke test:** the questionnaire's report, admin detail, rating, and a Bangla report.

### Changed (Day 15)

- **The template report's sentences** moved to `server/app/feedback/templates/en.yaml` and `bn.yaml`; the Bangla banned words to `banned_bn.txt`.
- **`index.html`** no longer loads Noto Sans Bengali for everyone.
- **The placeholder "Your feedback" area** on the summary is replaced by the report.

### Fixed (Day 15 review)

- A patient could open, or rate, a blind-review report of their own session by its id; review reports now answer `404` to patients.

### Added (Day 14)

- **Local language model provider** (`server/app/feedback/llm.py`):
  - Ollama `/api/chat` with structured JSON output, `think` off (retried without it for models that refuse it, and remembered), timings, health and warm-up;
  - a mock provider for tests;
  - LLM settings in `.env.example`.
- **Speed test** (`analysis/llm/speed_test.py`): reading and writing speed of each candidate model on a short prompt and a realistic 1,500-token one.
- **Rule layer** (`server/app/feedback/rules.py`, `catalogue.yaml`, `kb/`):
  - 13 suggestion types with triggers, thresholds and approved guidance;
  - at most 5 candidates per session, each with its evidence;
  - red flags (pain, new symptoms, sharp decline);
  - one approved tip per suggestion in English and Bangla.
- **Shared safety notices** (`shared/safety-notices.json`): one source for the notice wording, used by the server; a web test checks that the app's wording is identical.
- **Safe report generation** (`schemas.py`, `prompts/`, `prompt.py`, `validate.py`, `fallback.py`, `service.py`):
  - versioned prompts with two checked examples;
  - a validator for schema, word limits, numbers from the facts, candidate ids, improved/worse words against `mdc_status`, banned words, safety leakage, sentence length and script;
  - up to two retries with the errors, then a template report;
  - the model and prompt version recorded with every result.
- **CLI:** `python -m app.feedback.cli <session_id>` and `--list`.
- **Evaluation** (`analysis/llm/`):
  - a 60-case seeded synthetic test set (40 dev, 20 held out);
  - `run_eval.py`, resumable, scoring every answer the model wrote;
  - `compare_models.py`, which writes `docs/llm-model-choice.md` against the targets.
- **Docs:** "LLM feedback" in [docs/ai-engine.md](docs/ai-engine.md).

### Changed (Day 14)

- **Session facts** gained `flags.safety_flags` (questionnaire codes, read by the rules and never sent to the model) and `flags.shoulder_compensation_rate`.
- **The feedback module** is now developed in this repository (`server/app/feedback/README.md`).

### Fixed (Day 14 review)

- The safety-leakage check treated "Paint the wall" (`paint_wall`) as "pain", so any report naming that game was rejected under a safety notice. It now matches whole words only.
- Unit tests can no longer reach a real Ollama: any real request to it fails the test.

### Added (Day 13)

- **L2, a Bayesian, workspace-aware engine** (`server/app/engine/l2_bayes.py`, [docs/ai-engine.md](docs/ai-engine.md)):
  - Beta beliefs per workspace sector (direction × ring of distance, with a stretch ring that unlocks) and per difficulty level (kept monotone by pool-adjacent violators);
  - Thompson sampling towards 70% success for the trial;
  - a coverage bonus weighted by feasibility, no third repeat, and compensation blocks per direction;
  - 30% forgetting between sessions;
  - priors seeded from the latest calibration and warm-up.
  - The safety layer runs after it unchanged.
  - Every decision logs its samples and target (`AdaptationLog.details`).
- **Games place L2's targets** (Reach and squeeze, Balloon pop, Fruit catch, Pick and place, Path trace) and report where each target was; the rotation stays for L0 and L1.
- **Patient simulator** (`server/app/engine/sim/`):
  - simulated patients (mild, moderate, severe) with reach per direction, activation, speed and precision abilities, fatigue, learning and compensation;
  - they run through the same decision code as the API, with outcome measures.
- **Simulation study** (`analysis/run_simulation.py`, [docs/simulation-results.md](docs/simulation-results.md)): L0, L1 and L2 on 200 simulated patients per profile, ablations of L2, statistics with Holm correction, and figures. L2 was not better than L1 overall; the report says so.
- **Session planner** (`server/app/services/planner.py`):
  - chooses today's games from need (each movement's measures against the baseline), weak directions, variety, enjoyment and load;
  - follows the rules: Game Library only, one reach or shoulder and one hand game, no adjacent shoulder-heavy games, easiest first and favourite last;
  - gives each game a plain-language reason.
- **Plan page:**
  - the recommended games in order with "Why this game?";
  - a lighter-session note;
  - the patient may untick or reorder (recorded), and "Use recommended plan" restores it;
  - each game plays the planned number of turns.
- **Admin:**
  - an engine mode selector (L0, L1, L2) with confirmation;
  - the latest plan with reasons and the patient's changes;
  - an L2 sector heat map with the chosen targets on the session page.
- **Patient summary:** "Next time we'll focus on …" from the next session's plan.
- **API:**
  - `GET /api/sessions/{id}/plan`, `POST /api/sessions/{id}/plan/override`, `GET /api/admin/patients/{id}/plan`;
  - `engine_mode` in `PATCH /api/admin/patients/{id}`;
  - target fields in `POST /api/engine/next` and in trials;
  - `next_session` in the session facts;
  - `game_queue.trials`.
- **Demo data:** both demo patients use L2, with beliefs, a plan and a recorded change for every session.
- **Smoke test:** a third session checks L2 (sectors, beliefs), the plan, an override and the next-session facts.

### Changed (Day 13)

- `engine_mode` L2 is the Bayesian engine (it behaved like L1 before).
- Pick and place's L2 lanes are its four carry directions; Path trace's are outward and inward.

### Fixed (Day 13 review)

- A plan is never made for a session that has already ended (it would have used later measures); such sessions return `404`.
- Two accessibility tests had a control character instead of `\b` in a regular expression, which weakened their alt-text check and failed lint.

### Added (Day 12)

- **Adaptive difficulty engine** (`server/app/engine/`, [docs/ai-engine.md](docs/ai-engine.md)):
  - every adaptable game setting belongs to a difficulty component (spatial, activation, speed, precision), mapped from one d (0–1) per component within the spec bounds;
  - **L0** keeps the admin's defaults; **L1** is a transformed up-down staircase (Levitt 1971): two successes make one component harder, a failure eases the component it points at;
  - a warm restart eases every d by 0.05 once per session and game;
  - **L2** is selectable and behaves like L1 until Day 13.
- **Safety layer**, applied after every decision in a fixed order:
  - hard bounds and the patient's maximum difficulty;
  - compensation blocks harder reaches (posture cue);
  - 3 failures in a row ease everything (encouragement);
  - signs of tiring ease everything (rest);
  - session time gives "finish soon" after 25 minutes and "finish" after 35 (`SESSION_FINISH_SOON_MIN`, `SESSION_FINISH_MIN`).
- **Decision log** (`AdaptationLog`): one row per engine call with the states before and after, the settings, the reason in plain words, any safety override and the cue. Per-patient state is kept in `EngineState`.
- **API:**
  - `POST /api/engine/next` and `GET /api/admin/patients/{id}/levels`;
  - each run's `adaptation` in the admin session detail;
  - `level_start` and `level_end` per game in the session summary and the session facts.

  See [the API contract](docs/api-contract.md#adaptive-difficulty).
- **Every game uses the engine** through a remote provider: it never waits more than 300 ms, keeps the previous settings without an answer, and keeps a patient's own warm-up values. Each trial reports its failure type.
- **Patients see:** the level in the game's top bar, gentle level-up and level-down messages, cues (posture, encouragement, finish soon) and a rest overlay, and "Level reached: 6 (started at 5)" on the results screen and the session summary. The word "AI" never appears to patients.
- **Admins see:**
  - an Adaptation panel per game run: each component's difficulty and the level per trial, success and failure markers, safety overrides as coloured flags, and a decisions table;
  - an "AI levels" card on the patient page.
- **Demo data** replays every demo trial through the engine: Rahim's levels climb over his later sessions, and Salma's sessions show compensation and tiring overrides.
- **Project identity:** the public name is **MuVi Rehab** (Muscle + Vision Rehabilitation).
  - The name, research title, institutions (KUET, with The University of Queensland), supervisors and team all live in `web/src/config/project.ts`.
  - There is a new logo mark (pulse line and lens), with a generated favicon, tab title and meta description.
  - The admin System page shows the name, version, institution and collaborator.
- **Landing page** (`/`), rebuilt as a research-grade page:
  - sticky navbar with a mobile menu;
  - a hero with an animated forearm EMG preview (still under reduced motion);
  - stats, how it works, the nine games with original illustrations, research aims, the team with photos, the collaboration, privacy and safety, and a call to action;
  - responsive from 360 px; no version number.
- **About page** (`/about`): background, system overview, team, collaboration, privacy and data handling, "Research prototype — not a medical device".
- **Credit line** in the admin and patient footers and on the login page; the login page also shows the tagline and both logos.
- **Images** fall back gracefully: initials for a missing photo, the name for a missing logo.
- **Tests** fail when "MotionLab" is visible anywhere, or when a name, institution or image path is written outside `project.ts`.

### Changed (Day 12)

- A game run's `engine` is now the patient's `engine_mode` (`L1` by default), whatever the web app sends.
- Every user-visible "MotionLab" is now "MuVi Rehab": pages, translations, guides, the API title and `APP_NAME`, and the trials export (`muvi-rehab-trials.csv`). Internal identifiers keep the code name.
- The smoke test adds a second session that checks the engine: the level rises and falls, a decision is logged at the start and after every trial, and a tiring run gets the "rest" cue.

### Fixed (Day 12 review)

- L0 patients' stored difficulty no longer drifts: no warm restart and no easing for fixed settings, so their level stays steady.
- The same trial reported twice at once returns one answer instead of an error; the state and its log row are saved together.
- The compensation rule never restores a spatial difficulty above a lowered maximum.
- The browser ignores a late engine answer from an earlier run.
- The light-orange "Collaboration" label on the collaboration card now meets AA contrast.

### Added (Day 11)

- **Server metrics library** (`server/app/metrics/`, numpy and scipy): resampling exactly as the web app, a zero-phase Butterworth low-pass safe for short signals, speed, SPARC (reproducing the shared test vectors to about 1e-15), reach timings and path measures, speed peaks, distance to a path, time in a corridor, and robust summaries.
- **Metrics catalogue** (`shared/metrics-catalog.json`): every reported measure (K, R, H, G and P ids) with its unit, which way is better, source and description.
- **Server trial measures:** spatial games' reaction and movement time, path efficiency, smoothness, peak speed and speed peaks recomputed from the RAW trajectory when a run ends; other games' figures checked and copied; data quality per trial (points, sampling rate, gaps over 200 ms, measures more than 10% from the browser's).
- **Session measures** (`SessionMetric`): one clean row per measure (per game for trial measures) when the questionnaire is sent and the session ends; `scripts/backfill_metrics.py` for older sessions; demo data includes them.
- **Changes against the baseline:** the mean of the first two sessions; changes in provisional minimal-detectable-change units, positive when better; improved, worse, no detectable change or no baseline.
- **Session facts** for the LLM feedback module (`GET /api/sessions/{id}/facts`, [docs/session-facts.md](docs/session-facts.md)): codes and numbers only, never a name or an email.
- **Dashboards:** the admin Progress tab starts with a Metrics table (baseline, latest, change, status) and a chart of any measure with its baseline dashed, with a note that the MDC values are provisional; the admin session page lists the session's metrics and a data-quality badge per game; the patient's progress page shows reach area, time to reach a target, smoothness, turns done well and hand opening in plain words, with which way is better.
- **CSV exports** for research: one patient's session measures (on the patient page) and every trial (on /admin/research, "Export all trials (CSV)"), by patient code only.
- **API:** see [the API contract](docs/api-contract.md#server-metrics).

### Changed (Day 11)

- The patient progress page's trend charts now come from the server's session measures.
- The smoke test checks the session metrics, the admin metrics table, the facts and both exports.

### Added (Day 10)

- **Pinch input:** whether the thumb and index finger of the affected hand pinch, how strongly (0–1), and where (midway between the two tips, RAW and smoothed, in SW). A pinch starts below 0.25 palm lengths (or the patient's own distance from the thumb opposition warm-up) and ends only 0.1 farther, so jitter never makes a second pinch. Hold P to pinch at the fingertip cursor for testing. `useHandInput()`, the game context and the Exercise Lab have it; EMG mode keeps the camera for the pinch.
- **Pick and place:** reach to a fruit, pinch to pick it up, carry it to an open box and open the fingers to let it go; the box closes softly and the fruit joins a shelf. Letting go outside the box puts the fruit back to try again until the time limit. The fruit and the box sit inside the patient's own reach, and the carries go outward, inward, up and down. Records reach time, grasp latency, carry time and path efficiency, drops, release error, carry smoothness and peak speed from the raw pinch point.
- **Grip and hold:** squeeze to fly a kite into a green zone and keep it there; the hold timer only runs inside the zone (it pauses, not restarts, outside), then "Now relax your hand". Records time to the zone, time in the zone, longest hold, overshoots, steadiness, time to relax and the input source; a note says when the grip comes from hand closing rather than a muscle sensor.
- **Game library** (`/admin/games`): turn each game on or off for patients, set its number of turns (5–40) and its starting settings with sliders bounded by each setting's range and showing which way is harder, add notes, and reset to the game's own defaults. The plan lists only the games turned on, with their turns, and every game starts from these defaults (a patient's own warm-up values still come first).
- **Game specs:** `npm run export:specs` writes every game's settings to `shared/game-specs.json`, which the server uses to check the admin's settings; a test fails when the file is out of date.
- **Both games everywhere:** results, the session summary and history show objects placed, drops and average carry time, and holds completed, steadiest hold and average time to relax; the admin session page has their trial tables, the objects and boxes on the reach map, and time in the zone per hold; the admin Progress tab adds carry time, steadiness and time to relax per session.
- **API:** `GET /api/admin/games`, `PUT /api/admin/games/{game_id}`, `POST /api/admin/games/{game_id}/reset` and `GET /api/games/settings`; `pick_place` and `grip_band` targets and their trial metrics; `failed_phase` may be `hold` or `relax`; `pick_transport_ms`, `grip_steadiness` and `grip_relaxation_ms` in the progress series. See [the API contract](docs/api-contract.md).
- **Demo data and smoke test** include both games; the smoke test also changes a game's settings and checks the patient's settings follow, then puts them back.

### Changed (Day 10)

- The plan now starts with Reach and squeeze, Balloon pop, Bloom and Pick and place ticked (about 16 minutes).
- All nine games are built: the plan's "coming soon" list is gone.
- The admin session page names Path trace's and Paint the wall's outcomes in their own words (for example "Followed well" rather than "Reached and squeezed").
- Docker mounts `shared/` for the server (`GAME_SPECS_PATH`).

### Added (Day 9)

- **Movement-quality tools** (`web/src/metrics/`): a radix-2 FFT, resampling to a fixed rate, zero-phase smoothing, speed and angular speed, and SPARC smoothness (Balasubramanian et al. 2015). Fixed test vectors in `shared/test-vectors/sparc.json`, generated by an independent Python reference, for the server's version on Day 11. Path shapes (line, arc, S-curve, part circle) fitted inside the patient's reach.
- **Path trace:** hold a start circle, then follow a ladybird along a path inside the reach; a teal or amber trail, the followed path filling in, and 1–3 stars. Records tracking and path error, time in the corridor, lag, coverage, SPARC and peak speed from the raw fingertip; a success from 70% in the corridor. The provider cycles the shapes and alternates the direction.
- **Paint the wall:** bend and straighten the elbow to move a brush up and down a stripe of the wall, scaled to the patient's own elbow range from the warm-up; full sweeps add coats, partial ones lighter coats, and the stripes become a mural. Records the range reached, sweeps, sweep time and elbow smoothness; moving the upper arm more than 20° during a sweep is flagged (`upper_arm`) with a gentle reminder.
- **Both games everywhere:** the plan now starts with Reach and squeeze, Balloon pop, Bloom and Path trace ticked (about 16 minutes), the others unticked; results, the summary and history show stars, time in the corridor and best smoothness, and stripes finished and best elbow range; the admin session page has a path plot with the raw fingertip per turn and elbow range per stripe; the admin Progress tab has a Movement quality section.
- **API:** path targets (`shape`, up to 200 `points`) and stripe targets (`index`, `target_frac`); tracing and elbow trial metrics; the session summary's `extra_measures` list; `path_sparc` and `elbow_range_deg` in the progress series. See [the API contract](docs/api-contract.md).
- **Demo data and smoke test** include Path trace and Paint the wall runs.

### Changed (Day 9)

- The session summary's `extra_measure` (Day 8, unreleased) is now `extra_measures`, a list, as Path trace shows two extra figures.
- Games receive the raw elbow angle (`elbowFlexionDeg`) from the shell.
- Paint the wall's "bottom of the wall" follows the straightest the arm has been in a stripe, so an elbow that cannot straighten as far as its reference still completes sweeps.

### Added (Day 8)

- **Hand input layer:** how open the affected hand is (0 a fist, 1 fully open) from the patient's own hand open-close warm-up, and which finger the thumb touches (one at a time, with hysteresis) from the thumb opposition warm-up. Keyboard stand-ins for testing: hold O to open, keys 1–4 for the index to little finger. `useHandInput()` gives games openness, grip, the current touch and the input badge; K switches all of them to the keyboard together. The Exercise Lab shows openness and touches.
- **Bloom:** open the hand fully and hold it to make a flower bloom, then make a fist to collect its seed; the garden grows with each flower. Records time to open, peak openness, hold steadiness, time to close, peak grip and opening speed; a time-out is a calm miss with the phase that ran out.
- **Finger piano:** notes slide down finger lanes; touch the thumb to the right finger as each reaches the line to play a pentatonic note. A wrong finger is recorded but costs nothing. Records hits, wrong fingers, missed notes, hit rate, timing error and per-finger tallies. Melodies use every finger and never one finger three times in a row; the touch distance and a gentle start (index and middle only) come from the warm-up.
- **Hand games everywhere:** the plan now starts with Reach and squeeze, Balloon pop, Bloom and Finger piano ticked (about 16 minutes) and Fruit catch unticked; results, the session summary and history show flowers grown and best openness, and hit rate, best finger and per-finger bars; the admin session page has an openness chart and per-finger bars; the admin Progress tab has a Hand games section.
- **API:** trial targets may be unplaced (`{"kind": "bloom"}`, `{"kind": "sequence", "notes": […]}`); new optional trial metrics for both games; `main_measure` and its extra measures for each game in the session summary; `bloom_peak_openness` and `piano_hit_rate` in the progress series. See [the API contract](docs/api-contract.md).
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
