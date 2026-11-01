# MotionLab

MotionLab is a web platform for home-based arm and hand rehabilitation after stroke. A patient logs in, checks their camera, calibrates their reach, and completes warm-up exercises tracked by the webcam with MediaPipe. They then play rehabilitation games controlled by hand and arm movement, with an AI engine planning the session and adapting each game's difficulty to the patient. Each session ends with a short cool-down questionnaire and an AI feedback report. Therapists and researchers use an admin area to manage patients, programmes and games, and to review analytics. Webcam video and images never leave the browser: only landmarks, metrics and events go to the server.

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

### Run the checks

```sh
# From server/, with the virtual environment active
pytest

# From web/
npm run lint
npm run build
```
