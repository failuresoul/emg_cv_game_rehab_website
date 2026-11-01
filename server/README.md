# MotionLab server

FastAPI back end. Run every command below from `server/`. Requires Python 3.11 or newer.

## Create and activate the virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

Linux/macOS:

```sh
python3 -m venv .venv
source .venv/bin/activate
```

## Install

```sh
pip install -r requirements.txt
```

## Configure

Copy `.env.example` to `.env`, then replace the placeholder values. Never commit `.env`.

By default the server uses a local SQLite file at `data/motionlab.db`. To use a hosted PostgreSQL database, set `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/DATABASE
```

## Run

```sh
uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/api/health>

On startup the server creates the admin from `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME` if no admin exists. Changing these settings later does not update an existing admin.

## Demo patients

```sh
python scripts/seed_demo.py
```

Creates two demo patients, one left side and one right side, if they are missing. Each new patient gets a random password, which is printed only once.

## Test

```sh
pytest
```

Tests use an in-memory SQLite database and do not read `.env`.
