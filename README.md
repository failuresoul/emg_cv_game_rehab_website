# MuVi Rehab

**MuVi Rehab — Muscle + Vision Rehabilitation.** EMG and vision-guided home rehabilitation for stroke.

A research prototype from the Department of Computer Science and Engineering, Khulna University of Engineering & Technology (KUET), Bangladesh, with The University of Queensland, Australia. It is not a medical device.

- **Research title:** Multimodal EMG and Webcam-Based Hand Posture Recognition for Real-Time Adaptive Rehabilitation Gaming
- **Supervisors:** Dr. Muhammad Aminul Haque Akhand (Professor, Dept. of CSE, KUET) and Dr. Md. Abdul Awal (Postdoctoral Fellow, The University of Queensland)
- **Team:** Nurul Absar Shadik and Nafis Ahammad (Dept. of CSE, KUET)

The project's name, institutions and people live in one file, [web/src/config/project.ts](web/src/config/project.ts). "MotionLab" is the internal code name: it stays in identifiers (storage keys, package names, the database file) but never in anything a user sees.

MuVi Rehab is a web platform for home-based arm and hand rehabilitation after stroke. A patient logs in, checks their camera, calibrates their reach, and completes warm-up exercises tracked by the webcam with MediaPipe. They then play rehabilitation games controlled by hand and arm movement, with an AI engine planning the session and adapting each game's difficulty to the patient. Each session ends with a short cool-down questionnaire and an AI feedback report. Therapists and researchers use an admin area to manage patients, programmes and games, and to review analytics. Webcam video and images never leave the browser: only landmarks, metrics and events go to the server.

**Version 0.1.0.** See the [changelog](CHANGELOG.md) for what changed.

## Features in v0.1

**For patients**

- **Camera check:** a live checklist for light, distance and framing.
- **Reach calibration:** reach in 8 directions, with a reach map compared with last time.
- **Warm-up:** six guided arm and hand exercises with rep counting, compensation cues and targets that adapt to each patient.
- **Three games:** Reach and squeeze, Balloon pop and Fruit catch, chosen and ordered on a plan screen, with webcam squeeze detection (keyboard for testing).
- **Cool-down:** a minute of guided rest, then a short questionnaire. Pain or anything new or unusual shows a fixed safety notice.
- **Summary:** time spent moving, warm-up goals and repetitions, a card per game, the reach map, and "compared with last time".
- **Progress:** streak, weekly goal ring, a 4-week calendar and trend charts on the home and Progress pages.
- **A resumable session:** the step is saved, so a refresh or a return carries on at the same step, with "Continue your session" or "Start over". There is a step bar, Exit from any step, an offline banner and a friendly error page.
- **English and Bangla.**

**For therapists and researchers**

- **Patients:** add, edit, deactivate and search patients, and set each one's weekly goal.
- **Session pages:** calibration, warm-up, every game trial with its reach map and charts, and the questionnaire.
- **Progress tab:** reach maps over time and warm-up charts with every personalisation decision.
- **Safety alerts:** flagged sessions on the overview, to mark reviewed with a note.
- **Demo data:** two demo patients with two weeks of synthetic sessions.

Webcam video never leaves the browser. Personal feedback reports, adaptive difficulty, EMG input and six more games are planned for later versions.

## Guides

- [Guide for patients](docs/user-guide-patient.md)
- [Guide for therapists and researchers](docs/admin-guide.md)
- [10-minute demo script](docs/demo-script.md)
- [API contract](docs/api-contract.md) and [day logs](docs/day-logs/README.md)

## Hardware: the muscle sensor (optional)

From Day 16 (not yet in a release), a session can also use a muscle sensor: an **Advancer Muscle Sensor V3.0** read by an **ESP32 DevKit V1** at 500 samples per second, connected to the laptop by USB and read by the browser over Web Serial (Chrome or Edge). Each session uses one electrode site: the forearm **flexors** drive the grip level in Reach and squeeze and Grip and hold, or the **extensors** drive hand opening in Bloom. If the sensor pauses (unplugged, an electrode off), the games carry on with the webcam and switch back when it recovers. Without the sensor, everything works on the webcam as before.

> **Electrical safety:** whenever electrodes are on a person, the laptop must run on battery, with its charger unplugged. The sensor runs on two 9 V batteries, and its signal reaches the ESP32 only through a voltage divider that keeps the pin at or below 3.0 V.

