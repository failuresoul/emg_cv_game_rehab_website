# MuVi Rehab

**MuVi Rehab — Muscle + Vision Rehabilitation.** EMG and vision-guided home rehabilitation for stroke.

![Version](https://img.shields.io/badge/version-1.0.0--rc1-0f5c5c)
![Status](https://img.shields.io/badge/status-research%20prototype-e07a3f)
![Not a medical device](https://img.shields.io/badge/not%20a-medical%20device-b42318)
![Python](https://img.shields.io/badge/python-3.12%2B-3776ab)
![Node](https://img.shields.io/badge/node-22%2B-417e38)
![React](https://img.shields.io/badge/React-19-61dafb)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-009688)
![Licence](https://img.shields.io/badge/licence-to%20be%20decided-lightgrey)

![MuVi Rehab: the landing page](docs/images/screens/landing.png)

A research prototype from the Department of Computer Science and Engineering, Khulna University of Engineering & Technology (KUET), Bangladesh, with The University of Queensland, Australia. It is not a medical device.

- **Research title:** Multimodal EMG and Webcam-Based Hand Posture Recognition for Real-Time Adaptive Rehabilitation Gaming
- **Supervisors:** Dr. Muhammad Aminul Haque Akhand (Professor, Dept. of CSE, KUET) and Dr. Md. Abdul Awal (Postdoctoral Fellow, The University of Queensland)
- **Team:** Nurul Absar Shadik and Nafis Ahammad (Dept. of CSE, KUET)

The project's name, institutions and people live in one file, [web/src/config/project.ts](web/src/config/project.ts). "MotionLab" is the internal code name: it stays in identifiers (storage keys, package names, the database file) but never in anything a user sees.

MuVi Rehab is a web platform for home-based arm and hand rehabilitation after stroke. A patient logs in, checks their camera, calibrates their reach, and completes warm-up exercises tracked by the webcam with MediaPipe. They then play rehabilitation games controlled by hand and arm movement (and, optionally, by a forearm muscle sensor), with an AI engine planning the session and adapting each game's difficulty to the patient. Each session ends with a short cool-down questionnaire and an AI feedback report. Therapists and researchers use an admin area to manage patients, programmes and games, and to review analytics. Webcam video and images never leave the browser: only landmarks, metrics and events go to the server.

**Version 1.0.0-rc1** (release candidate). See the [changelog](CHANGELOG.md) for what changed, the [release notes](docs/release-notes-v1.0.md) and the [known issues](docs/known-issues.md).

## Contents

- [About](#about)
- [Key features](#key-features)
- [How a session works](#how-a-session-works)
- [Screenshot gallery](#screenshot-gallery)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [AI adaptation](#ai-adaptation)
- [LLM feedback](#llm-feedback)
- [Hardware: the muscle sensor (optional)](#hardware-the-muscle-sensor-optional)
- [Privacy and safety](#privacy-and-safety)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Usage](#usage)
- [Testing](#testing)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Documentation](#documentation)
- [Results](#results)
- [Roadmap](#roadmap)
- [Citation](#citation)
- [Acknowledgements](#acknowledgements)
- [Licence](#licence)

## About

**The problem.** After a stroke, many people keep practising arm and hand movements for months, and much of that practice happens at home. There, it is hard to know whether a movement was done well, to keep the practice at the right level, and to stay motivated.

**The solution.** MuVi Rehab turns an ordinary laptop and webcam into a guided practice station:

- the webcam measures arm and hand movement in the browser (MediaPipe hand and pose landmarks), with no video sent anywhere;
- an optional forearm muscle sensor (surface EMG, ESP32) adds how strongly the muscle works;
- nine games each train a movement, and an adaptive engine keeps each one at the right challenge, inside safety rules and the therapist's limits;
- movement-quality measures (reach area, smoothness, range, speed, grip) are recorded every session, and each session ends with a short plain-language report in English or Bangla.

**Who made it.** The Department of Computer Science and Engineering, KUET (Bangladesh), in collaboration with The University of Queensland (Australia). Supervisors: Dr. Muhammad Aminul Haque Akhand (Professor, Dept. of CSE, KUET) and Dr. Md. Abdul Awal (Postdoctoral Fellow, The University of Queensland). Developers and researchers: Nurul Absar Shadik and Nafis Ahammad (Dept. of CSE, KUET). These names come from [web/src/config/project.ts](web/src/config/project.ts).

## Key features

**For patients**

- **Camera check:** a live checklist for light, distance and framing.
- **Reach calibration:** reach in 8 directions, with a reach map compared with last time.
- **Warm-up:** six guided arm and hand exercises with rep counting, compensation cues and targets that adapt to each patient.
- **Nine games:** Reach and squeeze, Balloon pop, Fruit catch, Bloom, Finger piano, Path trace, Paint the wall, Pick and place, and Grip and hold, chosen and ordered on a plan screen with reasons, with webcam squeeze detection (keyboard for testing) or the muscle sensor.
- **Adaptive difficulty:** a level from 1 to 10 per game that follows the patient's results, inside the therapist's limits and a safety layer.
- **Cool-down:** a minute of guided rest, then a short questionnaire. Pain or anything new or unusual shows a fixed safety notice.
- **Summary and feedback report:** time spent moving, warm-up goals and repetitions, a card per game, the reach map, "compared with last time", and a short report written by a local language model from the session's facts (checked against them, with a template if the check fails).
- **Progress:** streak, weekly goal ring, a 4-week calendar and trend charts on the home and Progress pages.
- **A resumable session:** the step is saved, so a refresh or a return carries on at the same step, with "Continue your session" or "Start over". There is a step bar, Exit from any step, an offline banner and a friendly error page.
- **English and Bangla**, text size, high contrast, reduced motion, sounds and spoken instructions; keyboard and screen-reader support; layouts for phones, tablets and computers.

**For therapists and researchers**

- **Patients:** add, edit, deactivate and search patients, and set each one's weekly goal.
- **Programme:** the games, each game's highest level, the session's length, rest frequency, the warm-up's exercises and targets, and the muscle sensor's default site, with a history of changes.
- **Session pages:** calibration, warm-up, every game trial with its reach map and charts, the engine's decisions, the muscle sensor's calibration and traces, and the questionnaire.
- **Progress tab:** reach maps over time, warm-up charts with every personalisation decision, and measures with minimal detectable change (MDC) badges.
- **Safety alerts:** pain, new symptoms, sharp declines, missed sessions, device problems and the report service, to mark reviewed with a note.
- **Research mode:** blinded within-subject studies comparing the engines (L0, L1, L2) in a Latin-square order, repeatability visits and pseudonymous CSV exports.
- **System:** the version, the language model's health, and the **EMG settings** (every muscle-sensor threshold, with defaults and a reset).
- **Demo data:** two demo patients with four weeks of synthetic sessions, progress, alerts and reports, left out of research exports.

Webcam video never leaves the browser.

<table>
  <tr>
    <td width="33%"><img src="docs/images/screens/camera-check.png" alt="Camera check"><br><sub>Camera check</sub></td>
    <td width="33%"><img src="docs/images/screens/warmup-grid.png" alt="The six warm-up exercises"><br><sub>Warm-up: six exercises</sub></td>
    <td width="33%"><img src="docs/images/screens/games-grid.png" alt="The nine games"><br><sub>Nine games</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/screens/report-en.png" alt="Feedback report"><br><sub>Feedback report</sub></td>
    <td><img src="docs/images/screens/progress-charts.png" alt="Progress charts"><br><sub>Progress</sub></td>
    <td><img src="docs/images/screens/admin-dashboard.png" alt="Admin overview"><br><sub>Admin overview</sub></td>
  </tr>
</table>

## How a session works

1. **Start:** the patient presses Start session on the home page (or continues one left part way through).
2. **Camera check:** light, distance, framing and the tracked body, all green before going on. The muscle sensor can be turned on here.
3. **Muscle sensor (optional):** safety questions, electrode site, a nine-item sensor check, then calibration (10 s rest and three maximum efforts).
4. **Reach calibration:** the wrist out to 8 stars; the reach map is the session's workspace.
5. **Warm-up:** six exercises with repetition counters, compensation cues and personal targets.
6. **Plan:** the planner chooses and orders the games, each with a reason; the patient can untick one.
7. **Games:** each trial's settings come from the engine, after the safety layer; trials are saved in batches.
8. **Cool-down:** guided rest and a short questionnaire (pain, tiredness, enjoyment, difficulty, new symptoms).
9. **Summary:** the session's results and the feedback report, in the patient's language.

```mermaid
sequenceDiagram
  actor P as Patient
  participant B as Browser
  participant S as Server
  participant L as Local model
  P->>B: Start session
  B->>S: POST /api/sessions
  B->>B: Camera check (landmarks only)
  opt Muscle sensor today
    B->>B: Safety questions, sensor check, EMG calibration
    B->>S: POST /sessions/{id}/emg-calibration
  end
  B->>B: Reach calibration (8 directions)
  B->>S: POST /sessions/{id}/calibration
  B->>B: Warm-up (6 exercises, rep counters)
  B->>S: POST /sessions/{id}/warmup
  B->>S: GET /sessions/{id}/plan
  loop Each game, each trial
    B->>S: POST /api/engine/next
    S-->>B: Settings, level, cue (after the safety layer)
    B->>S: POST /api/games/{run}/trials
  end
  B->>S: POST /sessions/{id}/questionnaire and /end
  B->>S: POST /sessions/{id}/feedback
  S->>L: Facts and rules only
  L-->>S: JSON report
  S->>S: Validate (or the template)
  S-->>B: Report and fixed safety notices
```

The full diagram is in [docs/architecture.md](docs/architecture.md) (also as an image: [session-sequence.png](docs/images/diagrams/session-sequence.png)).

## Screenshot gallery

The screenshots are made automatically in test mode (demo data, a replayed camera, the simulated muscle sensor and the mock language model) by `.\scripts\docs\make_screenshots.ps1`, so the report text is the mock model's or the template's, not a real model's.

<details>
<summary><b>Patient: start, camera, calibration, warm-up</b></summary>

| | |
| --- | --- |
| ![Login](docs/images/screens/login.png) | ![Patient home](docs/images/screens/patient-dashboard.png) |
| Login | Patient home |
| ![Camera check](docs/images/screens/camera-check.png) | ![Reach calibration](docs/images/screens/calibration.png) |
| Camera check (the replayed recording) | Reach calibration |
| ![Warm-up exercises](docs/images/screens/warmup-grid.png) | ![Compensation warning](docs/images/screens/compensation-warning.png) |
| The six warm-up exercises | A compensation cue |
| ![Session plan](docs/images/screens/session-plan.png) | ![Session end](docs/images/screens/session-end.png) |
| The plan, with reasons | Session summary |

</details>

<details>
<summary><b>The nine games</b></summary>

![All nine games](docs/images/screens/games-grid.png)

| | | |
| --- | --- | --- |
| ![Reach and squeeze](docs/images/screens/game-reach-activate.png) | ![Balloon pop](docs/images/screens/game-balloon-pop.png) | ![Fruit catch](docs/images/screens/game-fruit-catch.png) |
| Reach and squeeze | Balloon pop | Fruit catch |
| ![Bloom](docs/images/screens/game-bloom.png) | ![Finger piano](docs/images/screens/game-finger-piano.png) | ![Path trace](docs/images/screens/game-path-trace.png) |
| Bloom | Finger piano | Path trace |
| ![Paint the wall](docs/images/screens/game-paint-wall.png) | ![Pick and place](docs/images/screens/game-pick-place.png) | ![Grip and hold](docs/images/screens/game-grip-hold.png) |
| Paint the wall | Pick and place | Grip and hold |
| ![Level display](docs/images/screens/level-display.png) | ![Game results](docs/images/screens/game-results.png) | |
| The level in a game | A game's results | |

</details>

<details>
<summary><b>The muscle sensor (simulated)</b></summary>

| | |
| --- | --- |
| ![EMG readiness](docs/images/screens/emg-readiness.png) | ![EMG calibration](docs/images/screens/emg-calibration.png) |
| The nine-item sensor check | Calibration: a maximum effort |
| ![EMG calibration summary](docs/images/screens/emg-calibration-summary.png) | ![EMG settings](docs/images/screens/emg-settings.png) |
| Calibration summary | Admin: EMG settings |

</details>

<details>
<summary><b>Reports, progress and accessibility</b></summary>

| | |
| --- | --- |
| ![Report in English](docs/images/screens/report-en.png) | ![Report in Bangla](docs/images/screens/report-bn.png) |
| Feedback report, English | Feedback report, Bangla |
| ![Progress](docs/images/screens/progress-charts.png) | ![Accessibility settings](docs/images/screens/accessibility-settings.png) |
| Progress charts | Display and sound settings |
| ![Bangla interface](docs/images/screens/bangla-ui.png) | |
| The interface in Bangla | |

</details>

<details>
<summary><b>Therapists and researchers</b></summary>

| | |
| --- | --- |
| ![Admin overview](docs/images/screens/admin-dashboard.png) | ![Patient programme](docs/images/screens/patient-programme.png) |
| Overview | A patient's programme |
| ![Alerts](docs/images/screens/alerts.png) | ![Research mode](docs/images/screens/research-mode.png) |
| Alerts | Research mode |

</details>

## Architecture

![Components](docs/images/diagrams/components.png)

The browser does all the sensing; the server keeps the data, adapts the difficulty and writes the feedback; a local language model (Ollama) writes the report text. More diagrams (data flow, a session) and the privacy and safety design are in [docs/architecture.md](docs/architecture.md); the data flow as an image: [data-flow.png](docs/images/diagrams/data-flow.png).

| Component | What it does | Code |
| --- | --- | --- |
| Vision engine | MediaPipe hand and pose landmarks in the page (WASM, GPU), smoothed, in a body frame centred on the shoulder (units of shoulder widths) | `web/src/vision/` |
| Warm-up | Six exercises: repetition and sequence counters, compensation detection, personal targets | `web/src/warmup/` |
| Games | Nine games on one shell (fixed timestep, HUD, results, trial saving) | `web/src/games/` |
| Input sources | Camera grip, openness, pinch and finger touch, the muscle sensor and the keyboard, with a camera fallback | `web/src/input/` |
| EMG | Web Serial stream, protocol, envelope, readiness, calibration, %MVC, onsets, mock board | `web/src/emg/` |
| Browser AI helpers | Each trial's summary for the engine, its cues | `web/src/ai/` |
| Movement measures | Speed, path, SPARC smoothness | `web/src/metrics/`, `server/app/metrics/` |
| REST API | Auth (JWT), patients, sessions, games, engine, feedback, studies, settings | `server/app/api/` |
| Engines and safety | L0, L1, L2 and the safety layer | `server/app/engine/` |
| Services | Planner, programme, metrics, alerts, studies, exports, progress | `server/app/services/` |
| Feedback | Facts, rules, prompt, local model, validator, template, jobs | `server/app/feedback/` |
| Database | SQLite (or PostgreSQL) through SQLModel | `server/app/models/`, `server/app/core/db.py` |
| Firmware | ESP32: 500 Hz sampling, serial protocol | `firmware/emg_stream/` |
| Shared specs | Game settings, the metric catalogue, safety notices, test vectors | `shared/` |

## Technology stack

| Layer | Technology | Why chosen |
| --- | --- | --- |
| Front end | React 19, TypeScript 6 (strict), Vite 8 | A typed, fast single-page app; strict types catch errors in the maths and the protocol |
| Styling | Tailwind CSS 4, lucide-react icons | Consistent, accessible design tokens without a component library |
| Data fetching | TanStack Query 5, axios | Caching, retries and offline handling for the API |
| Routing | React Router 7 | Nested layouts (public, patient, session, admin) and lazy pages |
| Charts | Recharts 3 | Simple, accessible charts for progress and admin pages |
| Vision | MediaPipe Tasks Vision (hand and pose landmarkers) | Runs in the browser (WASM, GPU), so video never leaves the computer |
| Muscle sensor | Web Serial API, ESP32 DevKit V1, Advancer Muscle Sensor V3.0 | No driver or app to install: the browser reads the board over USB |
| Back end | Python 3.12, FastAPI, Pydantic settings | Typed request and response models, automatic API docs |
| Database | SQLModel on SQLite (PostgreSQL possible) | One file for a single computer; the same models work on a server |
| Auth | PyJWT, Argon2 password hashing (pwdlib) | Standard tokens and a modern password hash |
| Maths | NumPy, SciPy | Kinematics, SPARC, statistics and the L2 engine |
| Language model | Ollama with `qwen3.5:4b` (local) | Private (no data leaves the computer) and free to run; see [llm-model-choice.md](docs/llm-model-choice.md) |
| Tests | pytest, Vitest, Testing Library, vitest-axe, Playwright | Unit, accessibility and end-to-end tests with a replayed camera and a simulated sensor |
| Deployment | Docker Compose, nginx | One command for the release, with security headers and an optional GPU profile |

Exact versions are pinned in `web/package.json` and `server/requirements.txt`; licences are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## AI adaptation

The difficulty of each game is a set of components (spatial, speed, precision, activation) between 0 and 1, turned into the game's settings within its spec bounds. Patients see only a level from 1 to 10 and, sometimes, a short cue. The full design is in [docs/ai-engine.md](docs/ai-engine.md).

| Engine | How it adapts | Code |
| --- | --- | --- |
| **L0** | Fixed: always the therapist's settings | `server/app/engine/l0_fixed.py` |
| **L1** (default) | A transformed up-down staircase (two successes harder, one failure easier, on the component the failure points at), with a warm restart each session | `server/app/engine/l1_staircase.py` |
| **L2** | Bayesian: beliefs about success, Thompson sampling, workspace-aware target directions | `server/app/engine/l2_bayes.py` |

- **The safety layer** (`server/app/engine/safety.py`) runs after every engine decision and can block or reverse it: hard bounds, the therapist's caps, and responses to compensation, repeated failure, tiring and the session's length. The engine cannot override it.
- **The planner** (`server/app/services/planner.py`) chooses and orders the next session's games from the programme and the patient's recent results, each with a reason.
- **Every decision is logged** with a reason in plain words, the state before and after, and any safety override (the admin's session page).
- **In simulation** (simulated patients, not people) L1 did better than L2 for moderate and severe profiles; L1 is the default ([simulation results](docs/simulation-results.md)).

## LLM feedback

**Code calculates, rules decide, the LLM only writes.**

1. **Code calculates:** the session's measures become a facts JSON with a patient code and no name (`server/app/services/session_facts.py`, [session-facts.md](docs/session-facts.md)).
2. **Rules decide:** suggestions and red flags (pain, new symptoms) come from fixed rules (`server/app/feedback/rules.py`); red flags add fixed safety notices the model cannot change.
3. **The LLM only writes:** a local model (Ollama, `qwen3.5:4b`) turns the facts and rules into short text, as JSON (`server/app/feedback/llm.py`, `prompt.py`).
4. **The text is checked** against the facts: numbers, directions and banned medical words (`server/app/feedback/validate.py`). After three failed attempts, a template report is used instead (`server/app/feedback/fallback.py`).

Reports are written in English or Bangla (directly, through translation, or by template: `LLM_BN_STRATEGY`). The evaluation of the reports is in [docs/llm-evaluation.md](docs/llm-evaluation.md) (PENDING).

## Hardware: the muscle sensor (optional)

A session can also use a muscle sensor: an **Advancer Muscle Sensor V3.0** read by an **ESP32 DevKit V1** at 500 samples per second, connected to the laptop by USB and read by the browser over Web Serial (Chrome or Edge). Each session uses one electrode site: the forearm **flexors** drive the grip level in Reach and squeeze and Grip and hold, or the **extensors** drive hand opening in Bloom. If the sensor pauses (unplugged, an electrode off), the games carry on with the webcam and switch back when it recovers. Without the sensor, everything works on the webcam as before.

> **Electrical safety:** whenever electrodes are on a person, the laptop must run on battery, with its charger unplugged. The sensor runs on two 9 V batteries, and its signal reaches the ESP32 only through a voltage divider that keeps the pin at or below 3.0 V.

- [Hardware day runbook](docs/hardware-day.md): parts, wiring diagram, the divider, electrode placement, the step order and troubleshooting for each check.
- [Firmware and hardware guide](firmware/README.md): parts, wiring, the voltage divider, electrode placement and uploading the firmware with the Arduino IDE.
- [EMG hardware test](docs/emg-hardware-test.md): the step-by-step first test, with a table to fill in.
- **The protocol:** lines `E,counter,mV` (samples) and `S,counter,dropped,version,mode` (status), and the commands `START`, `STOP`, `PING`, `RATE`, `SIM ON`/`SIM OFF` and `INFO` (`firmware/emg_stream/emg_stream.ino`, `web/src/emg/protocol.ts`, `firmware/test-lines.txt`).
- **Without hardware:** a mock board (`web/src/emg/mockSerial.ts`) plays the firmware's protocol through the same code as the real board, in tests and on the development page `/dev/emg-monitor` (live plot, readiness, commands, "Record 30 s CSV"). The firmware's own `SIM ON` signal shows a "Board simulation" badge. A simulated sensor (press **M** to squeeze) is offered in development builds only; a production build offers it only when the browser's `localStorage` key `muvi-simulated-emg` is set to `on` (for demos).
- **Thresholds:** every muscle-sensor threshold is on Admin → System → EMG settings (`web/src/emg/emgSettings.json`).

## Privacy and safety

- **Video never leaves the browser.** Only landmark-derived numbers are sent (angles, positions in shoulder widths, outcomes, timings); an end-to-end test checks every request of a whole session (`web/e2e/privacy.spec.ts`).
- **EMG is stored only as numbers:** the calibration, per-trial measures and a capped %MVC trace.
- **The language model is local** and gets only the session's facts (a patient code, no name or email).
- **Exports are pseudonymous** (patient codes); research consent is recorded with its date; demo patients are left out.
- **Security:** rate-limited login, request limits, security headers and a content security policy; production refuses default secrets ([security.md](docs/security.md)).
- **Safety:** the safety layer, the therapist's programme limits, fixed safety notices for pain or new symptoms, alerts for the therapist, and the muscle sensor's safety questions. **Not a medical device:** no diagnosis, no treatment decisions.

## Project structure

The main folders and files, with what each does. Generated folders (`node_modules/`, `.venv/`, `dist/`, `data/`, caches) are left out.

```text
.
├── README.md                     this file
├── CHANGELOG.md                  every change, by day and release
├── THIRD_PARTY_NOTICES.md        licences of the dependencies, assets and the model
├── docker-compose.yml            the release: server, web (nginx, port 8080), Ollama profiles
├── docker-compose.dev.yml        development with live reload (ports 5173 and 8000)
├── web/                          the browser app (React, TypeScript, Vite)
│   ├── src/
│   │   ├── main.tsx              start-up: providers (query, auth, toasts, EMG), the router
│   │   ├── app/router.tsx        every page and layout; /dev pages only in development builds
│   │   ├── config/project.ts     the project's name, institutions, supervisors, team, version
│   │   ├── vision/               MediaPipe engine, tracking, body frame, joint angles, setup checks
│   │   ├── warmup/               the six exercises: rep counter (repCounter.ts), sequence counter,
│   │   │                         compensation (compensation.ts), personal targets (personalise.ts)
│   │   ├── games/                the nine games (one folder each) and shared/ (GameShell, HUD, results)
│   │   ├── input/                level sources: camera grip/openness/pinch/touch, EMG (emgSource.ts),
│   │   │                         keyboard; inputManager.ts falls back to the camera
│   │   ├── emg/                  muscle sensor: serial.ts (Web Serial), protocol.ts, engine.ts,
│   │   │                         readiness.ts (9 checks), calibration.ts, emgSettings.json, mockSerial.ts
│   │   ├── ai/                   each trial's summary for the engine (trialSummary.ts), engine cues
│   │   ├── metrics/              speed, path length, SPARC smoothness
│   │   ├── features/             page parts by area: admin, alerts, auth, display, emg, emgSettings,
│   │   │                         feedback (reports), games, metrics, patient, programme, progress,
│   │   │                         research, review, session
│   │   ├── pages/                public (landing, login, about), patient, session steps, admin
│   │   ├── components/           layouts, UI kit (Button, Card, Input…), brand, language switch
│   │   ├── i18n/                 en.ts and bn.ts (every string), t(), Bengali digits
│   │   ├── a11y/                 contrast and accessibility (axe) tests
│   │   ├── security/             security header and CSP tests
│   │   ├── testing/              test mode: replayed camera, synthetic landmarks, test hooks
│   │   ├── dev/                  development pages: exercise lab, EMG lab, EMG monitor,
│   │   │                         latency and angle validation, guided recorder
│   │   └── lib/                  API client, formatting, sounds, speech
│   ├── e2e/                      Playwright end-to-end suites (auth, admin, patient session, EMG,
│   │   │                         resilience, Bangla, research, privacy, responsive, perf)
│   │   └── docs/screenshots.spec.ts  the README's screenshots (run on demand)
│   ├── plugins/saveLandmarks.ts  development-only save endpoints (landmark recordings, EMG CSVs)
│   ├── scripts/                  bundle scan, CSP check, spec export, fixtures
│   ├── public/                   logos, team photos, test fixtures (landmark recordings)
│   ├── playwright.config.ts      end-to-end tests; playwright.docs.config.ts for the screenshots
│   ├── nginx.conf, Dockerfile    the release web server (port 8080, /api proxy, headers)
│   └── package.json              scripts and exact dependency versions
├── server/                       the API (FastAPI, SQLModel)
│   ├── app/
│   │   ├── main.py               the app: routers, hardening, start-up checks
│   │   ├── api/                  routes: auth, admin, patient, sessions, games, engine, feedback,
│   │   │                         review, studies, emg_settings, health; testing.py (APP_ENV=test only)
│   │   ├── engine/               base.py, l0_fixed.py, l1_staircase.py, l2_bayes.py, safety.py,
│   │   │                         difficulty.py, sim/ (simulated patients)
│   │   ├── services/             planner.py, programme.py, session_metrics.py, alerts.py, studies.py,
│   │   │                         exports.py, progress.py, session_facts.py, emg_settings.py, …
│   │   ├── feedback/             the report pipeline: rules.py, prompt.py, llm.py, validate.py,
│   │   │                         fallback.py (template), jobs.py, banned word lists, templates
│   │   ├── metrics/              kinematics, SPARC, signal processing, aggregation
│   │   ├── models/               database tables; schemas/ request and response models
│   │   └── core/                 settings (config.py), database, security, hardening, MDC
│   ├── scripts/                  seed_demo.py, seed_demo_data.py, backup_db.py, data_dictionary.py,
│   │                             smoke_test.py, backfill_metrics.py, third_party_notices.py
│   ├── tests/                    pytest suites (API, engine, safety, feedback, EMG, release…)
│   ├── .env.example              every setting, with comments
│   └── requirements.txt          exact dependency versions
├── firmware/                     ESP32 firmware and hardware guide
│   ├── emg_stream/emg_stream.ino 500 Hz sampling task, serial protocol and commands
│   ├── test-lines.txt            protocol examples shared by the browser and Python tests
│   └── README.md                 wiring, voltage divider, electrodes, flashing, safety
├── analysis/                     offline analysis (Python)
│   ├── validation/               pilot validation: statistics, run_validation.py, render_docs.py
│   ├── emg/emg_validation.py     EMG recordings: rate, gaps, rest, MVC CV%, onset latency
│   ├── llm/                      report evaluation, model comparison, Bangla strategies
│   ├── perf/api_perf.py          API latency and load test
│   ├── tools/                    emg_protocol.py (line parser), serial_rate.py (ESP32 rate check)
│   ├── run_simulation.py         the engine simulation (L0, L1, L2)
│   └── results/                  result files the docs are generated from
├── shared/                       game-specs.json, metrics-catalog.json, safety-notices.json,
│                                 test vectors shared by the browser and the server
├── scripts/                      check.ps1 (every check), start.ps1, stop.ps1, backup.ps1,
│   │                             restore.ps1
│   └── docs/                     make_screenshots.ps1, optimise_images.py, check_readme_links.py,
│                                 make_report.ps1
├── tools/docs/                   the technical report builder (build_report.py, report_content.py;
│                                 its own requirements.txt, not a server dependency)
└── docs/                         documentation (see below); images/ screenshots and diagrams
```

**Where each feature is handled:**

| Feature | Where |
| --- | --- |
| Camera check | `web/src/vision/setupChecks.ts`, `web/src/pages/session/SessionSetupPage.tsx` |
| Reach calibration | `web/src/pages/session/SessionCalibratePage.tsx`, `web/src/components/ReachMap.tsx` |
| Repetition counting | `web/src/warmup/repCounter.ts`, `web/src/warmup/sequenceCounter.ts` |
| Compensation cues | `web/src/warmup/compensation.ts`, `web/src/warmup/compensationConfig.ts` |
| Game loop and HUD | `web/src/games/shared/GameShell.tsx` |
| Squeeze and hand input | `web/src/input/` (`inputManager.ts`, `cvGripSource.ts`, `emgSource.ts`) |
| L1 engine | `server/app/engine/l1_staircase.py` |
| L2 engine | `server/app/engine/l2_bayes.py` |
| Safety layer | `server/app/engine/safety.py` |
| Session planner | `server/app/services/planner.py` |
| Movement measures and MDC | `server/app/services/session_metrics.py`, `server/app/metrics/`, `server/app/core/mdc.py` |
| Feedback reports | `server/app/feedback/` |
| Alerts | `server/app/services/alerts.py` |
| Research mode | `server/app/services/studies.py`, `web/src/features/research/` |
| Muscle sensor | `web/src/emg/`, `firmware/emg_stream/emg_stream.ino` |
| EMG settings | `web/src/emg/emgSettings.ts`, `server/app/services/emg_settings.py` |
| Translations | `web/src/i18n/en.ts`, `web/src/i18n/bn.ts` |

**Top-level folders:**

| Folder      | Purpose                                                       | Status  |
| ----------- | ------------------------------------------------------------- | ------- |
| `web/`      | React + TypeScript + Vite front end                           | In use  |
| `server/`   | FastAPI + SQLModel back end; all API routes start with `/api` | In use  |
| `firmware/` | ESP32 firmware for the EMG muscle sensor                      | In use  |
| `analysis/` | Offline data analysis                                         | In use  |
| `shared/`   | Specs and test vectors shared by the web app and the server   | In use  |
| `scripts/`  | Start, stop, backup, restore, checks and docs scripts         | In use  |
| `docs/`     | Project documentation and daily logs                          | In use  |
| `data/`     | Local SQLite database and other local data (git-ignored)      | In use  |

## Installation

The quickest path for a computer that will run MuVi Rehab is the release with Docker: [docs/install.md](docs/install.md) ([বাংলা](docs/install.bn.md)), with `.\scripts\start.ps1` and `.\scripts\stop.ps1`. The steps below are for development.

### How to run

You need Python 3.12 or newer, Node.js 22 or newer, and a recent version of Chrome or Edge with a webcam. Use two terminals, one for the backend and one for the frontend. Start in the repository root in both.

### 1. Backend

Windows PowerShell:

```powershell
cd server
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Linux/macOS:

```sh
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Then open `server/.env` and replace the placeholders:

- `JWT_SECRET`: generate a value with `python -c "import secrets; print(secrets.token_hex(32))"`.
- `ADMIN_PASSWORD`: choose a strong password (12 characters or more). Do this before the first start, because changing it later does not update an existing admin.

Create the demo patients. This also creates the database if it does not exist yet:

```sh
python scripts/seed_demo.py
```

Save the passwords it prints, because they are shown only once. Then start the server, which runs on port 8000:

```sh
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

These commands are the same on Windows, Linux and macOS. The dev server runs on port 5173 and proxies `/api` to the backend.

```sh
cd web
npm install
npm run dev
```

The camera check downloads its tracking files from the internet when it starts, so it needs a connection.

### 3. Open the app

| What              | URL                              |
| ----------------- | -------------------------------- |
| App               | <http://localhost:5173>          |
| API documentation | <http://localhost:8000/docs>     |
| Health check      | <http://localhost:8000/api/health> |

### Run with Docker

Docker is optional. The steps above keep working without it.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/). On Windows, choose the WSL 2 option.
2. Create `server/.env` as described in [1. Backend](#1-backend), if you have not already. Both Docker setups read it.

**Open the site through `localhost`.** Browsers only allow the camera on `localhost` or HTTPS, so an address like `http://192.168.1.10:5173` will not work.

#### Development

Code changes reload automatically. Stop any local `uvicorn` or `npm run dev` first, because the ports are the same.

| Task                 | Command                                                 |
| -------------------- | ------------------------------------------------------- |
| Start                | `docker compose -f docker-compose.dev.yml up --build`, then <http://localhost:5173> |
| Seed demo patients   | `docker compose -f docker-compose.dev.yml exec server python scripts/seed_demo.py` |
| Seed demo data       | `docker compose -f docker-compose.dev.yml exec server python scripts/seed_demo_data.py` |
| Follow server logs   | `docker compose -f docker-compose.dev.yml logs -f server`                         |
| Stop                 | `docker compose -f docker-compose.dev.yml down`         |

Seed from a second terminal while the app is running, and save the passwords it prints.

If you add a dependency to `requirements.txt` or `package.json`, restart with `docker compose -f docker-compose.dev.yml up --build`. For a new frontend dependency, also add `-V` so that Docker rebuilds the `node_modules` volume.

#### Release (1.0)

```sh
docker compose --profile ollama up --build -d
```

Then open <http://localhost:8080>. The containers restart automatically until you stop them (`docker compose down`). The release runs with `APP_ENV=production`: set a real admin password and JWT secret in `server/.env` first. See [docs/install.md](docs/install.md) for the GPU profile, host Ollama, the no-model option, `scripts/start.ps1` and backups.

#### Reset the data

Local runs and the development Docker setup share one database, `data/motionlab.db`; the release keeps its own in the `muvi-data` volume. To start again, stop the app and delete that file. The admin is created again on the next start, and you can then seed the demo patients again. Backups: `.\scripts\backup.ps1` and `.\scripts\restore.ps1`.

## Usage

### Log in

| Role                | Login                                              |
| ------------------- | -------------------------------------------------- |
| Admin               | `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env` |
| Demo patients       | The logins printed by `seed_demo.py` (one with the left side affected, one with the right) |

Lost a demo password? Log in as admin, open the patient, click **Edit** and set a new one.

### Demo data for the dashboards (optional)

To show the dashboards without weeks of practice, create two demo patients with four weeks of synthetic sessions, progress, alerts and reports. Run this from `server/` with the virtual environment active:

```sh
python scripts/seed_demo_data.py          # remove old demo patients, then create them again
python scripts/seed_demo_data.py --reset  # the same, said explicitly
python scripts/seed_demo_data.py --clear  # only remove demo patients and all their data
```

It prints the two demo logins: one with the left side affected and steady progress, one with the right side affected, slower progress and one unreviewed pain alert. They are marked **Demo** in the admin patient list and left out of research exports. Only patients marked as demo are ever removed.

### Guides

- [Guide for patients](docs/user-guide-patient.md) ([বাংলা](docs/user-guide-patient.bn.md))
- [Guide for therapists and researchers](docs/admin-guide.md)
- [10-minute demo script](docs/demo-script.md)
- [API contract](docs/api-contract.md) and [day logs](docs/day-logs/README.md)

## Testing

### Run the checks

On Windows, run every check at once from the repository root:

```powershell
.\scripts\check.ps1             # add -SkipBuild to leave out the build, -E2E for the end-to-end suite
```

It runs, and prints PASS or FAIL for each:

1. backend tests with coverage;
2. frontend tests, lint and build;
3. `server/scripts/smoke_test.py` against a backend it starts itself on port 8765.

That backend uses a temporary database and admin login, so your own database and `server/.env` are not changed. A summary table comes at the end. The exit code is 0 only if every step passed. If PowerShell refuses to run scripts, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

The same checks by hand:

```sh
# From server/, with the virtual environment active
pytest --cov=app --cov=scripts

# From web/
npm test
npm run lint
npm run build

# With the server running, from server/
python scripts/smoke_test.py
```

The smoke test adds a test patient to the database it runs against, and deactivates it at the end.

More tests (from `web/`):

```sh
npm run i18n:check       # every English string has Bangla
npm run e2e              # Playwright, fast: every suite with short sessions (starts its own servers)
npm run e2e:full         # the main patient journey at full length
npm run e2e:perf         # the frame budget of every game
npm run scan:bundle      # no secrets, test code or /dev pages in the production build
```

The README's screenshots and diagrams: `.\scripts\docs\make_screenshots.ps1` (captures, optimises and checks the README's links). The testing strategy and current results are in [docs/testing.md](docs/testing.md).

## Configuration

Settings are read from `server/.env` (copy [server/.env.example](server/.env.example)). The most important:

| Setting | Default | What it does |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` refuses default secrets; `test` adds the test routes (never on real data) |
| `DATABASE_URL` | `sqlite:///../data/motionlab.db` | The database (SQLite file, or PostgreSQL) |
| `JWT_SECRET` | placeholder | The token signing key (32+ random characters in production) |
| `JWT_EXPIRE_MINUTES` | `720` | How long a login lasts |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | placeholders | The first admin, created at start-up |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed browser origins |
| `GAME_SPECS_PATH`, `METRICS_CATALOG_PATH`, `SAFETY_NOTICES_PATH` | empty (`shared/`) | The shared spec files |
| `MDC_PATH` | empty | Measured MDCs (used only if real data) |
| `SESSION_FINISH_SOON_MIN`, `SESSION_FINISH_MIN` | `25`, `35` | Minutes of play before "finish soon" and "finish" |
| `LLM_PROVIDER` | `ollama` | `ollama` or `mock` |
| `OLLAMA_URL`, `LLM_MODEL` | `http://localhost:11434`, `qwen3.5:4b` | The local model |
| `LLM_TEMPERATURE`, `LLM_TOP_P`, `LLM_NUM_CTX`, `LLM_MAX_TOKENS` | `0.2`, `0.9`, `4096`, `700` | Generation settings |
| `LLM_TIMEOUT_S`, `LLM_JOB_LIMIT_S`, `LLM_KEEP_ALIVE` | `60`, `120`, `30m` | Time limits; after the job limit the template is used |
| `LLM_BN_STRATEGY` | `direct` | Bangla reports: `direct`, `translate` or `template` |
| `FEEDBACK_SESSION_END_WAIT_S` | `10` | How long a queued report waits for its session to end |

The muscle sensor's thresholds are not in `.env`: an admin changes them on **Admin → System → EMG settings**. Docker settings (`WEB_PORT`, `OLLAMA_VERSION`, the profiles) are in [docs/install.md](docs/install.md).

## API overview

Every route starts with `/api`; the interactive documentation is at <http://localhost:8000/docs>. The full contract, with every request and response, is [docs/api-contract.md](docs/api-contract.md).

| Group | Prefix | For |
| --- | --- | --- |
| Health and version | `/api/health`, `/api/version` | Anyone |
| Authentication | `/api/auth` | Log in, register, the signed-in user |
| Patient | `/api/patient` | The patient's own dashboard, progress, sessions, reports and programme |
| Sessions | `/api/sessions` | Start, steps (calibration, EMG, warm-up, plan, questionnaire), end, feedback |
| Games and engine | `/api/games`, `/api/engine` | Game runs and trials; the next trial's settings |
| Feedback | `/api/feedback` | Report jobs and their results |
| Admin | `/api/admin` | Patients, programmes, sessions, alerts, games, studies, exports, EMG settings |
| EMG settings | `/api/emg-settings` | The admin's EMG thresholds, for every signed-in browser |
| Test routes | `/api/test` | Only with `APP_ENV=test` (end-to-end tests) |

## Documentation

| Document | What it covers |
| --- | --- |
| [Install](docs/install.md) ([বাংলা](docs/install.bn.md)) | Docker and native Windows install, troubleshooting |
| [Release notes 1.0](docs/release-notes-v1.0.md), [Known issues](docs/known-issues.md) | What is in 1.0 and what is still open |
| [Architecture](docs/architecture.md) | Components, data flow and a session, as diagrams; privacy and safety |
| [Data dictionary](docs/data-dictionary.md) | Every table and field, the metric catalogue, the facts schema (generated) |
| [Methods (draft)](docs/methods-draft.md) | An academic Methods section, with the places that need your input |
| [Validation](docs/validation.md) | The pilot validation protocol, results and limitations, and the EMG validation |
| [Results summary](docs/results-summary.md) | Every number, labelled pilot, simulation, engineering or PENDING, with its source (generated) |
| [The adaptive engine](docs/ai-engine.md) | Engines L0-L2, the safety layer, the planner, the feedback pipeline |
| [Simulation results](docs/simulation-results.md), [LLM evaluation](docs/llm-evaluation.md), [Model choice](docs/llm-model-choice.md) | The engine simulation; the feedback reports' evaluation; the local model |
| [Testing](docs/testing.md), [Performance](docs/performance.md), [Security](docs/security.md) | How the system is tested, and the results |
| [Hardware day](docs/hardware-day.md), [EMG hardware test](docs/emg-hardware-test.md), [Firmware](firmware/README.md) | The muscle sensor: runbook, test record, wiring and firmware |
| [Pending manual checks](docs/pending-manual-checks.md) | The validation session and other checks that need a person |
| [Session facts](docs/session-facts.md) | What the feedback model reads |
| [Patient guide](docs/user-guide-patient.md), [Admin guide](docs/admin-guide.md), [Demo script](docs/demo-script.md) | Guides |
| [API contract](docs/api-contract.md), [Day logs](docs/day-logs/README.md), [Docs index](docs/README.md) | Reference |
| [Technical report (Word)](docs/MuVi_Rehab_Technical_Report.docx) | Every part explained (what, how, why, alternatives) with 68 likely questions; rebuilt by `.\scripts\docs\make_report.ps1` |

## Results

Every number below is copied from the generated [results summary](docs/results-summary.md), with its label; nothing here is typed by hand. **Pilot** means one healthy participant; **simulation** means simulated patients, not people; **engineering** means the software on the development laptop.

| Result | Value | Label |
| --- | --- | --- |
| End-to-end latency | PENDING | PENDING |
| Joint angle RMSE and limits of agreement | PENDING | PENDING |
| MDC95 per measure | PENDING | PENDING |
| Repetition counting accuracy (guided recording) | 25% | pilot |
| Engine simulation (success rate, challenge error per profile) | see [simulation results](docs/simulation-results.md) | simulation |
| `/api/engine/next` p95 (L1 / L2) | 21.5 ms / 23.9 ms | engineering |
| Load test, 10 patients × 305 s | 0 errors in 11890 requests; p95 140 ms | engineering |
| Game loop, 9 games on replay | 60 FPS; p95 frame time ≤ 0.4 ms | engineering |
| LLM report evaluation | PENDING | PENDING |
| Usability (SUS) | PENDING | PENDING |
| EMG hardware validation | PENDING | PENDING |

The 25% repetition count is from one seated recording in which the shoulder exercises' rest line was not reached; see [known issues](docs/known-issues.md) and [validation](docs/validation.md).

## Roadmap

- **Day 21, hardware:** wire, flash and tune the muscle sensor; fill the EMG validation ([hardware-day.md](docs/hardware-day.md)).
- **Validation:** the pilot latency, joint-angle and repeatability sessions; measured MDCs ([pending-manual-checks.md](docs/pending-manual-checks.md)).
- **Evaluation:** the LLM report evaluation (automatic and blind human) and a usability test (SUS).
- **Release 1.0:** fix what the release candidate's checks find; a native speaker's review of the Bangla.
- **Later:** HTTPS deployment beyond `localhost` and token revocation ([known issues](docs/known-issues.md)), and studies with patients (with ethics approval).

## Citation

A citation will be added when the work is published. Until then, please cite the repository:

```bibtex
@misc{muvirehab2026,
  title  = {MuVi Rehab: Multimodal EMG and Webcam-Based Hand Posture Recognition for
            Real-Time Adaptive Rehabilitation Gaming},
  author = {Shadik, Nurul Absar and Ahammad, Nafis and Akhand, Muhammad Aminul Haque and
            Awal, Md. Abdul},
  year   = {2026},
  note   = {Research prototype. Department of CSE, KUET, with The University of Queensland.
            Citation details to be completed (PENDING)}
}
```

## Acknowledgements

- **Supervision:** Dr. Muhammad Aminul Haque Akhand (KUET) and Dr. Md. Abdul Awal (The University of Queensland).
- **Institutions:** the Department of Computer Science and Engineering, Khulna University of Engineering & Technology (KUET), and The University of Queensland.
- **Open-source software:** MediaPipe, React, FastAPI, SQLModel, Ollama and every library listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

The licence is to be decided (PENDING). Until a licence file is added, all rights are reserved by the authors. Third-party components keep their own licences ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
