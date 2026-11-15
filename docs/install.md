# Installing MuVi Rehab 1.0

MuVi Rehab runs on one computer: the patient's, or a clinic laptop. It is a research prototype, not a medical device.

You can install it in two ways:

- **Docker:** the simplest.
- **Native Windows:** Python and Node.js.

## What you need

- **A computer:**
  - Windows 10/11 (macOS and Linux work for Docker);
  - 8 GB RAM (16 GB with the language model);
  - a webcam.
- **A browser:** Chrome or Edge. Web Serial, which the muscle sensor needs, works only in Chromium browsers. The camera works in any modern browser.
- **The address:** open the app at `http://localhost:8080`. Browsers allow the camera and serial port only on a secure context, and `localhost` counts as one. A plain `http://<other-computer>` address does not: put HTTPS in front for that.
- **Optional:**
  - an NVIDIA GPU, for faster reports;
  - the MuVi muscle sensor (ESP32, `firmware/README.md`).

## 1. Settings (both ways)

```powershell
copy server\.env.example server\.env
notepad server\.env
```

Set these before the first start:

- **`ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`:** the administrator's login. The password needs 12 characters or more.
- **`JWT_SECRET`:** a long random string. To make one:

  ```powershell
  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | % {[char]$_})
  ```

- **`APP_ENV=production`:** with this set, the server refuses to start while the password or the secret is still a default.

## 2a. Docker (recommended)

1. **Install Docker Desktop** (with WSL 2 on Windows).
2. **Choose how reports are written, then start.** The first build takes a few minutes, and the model download (about 3 GB) longer.

   | Model | Command | `server\.env` |
   | --- | --- | --- |
   | Ollama in Docker, CPU | `.\scripts\start.ps1 -Model ollama` | — |
   | Ollama in Docker, NVIDIA GPU (WSL 2) | `.\scripts\start.ps1 -Model gpu` | — |
   | The Ollama app on this computer | `.\scripts\start.ps1` | `OLLAMA_URL=http://host.docker.internal:11434` |
   | No model (template reports) | `.\scripts\start.ps1` | `LLM_PROVIDER=mock` |

3. **Open the app** at `http://localhost:8080` and log in as the admin.
4. **Stop it** with `.\scripts\stop.ps1`. The database is kept in the Docker volume `muvi-rehab_muvi-data`.

**Without the scripts:** `docker compose --profile ollama up --build -d`, then `docker compose down`.

## 2b. Native Windows

1. **Install the tools:**
   - Python 3.12+;
   - Node.js 22+;
   - optional: [Ollama](https://ollama.com), then `ollama pull qwen3.5:4b`.
2. **Install the server and the web app:**

   ```powershell
   cd server; python -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements.txt; cd ..
   cd web; npm ci; cd ..
   ```

3. **Start:** `.\scripts\start.ps1 -Native`. Open `http://localhost:8080`.
4. **Stop:** `.\scripts\stop.ps1 -Native`.

## Demo data (optional)

These create two demo patients with four weeks of synthetic sessions. They are marked "Demo" and left out of research exports.

```powershell
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py          # create (prints the passwords)
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py --clear  # remove them (--reset: remove and create again)
```

With Docker: `docker compose exec server python scripts/seed_demo_data.py`.

## Backups

These save the database to `backups\`, and are safe while the app runs:

```powershell
.\scripts\backup.ps1                                    # Docker   (add -Native for native)
.\scripts\restore.ps1 -File backups\muvi-<date>.db      # Docker   (add -Native for native)
```

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Refusing to start in production" | Set a real `ADMIN_PASSWORD` (12+ characters) and `JWT_SECRET` (32+ random characters) in `server\.env` |
| The camera check says the camera is blocked | Allow the camera for `localhost:8080` (the lock icon in the address bar); close other apps using the camera |
| No "Connect" for the muscle sensor | Use Chrome or Edge, at `http://localhost`; install the board's USB driver (CP210x or CH340) |
| Reports always say they used the template | Ollama is not reachable or the model is missing: check `docker compose logs ollama-pull`, or `ollama list` on the host; for host Ollama set `OLLAMA_URL=http://host.docker.internal:11434` |
| The GPU profile fails | Docker Desktop → Settings → Resources → WSL integration; update the NVIDIA driver; or use `-Model ollama` (CPU) |
| Port 8080 is in use | Set `WEB_PORT=8081` in a `.env` file next to `docker-compose.yml`, and open `http://localhost:8081` |
| The page is blank after an update | Hard refresh (Ctrl+F5); with Docker run `.\scripts\start.ps1` again to rebuild |
| Slow or jerky tracking | Close other heavy apps, use good front light, and check the FPS on the camera check |