- [Firmware and hardware guide](firmware/README.md): parts, wiring, the voltage divider, electrode placement and uploading the firmware with the Arduino IDE.
- [EMG hardware test](docs/emg-hardware-test.md): the step-by-step first test, with a table to fill in.
- Development without hardware: a simulated sensor (press **M** to squeeze) is offered in development builds only. A production build offers it only when the browser's `localStorage` key `muvi-simulated-emg` is set to `on` (for demos).

## Planned folders

| Folder      | Purpose                                                       | Status  |
| ----------- | ------------------------------------------------------------- | ------- |
| `web/`      | React + TypeScript + Vite front end                           | Started |
| `server/`   | FastAPI + SQLModel back end; all API routes start with `/api` | Started |
| `firmware/` | ESP32 firmware for the EMG muscle sensor                      | Started |
| `analysis/` | Offline data analysis                                         | Started |
| `docs/`     | Project documentation and daily logs                          | Started |
| `data/`     | Local SQLite database and other local data (git-ignored)      | Started |

## How to run

You need Python 3.11 or newer, Node.js 22 or newer, and a recent version of Chrome or Edge with a webcam. Use two terminals, one for the backend and one for the frontend. Start in the repository root in both.

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
- `ADMIN_PASSWORD`: choose a strong password. Do this before the first start, because changing it later does not update an existing admin.

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

### 4. Log in

| Role              | Email                    | Password                                                 |
| ----------------- | ------------------------ | -------------------------------------------------------- |
| Admin             | `ADMIN_EMAIL` in `.env`  | `ADMIN_PASSWORD` in `.env`                               |
| Patient, left side  | `demo.left@example.com`  | Printed by `seed_demo.py`                                |
| Patient, right side | `demo.right@example.com` | Printed by `seed_demo.py`                                |

Lost a demo password? Log in as admin, open the patient, click **Edit** and set a new one.

### 5. Optional: demo data for the dashboards

To show the dashboards without weeks of practice, create two demo patients with two weeks of synthetic sessions. Run this from `server/` with the virtual environment active:

```sh
python scripts/seed_demo_data.py          # remove old demo patients, then create them again
python scripts/seed_demo_data.py --clear  # only remove demo patients and all their data
```

It prints the logins for `demo.rahim@example.com` (left side, steady progress) and `demo.salma@example.com` (right side, slower progress, one unreviewed pain alert). They are marked **Demo** in the admin patient list. Only patients marked as demo are ever removed.

### Run the checks

On Windows, run every check at once from the repository root:

```powershell
.\scripts\check.ps1             # add -SkipBuild to leave out the build
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

## Run with Docker

Docker is optional. The steps above keep working without it.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/). On Windows, choose the WSL 2 option.
2. Create `server/.env` as described in [1. Backend](#1-backend), if you have not already. Both Docker setups read it.

**Open the site through `localhost`.** Browsers only allow the camera on `localhost` or HTTPS, so an address like `http://192.168.1.10:5173` will not work.

### Development

Code changes reload automatically. Stop any local `uvicorn` or `npm run dev` first, because the ports are the same.

| Task                 | Command                                                 |
| -------------------- | ------------------------------------------------------- |
| Start                | `docker compose up --build`, then <http://localhost:5173> |
| Seed demo patients   | `docker compose exec server python scripts/seed_demo.py` |
| Seed demo data       | `docker compose exec server python scripts/seed_demo_data.py` |
| Follow server logs   | `docker compose logs -f server`                         |
| Stop                 | `docker compose down`                                   |

Seed from a second terminal while the app is running, and save the passwords it prints.

If you add a dependency to `requirements.txt` or `package.json`, restart with `docker compose up --build`. For a new frontend dependency, also add `-V` so that Docker rebuilds the `node_modules` volume.

### Production-like

```sh
docker compose -f docker-compose.prod.yml up --build -d
```

Then open <http://localhost:8080>. The containers restart automatically until you stop them:

```sh
docker compose -f docker-compose.prod.yml down
```

### Reset the data

Local runs and both Docker setups share one database, `data/motionlab.db`. To start again, stop the app and delete that file. The admin is created again on the next start, and you can then seed the demo patients again.
