# Day 1

**FPS measured: ___**

Fill this in from the corner of `/session/setup`, and note GPU or CPU.

## What was built

- **Repository:** folder structure, READMEs, Git and editor settings.
- **Backend:** FastAPI with SQLite by default and the PostgreSQL driver installed, plus settings from `server/.env` and a health check.
- **Accounts:** login with JWT, Argon2 password hashing, admin and patient roles, the admin created on startup, and a demo patient script.
- **Patient management API:** list, search, create, update, deactivate, activate and stats, plus the patient dashboard.
- **Frontend foundation:** React, TypeScript and Tailwind, UI components, four layouts, all routes, and text through `t()`.
- **Login and routing:** session restore, route guards by role and the landing page.
- **Admin area:** overview, searchable patient table, add and edit forms, and the patient detail page.
- **Patient area:** home with today's plan, progress, history, reports and profile with camera tips.
- **Camera check:** MediaPipe hand and pose tracking in the browser, the skeleton view, and a live checklist on `/session/setup`.
- **Feedback module folder:** `server/app/feedback/`, reserved for the teammate's LLM module.
- **Docs:** run instructions and [the API contract](../api-contract.md).

## End-of-day checks

| Check                                                        | Result                              |
| ------------------------------------------------------------ | ----------------------------------- |
| `pytest`                                                     | 69 passed, 1 warning                |
| `npm run lint`                                               | No problems                         |
| `npm run build`                                              | Succeeds, with a chunk size warning |
| `server/.env`, `.venv`, `node_modules`, `*.db` not tracked   | Confirmed                           |
| `server/.env.example` tracked                                | Confirmed                           |

## How to test each part

Follow the [How to run](../../README.md#how-to-run) steps first.

| Part            | Test                                                                                       | Expected result                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Backend         | Run `pytest` in `server/`                                                                  | 69 passed                                                          |
| Health          | Open <http://localhost:5173/api/health>                                                    | `"status":"ok"`                                                    |
| Landing         | Open <http://localhost:5173/>                                                              | Tagline, three feature cards and the privacy note                  |
| Login           | Try a wrong password, then the admin login from `.env`                                     | An error message, then `/admin`                                    |
| Guards          | While logged out open `/admin/patients`, log in, then as a patient open `/admin`           | Returns to the requested page; the patient is sent to `/patient`   |
| Admin overview  | Open `/admin`                                                                              | Four stat cards and recent patients                                |
| Patient list    | Open `/admin/patients` and search for `P00`                                                | The table filters shortly after you stop typing                    |
| Add patient     | Submit an empty form, then a valid one                                                     | Field errors, then a toast with the new code                       |
| Duplicate email | Add a patient with an existing email                                                       | "This email is already registered."                                |
| Patient detail  | Edit a patient, then deactivate them and try to log in as them                             | The changes show, and login is refused                             |
| Patient home    | Log in as `demo.left@example.com`                                                          | Greeting, five steps, 26 minutes in total and one Start session button |
| Patient pages   | Open progress, history, reports and profile                                                | Friendly explanations; profile shows the code, side, language and tips |
| Camera check    | Click **Start session**, then **Allow camera**                                             | A skeleton with no camera image; the checklist reacts as you move  |
| Continue        | Hold all checks green for 2 seconds, then click **Continue to warm-up**                    | The button enables, then the warm-up placeholder opens and the camera light goes off |
| Camera errors   | Block camera permission, or go offline before loading                                      | A clear message and **Try again**                                  |

## Known issues

**Could block testing**

- **Model downloads:** `storage.googleapis.com`, which hosts the MediaPipe models, timed out from the development shell while other sites responded. It still needs checking in a browser. If it is blocked there too, the camera check cannot start until the files are hosted elsewhere, which only needs a change in `web/src/vision/config.ts`.

**Not yet confirmed**

- **Camera check:** it compiles, but its results have not been recorded. The FPS line above and the light threshold (60 of 255) still need a real test.
- **Progress chart:** it has never drawn a line, because no progress data exists yet.
- **PostgreSQL:** the driver is installed, but the app has not been run against a real PostgreSQL database.

**Behaviour to improve**

- **Session flow:** **Continue to warm-up** skips calibration, but the planned flow is camera check, then calibration, then warm-up.
- **Session restore:** any failure of `/api/auth/me`, including a brief server or network outage, logs the user out.
- **Password changes:** existing tokens keep working until they expire, for up to 12 hours.
- **Form messages:** the browser's own "required" and "invalid email" messages on the login form do not go through `t()`.
- **Language:** patients can be set to Bangla, but only English text exists so far.

**Technical debt**

- **Bundle size:** the main JavaScript file is 832 kB (255 kB gzipped), because Recharts loads on the first page. It needs splitting by route before real patients use it.
- **Test coverage:** the frontend has no automated tests. Only the backend does.
- **Database changes:** there are no migrations, so startup creates missing tables but does not alter existing ones.
- **Patient list:** it has no pagination, and the dashboard's recent patients are taken from the full list.
- **Dependencies:** TypeScript is pinned to `~6.0` until `typescript-eslint` supports version 7. Pytest also warns that using `httpx` with Starlette's test client is deprecated.

## Plan for Day 2

This is a proposed plan, to be adjusted as needed.

1. Run the camera check on real hardware, record the FPS above, and resolve the model download question if it fails.
2. Build reach calibration on `/session/calibrate`, and make **Continue** on the camera check go there first.
3. Build webcam-tracked warm-up exercises on `/session/warmup`.
4. Add backend storage for sessions and calibration results, with pytest coverage. Only landmarks, metrics and events are sent to the server.
5. Split the frontend bundle by route.
