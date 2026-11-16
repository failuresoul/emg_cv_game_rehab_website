# Architecture

MuVi Rehab is a research prototype for home upper-limb rehabilitation after stroke, not a medical device. It has three parts:

- **The browser app:** React and TypeScript. It does all the sensing.
- **The server:** FastAPI with SQLModel and SQLite. It keeps the data, adapts the difficulty and writes the feedback.
- **A local language model:** Ollama, for the feedback text.

## Components

```mermaid
flowchart LR
  subgraph Browser["Browser (patient's computer)"]
    CAM[Webcam] --> VE["Vision engine<br/>MediaPipe Hand + Pose (WASM, GPU)"]
    VE --> TR["Tracker and body frame<br/>(shoulder origin, SW units)"]
    TR --> WU["Warm-up<br/>rep and sequence counters"]
    TR --> GM["9 games<br/>(GameShell, fixed timestep)"]
    ESP["ESP32 EMG<br/>(Web Serial)"] --> EE["EMG engine<br/>envelope, calibration, %MVC"]
    SIM[Simulated EMG] -.-> EE
    EE --> IM["Input manager<br/>camera grip / EMG / keyboard"]
    TR --> IM
    IM --> GM
    UI["Pages: setup, calibration,<br/>plan, cool-down, summary, admin"]
  end
  subgraph Server["Server (FastAPI)"]
    API[REST API, JWT auth] --> SES[Sessions, games, trials]
    API --> ENG["Engines L0 / L1 / L2<br/>+ safety layer"]
    API --> PLAN[Session planner]
    API --> MET["Metrics<br/>(trial, session, SPARC, MDC)"]
    API --> FB["Feedback pipeline<br/>facts, rules, prompt, validator"]
    API --> ADM[Programme, alerts, studies, exports]
  end
  DB[(SQLite or PostgreSQL)]
  LLM["Ollama<br/>local model"]
  UI <--> API
  GM <--> API
  WU --> API
  Server <--> DB
  FB <--> LLM
```

**Where the code is:**

| Part                                          | Code                   |
| --------------------------------------------- | ---------------------- |
| Vision engine                                 | `web/src/vision/`      |
| Warm-up                                       | `web/src/warmup/`      |
| Games                                         | `web/src/games/`       |
| Input sources                                 | `web/src/input/`       |
| EMG                                           | `web/src/emg/`         |
| Server routes                                 | `server/app/api/`      |
| Engines and safety                            | `server/app/engine/`   |
| Services (planner, metrics, alerts, studies…) | `server/app/services/` |
| Feedback                                      | `server/app/feedback/` |
| Firmware                                      | `firmware/`            |

## Data flow

```mermaid
flowchart TB
  V["Camera frames"] -->|stay in the browser| L["Landmarks (numbers)"]
  L --> A["Joint angles, hand measures,<br/>fingertip in the body frame"]
  A --> R["Warm-up results<br/>(reps, ranges, compensation)"]
  A --> T["Trials<br/>(outcome, timings, trajectory ≤ 2,000 points)"]
  E["EMG samples (500 Hz)"] -->|stay in the browser| EM["Envelope, %MVC trace ≤ 1,500 points"]
  EM --> T
  R --> S[(Server database)]
  T --> S
  S --> M["Trial and session measures<br/>(metric catalogue)"]
  M --> F["Session facts JSON<br/>(code, no name)"]
  F --> P["Rules: suggestions, red flags"]
  P --> LLM["Local model writes text"]
  LLM --> VAL{"Validator:<br/>numbers, directions,<br/>banned words"}
  VAL -->|pass| REP[Report]
  VAL -->|fail 3 times| TPL[Template report]
  M --> PLN["Planner: next session's games"]
  T --> ENG["Engine: next trial's settings"]
```

## A session

```mermaid
sequenceDiagram
  actor P as Patient
  participant B as Browser
  participant S as Server
  participant L as Local model
  P->>B: Start session
  B->>S: POST /api/sessions
  S-->>B: Session (study condition and repeatability visit set here)
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
  S-->>B: Games in order, with reasons
  loop Each game, each trial
    B->>S: POST /api/engine/next (last trial)
    S-->>B: Settings, level, cue (after the safety layer)
    B->>S: POST /api/games/{run}/trials (batched, retried)
  end
  B->>S: POST /sessions/{id}/questionnaire
  B->>S: POST /sessions/{id}/end
  S->>S: Session measures, alerts
  B->>S: POST /sessions/{id}/feedback
  S->>L: Facts and rules only
  L-->>S: JSON report
  S->>S: Validate (or the template)
  B->>S: GET /feedback/jobs/{id}
  S-->>B: Report and fixed safety notices
```

## Privacy

- **Video never leaves the browser.** MediaPipe runs in the page. Only landmark-derived numbers are sent: angles, positions in shoulder widths, outcomes and timings. The end-to-end privacy test checks every request of a whole session (`web/e2e/privacy.spec.ts`).
- **EMG is stored only as numbers:**
  - the calibration;
  - per-trial measures;
  - a capped %MVC trace.
- **The language model is local** (Ollama). It gets only the session's facts JSON: a patient code, no name or email.
- **Exports are pseudonymous** (patient codes). Research consent is recorded with its date.
- **Fonts:** the web fonts load from Google Fonts. No session data is sent with them ([security.md](security.md)).

## Safety

- **A safety layer after every engine decision** (`server/app/engine/safety.py`). It sets hard bounds and the therapist's caps, and responds to:
  - compensation;
  - repeated failure;
  - tiring;
  - the session's length.

  The engine cannot override it.

- **The therapist's programme** (`services/programme.py`) limits:
  - the games and the highest level of each;
  - the session's length;
  - how often to rest;
  - the warm-up's targets.
- **The muscle sensor:** safety questions (charger unplugged, fresh batteries) must be answered before the sensor is used. A lost signal falls back to the camera.
- **Feedback text:**
  - it is checked against the facts;
  - medical words are banned;
  - red flags (pain, new symptoms) add fixed safety notices the model cannot change;
  - a failed check falls back to a template.
- **Alerts:** pain, new symptoms and sharp declines raise alerts for the therapist (`services/alerts.py`).
- **Not a medical device:** no diagnosis, no treatment decisions.

## Testing

Unit, integration and end-to-end tests use a replayed camera, a simulated sensor and a mock model; there are also performance, security and validation tools. See [testing.md](testing.md), [performance.md](performance.md), [security.md](security.md) and [validation.md](validation.md).
