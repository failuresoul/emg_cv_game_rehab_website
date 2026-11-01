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

### Server

Runs on port 8000.

See [server/README.md](server/README.md) for setup.

```sh
cd server
uvicorn app.main:app --reload --port 8000
```

### Web

Runs on port 5173 and proxies `/api` to the server.

```sh
cd web
npm install
npm run dev
```
