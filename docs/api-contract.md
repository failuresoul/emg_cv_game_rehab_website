# MuVi Rehab API contract

This document lists every API route the server provides today, plus the routes reserved for the LLM feedback module. The examples are real responses captured from the server, with the token shortened. The game examples show the exact shape with made-up numbers.

## Conventions

- **Base URL:** all routes start with `/api`. In development the server runs on `http://localhost:8000`, and the web app reaches it through the Vite proxy on port 5173.
- **Format:** requests and responses use JSON, except login, which uses a form.
- **Authentication:** send `Authorization: Bearer <access_token>`. Tokens expire after `JWT_EXPIRE_MINUTES` (720 by default).
- **Times:** all timestamps are UTC in ISO 8601 format, such as `2026-11-01T10:11:41.174823Z`.
- **Allowed values:**
  - `role`: `admin`, `patient`
  - `affected_side`, `dominant_side`: `left`, `right`
  - `age_band`: `18-29`, `30-39`, `40-49`, `50-59`, `60-69`, `70+`
  - `language`: `en`, `bn`
  - `game_id`: `reach_activate`, `balloon_pop`, `fruit_catch`, `bloom`, `finger_piano`, `path_trace`, `paint_wall`, `pick_place`, `grip_hold`
  - `engine`: `L0` (fixed settings), `L1`, `L2` (adaptive, from Day 12)
  - `input_source`: `cv_grip` (the webcam: closing and opening the hand, and finger touches), `keyboard` (testing only), `emg` (from Day 15)
  - Trial `outcome`: `success`, `reach_fail`, `activation_fail`, `miss` (a target that left by itself, such as a balloon floating away or a fruit landing), `aborted`
- **Units:** positions are in the body frame, in shoulder widths (SW), with the affected shoulder at the origin, +x away from the body's midline and +y up. Trial times are milliseconds relative to the trial's spawn.
- **Privacy:** password hashes are never returned. Webcam video and images are never sent to the server.

## Routes

| Method | Path                                 | Role      | Purpose                         |
| ------ | ------------------------------------ | --------- | ------------------------------- |
| GET    | `/api/health`                        | Public    | Check that the server is up     |
| POST   | `/api/auth/login`                    | Public    | Log in                          |
| POST   | `/api/auth/register`                 | Public    | Create a patient account        |
| GET    | `/api/auth/me`                       | Any user  | Get the logged-in user          |
| GET    | `/api/admin/patients`                | `admin`   | List or search patients         |
| POST   | `/api/admin/patients`                | `admin`   | Create a patient                |
| GET    | `/api/admin/patients/{id}`           | `admin`   | Get one patient                 |
| PATCH  | `/api/admin/patients/{id}`           | `admin`   | Update a patient                |
| POST   | `/api/admin/patients/{id}/deactivate` | `admin`  | Block a patient from logging in |
| POST   | `/api/admin/patients/{id}/activate`  | `admin`   | Allow a patient to log in again |
| GET    | `/api/admin/stats`                   | `admin`   | Get dashboard counts            |
| GET    | `/api/admin/patients/{id}/sessions`  | `admin`   | List a patient's sessions       |
| GET    | `/api/admin/patients/{id}/calibrations` | `admin` | List a patient's calibrations  |
| GET    | `/api/admin/patients/{id}/warmup`    | `admin`   | A patient's warm-up history per exercise |
| GET    | `/api/patient/dashboard`             | `patient` | Get the patient's home page data |
| GET    | `/api/patient/calibration/latest`    | `patient` | Get own latest calibration      |
| GET    | `/api/patient/sessions`              | `patient` | List own sessions               |
| GET    | `/api/patient/sessions/{id}`         | `patient` | Get own session with its calibration |
| GET    | `/api/patient/warmup/history`        | `patient` | Own latest results for one exercise |
| POST   | `/api/sessions`                      | `patient` | Start or resume a session       |
| GET    | `/api/sessions/current`              | `patient` | Get own active session          |
| PATCH  | `/api/sessions/{id}/device-info`     | `patient` | Save browser, FPS and GPU/CPU   |
| PATCH  | `/api/sessions/{id}/progress`        | `patient` | Save the current step and game queue |
| POST   | `/api/sessions/{id}/end`             | `patient` | End own session                 |
| POST   | `/api/sessions/{id}/calibration`     | `patient` | Save a calibration              |
| POST   | `/api/sessions/{id}/warmup`          | `patient` | Save or replace warm-up results |
| GET    | `/api/sessions/{id}/warmup`          | `patient` | Get a session's warm-up results |
| POST   | `/api/sessions/{id}/games`           | `patient` | Start a game run                |
| GET    | `/api/sessions/{id}/games`           | `patient` | List a session's game runs      |
| POST   | `/api/games/{run_id}/trials`         | `patient` | Save up to 50 trials            |
| POST   | `/api/games/{run_id}/end`            | `patient` | End a game run with its score   |
| GET    | `/api/admin/sessions`                | `admin`   | Recent sessions of every patient |
| GET    | `/api/admin/sessions/{id}`           | `admin`   | One session with every trial    |
| POST   | `/api/sessions/{id}/questionnaire`   | `patient` | Save the cool-down questionnaire |
| GET    | `/api/sessions/{id}/questionnaire`   | `patient` | Get the cool-down questionnaire |
| GET    | `/api/admin/alerts`                  | `admin`   | Sessions with safety flags      |
| POST   | `/api/admin/alerts/{session_id}/review` | `admin` | Mark an alert as reviewed      |
| GET    | `/api/patient/progress`              | `patient` | Streak, week, calendar and trends |
| GET    | `/api/admin/patients/{id}/progress`  | `admin`   | A patient's progress, as above  |
| GET    | `/api/sessions/{id}/summary`         | `patient` | End-of-session summary with comparisons |
| GET    | `/api/admin/games`                   | `admin`   | Every game's spec and the admin's setting |
| PUT    | `/api/admin/games/{game_id}`         | `admin`   | Save a game's setting           |
| POST   | `/api/admin/games/{game_id}/reset`   | `admin`   | Put a game back to its own defaults |
| GET    | `/api/games/settings`                | `patient` | The games to offer, with their defaults and trials |
| GET    | `/api/patient/progress/metrics`      | `patient` | Own catalogue measures over the sessions |
| GET    | `/api/admin/patients/{id}/metrics`   | `admin`   | Each measure against the baseline, with series |
| GET    | `/api/sessions/{id}/facts`           | owner or `admin` | The session's facts for the feedback module |
| GET    | `/api/sessions/{id}/plan`            | owner or `admin` | Today's games in order, with reasons |
| POST   | `/api/sessions/{id}/plan/override`   | `patient` | Record the patient's changes to the plan |
| POST   | `/api/admin/metrics/recompute`       | `admin`   | Recompute server trial and session measures |
| GET    | `/api/admin/patients/{id}/export.csv` | `admin`  | One patient's session measures as CSV |
| GET    | `/api/admin/export/trials.csv`       | `admin`   | Every trial as CSV, by patient code |
| POST   | `/api/engine/next`                   | `patient` | The next trial's settings from the adaptive engine |
| GET    | `/api/admin/patients/{id}/levels`    | `admin`   | A patient's engine mode and level per game |
| GET    | `/api/admin/patients/{id}/plan`      | `admin`   | The patient's latest plan, with reasons and their changes |

## Errors

Errors other than 422 have a `detail` string:

| Status | Meaning                                                          | Example `detail`                  |
| ------ | ---------------------------------------------------------------- | --------------------------------- |
| 401    | Missing, invalid or expired token, or a deactivated user         | `Not authenticated`               |
| 401    | Failed login, including a deactivated user                       | `Incorrect email or password`     |
| 403    | Logged in with the wrong role                                    | `Admin access required`           |
| 404    | No such patient                                                  | `Patient not found`               |
| 409    | Email already in use                                             | `Email already registered`        |
| 422    | Invalid input                                                    | See below                         |

A 422 response usually lists each problem, and `loc` names the field. The submitted value is never repeated back:

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "password"],
      "msg": "String should have at least 8 characters"
    }
  ]
}
```

## Health

### GET /api/health

**Role:** public

Response `200`:

```json
{ "status": "ok", "app": "MuVi Rehab", "version": "0.1.0" }
```

## Authentication

### POST /api/auth/login

**Role:** public

The request is a form (`application/x-www-form-urlencoded`), and `username` holds the email:

```
username=admin@motionlab.local&password=example-admin-password
```

Response `200`:

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "admin@motionlab.local",
    "full_name": "MuVi Rehab Admin",
    "role": "admin",
    "is_active": true,
    "created_at": "2026-11-01T10:11:40.983764Z",
    "last_login_at": "2026-11-01T10:11:41.046256Z"
  }
}
```

The token's payload holds `sub` (the user id, as a string), `role` and `exp`. It is signed with HS256.

Errors: `401`, `422`.

### POST /api/auth/register

**Role:** public

Creates a patient account and logs the patient in. The role is always `patient`.

Request:

```json
{
  "email": "amina@example.com",
  "full_name": "Amina Rahman",
  "password": "example-password",
  "affected_side": "left",
  "dominant_side": "right",
  "age_band": "60-69",
  "months_since_stroke": 6,
  "language": "en"
}
```

`months_since_stroke` and `language` (default `en`) are optional. Unknown fields, including `role` and `notes`, are rejected with `422`. The email and password rules are the same as for `POST /api/admin/patients`.

Response `201`: the same shape as login.

Errors: `409`, `422`.

### GET /api/auth/me

**Role:** any logged-in user

`patient_profile` is `null` for an admin. Response `200` for a patient:

```json
{
  "id": 2,
  "email": "amina@example.com",
  "full_name": "Amina Rahman",
  "role": "patient",
  "is_active": true,
  "created_at": "2026-11-01T10:11:41.170656Z",
  "last_login_at": "2026-11-01T10:11:41.301545Z",
  "patient_profile": {
    "id": 1,
    "user_id": 2,
    "patient_code": "P001",
    "affected_side": "left",
    "dominant_side": "right",
    "age_band": "60-69",
    "months_since_stroke": 7,
    "language": "en",
    "notes": null,
    "created_at": "2026-11-01T10:11:41.174823Z"
  }
}
```

Errors: `401`.

## Admin

All admin routes return `401` without a valid token and `403` for a patient. In these routes, `{id}` is the patient profile's `id`, not the `user_id`.

### The patient object

Admin patient routes return this object:

```json
{
  "id": 1,
  "user_id": 2,
  "patient_code": "P001",
  "affected_side": "left",
  "dominant_side": "right",
  "age_band": "60-69",
  "months_since_stroke": 6,
  "language": "en",
  "notes": "Prefers morning sessions",
  "weekly_goal": 5,
  "is_demo": false,
  "created_at": "2026-11-01T10:11:41.174823Z",
  "user": {
    "email": "amina@example.com",
    "full_name": "Amina Rahman",
    "is_active": true,
    "last_login_at": null
  }
}
```

### GET /api/admin/patients

Optional query parameter: `search` matches part of the name, email or patient code, ignoring case. For example: `/api/admin/patients?search=amina`.

Response `200`: an array of patient objects, oldest first. It is empty if nothing matches.

### POST /api/admin/patients

Creates the user and profile in one transaction. The server generates `patient_code` (`P001`, `P002`, and so on).

Request:

```json
{
  "email": "amina@example.com",
  "full_name": "Amina Rahman",
  "password": "example-password",
  "affected_side": "left",
  "dominant_side": "right",
  "age_band": "60-69",
  "months_since_stroke": 6,
  "language": "en",
  "notes": "Prefers morning sessions"
}
```

- `months_since_stroke`, `language` (default `en`) and `notes` are optional.
- `password` must be 8 to 128 characters.
- `email` is stored in lowercase. Reserved domains such as `.local` are rejected with `422`.
- Unknown fields are rejected with `422`.

Response `201`: the patient object.

Errors: `409`, `422`.

### GET /api/admin/patients/{id}

Response `200`: the patient object.

Errors: `404`, `422` if `id` is not a number.

### PATCH /api/admin/patients/{id}

Send only the fields to change. Accepts the same fields as create. Only `months_since_stroke` and `notes` can be set to `null`.

Request:

```json
{ "months_since_stroke": 7, "notes": null }
```

Response `200`: the updated patient object.

Errors: `404`, `409`, `422`.

### POST /api/admin/patients/{id}/deactivate

No request body. The patient can no longer log in, and their existing tokens stop working immediately.

Response `200`: the patient object with `user.is_active` set to `false`.

Errors: `404`.

### POST /api/admin/patients/{id}/activate

No request body.

Response `200`: the patient object with `user.is_active` set to `true`.

Errors: `404`.

### GET /api/admin/stats

Response `200`:

```json
{
  "total_patients": 1,
  "active_patients": 1,
  "sessions_today": 0,
  "open_alerts": 0
}
```

`sessions_today` counts sessions started since midnight UTC. `open_alerts` counts sessions with `needs_review` set that nobody has reviewed yet (see [Cool-down questionnaire and safety alerts](#cool-down-questionnaire-and-safety-alerts)).

### GET /api/admin/patients/{id}/sessions

Response `200`: an array of session summaries, newest first. See `GET /api/patient/sessions` for the shape.

Errors: `404`.

### GET /api/admin/patients/{id}/calibrations

Response `200`, newest first:

```json
[
  {
    "id": 1,
    "session_id": 1,
    "created_at": "2026-11-02T09:03:00Z",
    "reach_radii_sw": [1.0, 1.1, 1.2, 1.3, 1.4, 1.3, 1.2, 1.1],
    "hull_sw": [[1.0, 0.0], [0.0, 1.2], [-1.4, 0.0], [0.0, -1.2]],
    "hull_area_sw2": 2.88
  }
]
```

Errors: `404`.

## Patient

Returns `401` without a valid token and `403` for an admin.

### GET /api/patient/dashboard

Response `200`:

```json
{
  "profile": {
    "id": 1,
    "user_id": 2,
    "patient_code": "P001",
    "affected_side": "left",
    "dominant_side": "right",
    "age_band": "60-69",
    "months_since_stroke": 7,
    "language": "en",
    "notes": null,
    "created_at": "2026-11-01T10:11:41.174823Z"
  },
  "today_plan": [
    { "step": "camera_check", "minutes": 1 },
    { "step": "calibration", "minutes": 2 },
    { "step": "warmup", "minutes": 10 },
    { "step": "games", "minutes": 15 },
    { "step": "feedback", "minutes": 2 }
  ],
  "last_session": {
    "date": "2026-11-02T09:00:00Z",
    "status": "completed",
    "duration_seconds": 1560.0,
    "warmup_summary": {
      "exercises_done": 5,
      "exercises_total": 6,
      "total_reps": 46,
      "goals_reached": 4,
      "mean_compensation_rate": 0.12
    }
  },
  "latest_calibration": {
    "hull_sw": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
    "hull_area_sw2": 0.5
  },
  "last_warmup": {
    "session_id": 1,
    "date": "2026-11-02T09:00:00Z",
    "exercises_done": 5,
    "exercises_total": 6,
    "total_reps": 46,
    "goals_reached": 4,
    "mean_compensation_rate": 0.12
  },
  "streak_days": 0
}
```

`last_session.games` lists the session's finished game runs (completed or aborted) in the order they were played, as `{ "game_id": "reach_activate", "score": 1525.0, "success_rate": 0.75 }`. `success_rate` is `null` for a run ended without a summary, and runs still in progress are left out.

`last_session` and `latest_calibration` are `null` until they exist. `last_session.warmup_summary` is `null` if that session has no warm-up results. `last_warmup` is the most recent session that has any warm-up results, so it can be an earlier session than `last_session`; it is `null` until the first warm-up is saved. See [Warm-up summaries](#warm-up-summaries). `duration_seconds` is `null` for a session with no `ended_at`. `today_plan` is a fixed list and `streak_days` is always `0` for now.

### GET /api/patient/calibration/latest

Response `200`: the calibration object below.

Errors: `404` if the patient has no calibration yet.

### GET /api/patient/sessions

Response `200`: an array of session summaries, newest first. The admin session list returns the same shape.

```json
[
  {
    "id": 1,
    "patient_id": 1,
    "started_at": "2026-11-02T09:00:00Z",
    "ended_at": "2026-11-02T09:26:00Z",
    "status": "completed",
    "device_info": { "browser": "Chrome", "fps": 30.0, "delegate": "GPU" },
    "notes": null,
    "duration_seconds": 1560.0,
    "hull_area_sw2": 0.5,
    "warmup_summary": null,
    "games": [{ "game_id": "reach_activate", "score": 1525.0, "success_rate": 0.75 }]
  }
]
```

`warmup_summary` is a [warm-up summary](#warm-up-summaries), or `null` for a session without warm-up results. `games` lists finished game runs as in the dashboard's `last_session.games`, and is empty when none were played.

### GET /api/patient/sessions/{id}

Response `200`: a session summary, plus `calibration`, which is the calibration object or `null`. Another patient's session returns `404`.

Errors: `404`.

### GET /api/patient/warmup/history

Query: `exercise_id` (required, one of the [exercise ids](#warm-up-results)) and `limit` (1–50, default 5).

Response `200`: the patient's own warm-up results for that exercise, newest first, without skipped ones. The web app uses them to personalise today's targets.

Errors: `422` for a missing or unknown `exercise_id`, or a `limit` out of range.

## Sessions

These routes are for patients and act only on the patient's own sessions. They return `401` without a valid token and `403` for an admin. Another patient's session returns `404`, the same as one that does not exist.

`status` is one of `active`, `completed` or `aborted`.

### POST /api/sessions

The body is optional:

```json
{
  "device_info": { "browser": "Chrome", "fps": 30.0, "delegate": "GPU" },
  "notes": null
}
```

- If the patient has an active session started less than 2 hours ago, it is returned with status `200`, and the body is ignored.
- Otherwise a new session is created and returned with status `201`.
- Active sessions 2 hours old or more are marked `aborted`, and their `ended_at` stays `null` because the real end time is unknown.

The response has the same fields as a session summary, without `duration_seconds` and `hull_area_sw2`.

Errors: `422`.

### GET /api/sessions/current

Response `200`: the active session. Expired sessions are marked `aborted`, as above.

Errors: `404` if there is no active session.

### PATCH /api/sessions/{id}/device-info

Replaces the session's device info. FPS and GPU/CPU are only known once the camera has been running.

Request:

```json
{ "browser": "Chrome 140", "fps": 30.0, "delegate": "GPU" }
```

Response `200`: the session.

Errors: `404`, `422`.

### PATCH /api/sessions/{id}/progress

Saves where the patient is, so a refresh or a later return resumes at the same step. Every session object also has these two fields.

```json
{
  "current_step": "game",
  "game_queue": { "games": ["reach_activate", "balloon_pop"], "index": 1 }
}
```

- `current_step`: `setup`, `calibrate`, `warmup`, `plan`, `game`, `cooldown` or `summary`. New sessions start at `setup`.
- `game_queue`: today's games in order (1 to 20 known game ids) and `index`, the game being played. `index` equals the number of games once all are done. `null` until the plan is set.
- Send either field or both; at least one is required. A field left out keeps its value.

Response `200`: the session. Errors: `404` for a missing or another patient's session, `409` for an ended session, `422` for an unknown step or game, an index past the end, or an empty body.

### POST /api/sessions/{id}/end

Request:

```json
{ "status": "completed" }
```

`status` must be `completed` or `aborted`. Response `200`: the session, with `ended_at` set. Any game run still active in the session is marked `aborted`, without an `ended_at`. An active session older than two hours is aborted the same way the next time the patient starts or resumes one.

Errors: `404`, `409` if the session has already ended, `422`.

### POST /api/sessions/{id}/calibration

Positions use the body frame: the origin is the affected shoulder, the unit is shoulder width (SW), +x points away from the body midline on the affected side, and +y points up.

Request:

```json
{
  "affected_side": "left",
  "shoulder_width_px": 180.5,
  "directions_deg": [0, 45, 90, 135, 180, 225, 270, 315],
  "reach_radii_sw": [1.0, 1.1, 1.2, 1.3, 1.4, 1.3, 1.2, 1.1],
  "reach_points_sw": [[1.0, 0.0], [0.78, 0.78], [0.0, 1.2], [-0.92, 0.92], [-1.4, 0.0], [-0.92, -0.92], [0.0, -1.2], [0.78, -0.78]],
  "hull_sw": [[1.0, 0.0], [0.0, 1.2], [-1.4, 0.0], [0.0, -1.2]],
  "hull_area_sw2": 2.88,
  "quality": {
    "valid": [true, true, true, true, true, true, true, true],
    "retries": 1,
    "max_trunk_displacement_sw": 0.05
  }
}
```

- `affected_side` must match the patient's profile. If it does not, the 422 `detail` is a plain string.
- `directions_deg` must be exactly the eight angles shown.
- `reach_radii_sw`, `reach_points_sw` and `quality.valid` must each have exactly 8 items.
- Each radius must be between 0.2 and 3.0 SW.
- `hull_sw` must have at least 3 points.
- `shoulder_width_px` and `hull_area_sw2` must be greater than 0.

Response `201`: the same fields, plus `id`, `session_id` and `created_at`.

Errors: `404`, `409` if the session already has a calibration or has ended, `422`.

## Warm-up results

### POST /api/sessions/{id}/warmup

The body is a list of 1–20 results, one per exercise. Saving an exercise again in the same session replaces its earlier result, so the web app can save after each exercise and again at the end.

```json
[
  {
    "exercise_id": "shoulder_flexion",
    "preset": "personal",
    "thresholds": { "low": 30, "high": 95, "unit": "deg" },
    "personalisation": {
      "previous_high": 90,
      "new_high": 95,
      "reason": "raised: 10/10 reps, 10% compensated"
    },
    "full_reps": 9,
    "partial_reps": 1,
    "target_reps": 10,
    "best_peak": 101.5,
    "mean_duration_ms": 2400.0,
    "active_time_ms": 41000.0,
    "paused_time_ms": 1500.0,
    "measure_source": "3d",
    "trunk_reference": "hip",
    "compensated_reps": 1,
    "compensation_rate": 0.1,
    "reps": [
      {
        "index": 1,
        "peak": 98.0,
        "duration_ms": 2300.0,
        "compensated": true,
        "compensation_type": "trunk+shoulder"
      }
    ],
    "skipped": false
  }
]
```

- **`exercise_id`:** `shoulder_flexion`, `shoulder_abduction`, `elbow_flexion`, `forward_reach`, `hand_open_close` or `thumb_opposition`. Each may appear only once in a body.
- **`preset`:** `standard`, `gentle` or `personal`.
- **`thresholds.unit`:** `deg` for angles, `arm_ratio` for forward reach (a share of arm length) and `palm_ratio` for hand measures (palm lengths). `low` must be below `high`.
- **The target line:** exercises that rise to a target (shoulder raises, reach, hand opening) use `high`. Elbow flexion and thumb opposition fall to a target and use `low`. `personalisation.previous_high` and `new_high` hold that target line, whichever it is; `previous_high` is `null` the first time.
- **Peaks are unfiltered values,** in the exercise's unit. For thumb opposition a peak is the loosest of a sequence's four touches, so smaller is better.
- **`trunk_reference`:** `hip`, `vertical` or `n/a` (hand exercises); it and `measure_source` (`3d`, `2d`) may be `null` when nothing was measured.
- **`best_peak` and `mean_duration_ms`** may be `null`, for example for a skipped exercise.
- **Counts and times** must not be negative, `target_reps` is at least 1, `compensation_rate` is from 0 to 1, and `compensated_reps` cannot exceed `full_reps + partial_reps`.
- **`compensation_type`** joins the kinds seen in a rep with `+`: `trunk`, `lean` and `shoulder`.
- **NaN and infinite numbers,** and unknown fields, are rejected.

Response `200`: every warm-up result of the session, in the order they were first saved, each with `id`, `session_id` and `created_at` added.

Errors: `404` (not the patient's session), `409` (the session has ended, or the same exercise was saved by two requests at once), `422`.

### GET /api/sessions/{id}/warmup

Response `200`: the session's warm-up results, as above; an empty list if there are none.

Errors: `404`.

### Warm-up summaries

Session summaries, the dashboard and the admin history share these figures. Skipped exercises count only towards `exercises_total`.

| Field | Meaning |
| --- | --- |
| `exercises_done` | Exercises not skipped |
| `exercises_total` | Every exercise with a result |
| `total_reps` | Full reps of the exercises done |
| `goals_reached` | Exercises with at least 90% of their target reps done in full (9 of 10, 5 of 5) |
| `mean_compensation_rate` | The mean of the done exercises' rates, or `null` if none were done |

### GET /api/admin/patients/{id}/warmup

Query: `exercise_id` (optional) to return one exercise only.

Response `200`: one entry per exercise, each with its points oldest first, for charting. Skipped results are left out.

```json
[
  {
    "exercise_id": "shoulder_flexion",
    "points": [
      {
        "session_id": 1,
        "date": "2026-11-02T09:05:00Z",
        "preset": "personal",
        "best_peak": 101.5,
        "target_high": 95.0,
        "thresholds": { "low": 30.0, "high": 95.0, "unit": "deg" },
        "full_reps": 9,
        "target_reps": 10,
        "goal_reached": true,
        "compensation_rate": 0.1,
        "personalisation": {
          "previous_high": 90.0,
          "new_high": 95.0,
          "reason": "raised: 10/10 reps, 10% compensated"
        }
      }
    ]
  }
]
```

`target_high` is always `thresholds.high`. For elbow flexion and thumb opposition the target is `thresholds.low`; see the target line above.

Errors: `404` (no such patient), `422` (unknown `exercise_id`).

## Games

A **game run** is one play of one game inside a session; a **trial** is one target or task within it. The web app starts a run when the countdown ends, uploads trials every 10 and at the end, and then ends the run. Only one run is played at a time: starting a run marks any run still active in the same session as `aborted`.

### POST /api/sessions/{id}/games

Request:

```json
{
  "game_id": "reach_activate",
  "engine": "L0",
  "input_source": "cv_grip",
  "params_initial": { "distance_frac": 0.7, "target_radius_sw": 0.45, "seed": 1234567 },
  "trials_planned": 20
}
```

`engine` defaults to `L0`. `params_initial` is the first trial's settings (names and numbers only); the web app adds the random `seed`, so the order of directions can be repeated. `trials_planned` is 1–500.

Response `201`: the game run.

```json
{
  "id": 3,
  "session_id": 1,
  "game_id": "reach_activate",
  "engine": "L0",
  "input_source": "cv_grip",
  "params_initial": { "distance_frac": 0.7, "target_radius_sw": 0.45, "seed": 1234567 },
  "started_at": "2026-11-09T10:05:00Z",
  "ended_at": null,
  "status": "active",
  "trials_planned": 20,
  "trials_done": 0,
  "score": null,
  "summary": null
}
```

Errors: `404` (no such session, or another patient's), `409` if the session has already ended, `422` (for example an unknown `game_id`).

### GET /api/sessions/{id}/games

Response `200`: the session's game runs in the order they were started, each as above, without trials.

Errors: `404`.

### POST /api/games/{run_id}/trials

Request: an array of 1 to 50 trials. A trial whose `trial_no` was already saved in this run is replaced, so sending a trial again after a failed upload is safe.

```json
[
  {
    "trial_no": 1,
    "params": { "distance_frac": 0.7, "direction_deg": 45, "direction_index": 1, "target_radius_sw": 0.45, "dwell_ms": 500, "activation_demand": 0.5 },
    "target": { "x_sw": 0.69, "y_sw": 0.65, "radius_sw": 0.45, "direction_deg": 45, "distance_frac": 0.7, "sector": "D1R2" },
    "outcome": "success",
    "timings": { "spawn": 0, "move_onset": 320, "enter": 1480, "dwell_done": 1980, "activation_start": 2210, "activation_done": 2410, "end": 2410 },
    "metrics": {
      "reaction_ms": 320,
      "movement_ms": 1160,
      "path_length_sw": 1.02,
      "straight_dist_sw": 0.91,
      "path_efficiency": 0.892,
      "peak_speed_sw_s": 1.31,
      "activation_latency_ms": 230,
      "activation_peak": 0.86
    },
    "compensation": {
      "flagged": true,
      "type": "lean",
      "max_values": { "trunk_displacement_sw": 0.08, "trunk_lean_deg": 11.4, "shoulder_hike_sw": 0.02 }
    },
    "trajectory": [[0, 0.12, -0.35], [33.3, 0.13, -0.34], [66.7, 0.16, -0.3]]
  }
]
```

| Field | Rules |
| --- | --- |
| `trial_no` | 1–500, unique within the request |
| `params` | That trial's settings, names and numbers only |
| `target` | Optional. Either **placed** (reaching games): every one of `x_sw`, `y_sw`, `radius_sw` (above 0), `direction_deg` (0 up to 360), `distance_frac` (0–2) and `sector` (like `D3R2`: the direction index, 0 outward then 45° steps anticlockwise to 7, and the ring, R1 below 0.55 of the reach, R2 to 0.85, R3 beyond). Or **unplaced** (hand games): a `kind` (lower-case letters, digits and `_`, up to 30) and none of the placed fields, such as `{"kind": "bloom"}`. Either may add `kind`; `notes` (1–64 strings of 1–20 characters); `shape` (as `kind`); `points` (2–200 `[x_sw, y_sw]` pairs, such as a path to follow); `index` (a whole number 0–500, such as a stripe's place on the wall); `target_frac` (0–1); `pick` and `place` (`[x_sw, y_sw]` pairs, such as where an object starts and where its box is); `object_radius_sw` and `box_size_sw` (above 0, at most 5); and `center` and `width` (0–1, such as a band of grip levels). Some but not all placed fields, or neither a place nor a `kind`, is `422`. Fields left out are not saved and not returned |
| `timings` | Milliseconds from spawn, each 0 or more, or `null` if never reached. `activation_start` is when the successful squeeze began |
| `metrics` | Each 0 or more, or `null`; `path_efficiency` and `activation_peak` are 0–1. Reach measures use the raw fingertip from move onset to entering the target; move onset is the first point faster than 0.15 SW/s. Some games add optional metrics, listed below |
| `compensation.max_values` | Up to 20 named numbers |
| `trajectory` | Up to 2000 points of `[t_ms, x_sw, y_sw]`: the raw (unsmoothed) fingertip at about 30 Hz |

Optional metrics for particular games (leave them out, or send `null`):

| Metric | Game | Rules |
| --- | --- | --- |
| `peak_arm_elevation_deg` | `balloon_pop` | 0–180: the highest the affected arm was raised during the trial (0 is down), unfiltered |
| `lateral_distance_sw` | `fruit_catch` | 0 or more: from the basket's x at spawn to the fruit's x |
| `lateral_path_efficiency` | `fruit_catch` | 0–1: straight sideways distance over sideways path length |
| `overshoot_sw` | `fruit_catch` | 0 or more: how far the basket went past the fruit before it arrived |
| `side` | `fruit_catch` | `out` (away from the body) or `across` |
| `time_to_open_ms` | `bloom` | 0 or more: spawn to the start of the hold that made the flower bloom |
| `peak_openness` | `bloom` | 0–1: the highest openness while opening (0 a fist, 1 the patient's own open hand) |
| `hold_stability` | `bloom` | 0–1: standard deviation of openness during the successful hold; lower is steadier |
| `time_to_close_ms` | `bloom` | 0 or more: closing phase start to the start of the grip hold that collected the seed |
| `peak_grip` | `bloom` | 0–1: the highest grip in the closing phase |
| `openness_rise_rate` | `bloom` | 0 or more: openness per second from the last low point to the start of the successful hold (or to the highest openness, for a bud that never bloomed) |
| `failed_phase` | `bloom`, `grip_hold` | `open` or `close` (Bloom), `hold` or `relax` (Grip and hold): which phase ran out of time; `null` for a success |
| `notes_total`, `hits`, `wrong_finger`, `missed` | `finger_piano` | Whole numbers 0–64. Each note ends as one of a hit, a wrong finger (only wrong fingers touched in its window) or missed (no touch), so `hits + wrong_finger + missed` must equal `notes_total` |
| `hit_rate` | `finger_piano` | 0–1: `hits / notes_total` |
| `mean_timing_error_ms` | `finger_piano` | 0 or more: the mean of \|touch − arrival\| over the hits |
| `per_finger` | `finger_piano` | For each finger used (`index`, `middle`, `ring`, `little`): `{ "hits": n, "attempts": n }`, attempts being the notes that asked for it; `hits` may not exceed `attempts` |
| `mean_tracking_error_sw` | `path_trace` | 0 or more: mean distance from the moving guide |
| `mean_path_error_sw` | `path_trace` | 0 or more: mean distance from the path |
| `time_in_corridor_pct` | `path_trace` | 0–100: share of the trace within half the corridor's width of the path |
| `lag_ms` | `path_trace` | Any number: mean delay behind the guide (from the closest point on the path); negative when ahead |
| `coverage_pct` | `path_trace` | 0–100: share of the path's stretches reached inside the corridor |
| `sparc` | `path_trace` | 0 or less: SPARC of the raw fingertip's speed during the trace; closer to 0 is smoother |
| `achieved_range_deg` | `paint_wall` | 0–180: most straight minus most bent elbow angle in the stripe |
| `max_bend_deg`, `max_straight_deg` | `paint_wall` | 0–180: the smallest and the largest elbow angle reached |
| `full_sweeps`, `partial_sweeps` | `paint_wall` | Whole numbers 0–1000: sweeps that reached the target height, and those that did not |
| `mean_sweep_ms` | `paint_wall` | 0 or more: mean duration of the full sweeps |
| `angular_sparc` | `paint_wall` | 0 or less: SPARC of the raw elbow angle's speed over the stripe |
| `upper_arm_motion_deg` | `paint_wall` | 0–180: the most the upper arm moved from its start during a sweep |
| `reach_ms` | `pick_place` | 0 or more: spawn to the pinch point first reaching the object |
| `grasp_latency_ms` | `pick_place` | 0 or more: object first reached to the first grasp (a pinch started on it) |
| `transport_ms` | `pick_place` | 0 or more: the last grasp to the release in the box; `null` for a miss |
| `transport_path_efficiency` | `pick_place` | 0–1: straight distance over path length of the carry that succeeded |
| `drops` | `pick_place` | Whole number 0–1000: times the object was let go outside the box (each goes back to its start) |
| `release_error_sw` | `pick_place` | 0 or more: distance of the RAW pinch point from the box's centre at the release |
| `time_to_band_ms` | `grip_hold` | 0 or more: spawn to the grip level first entering the band |
| `time_in_band_pct` | `grip_hold` | 0–100: share of the holding phase inside the band |
| `longest_continuous_hold_ms` | `grip_hold` | 0 or more: the longest stretch inside the band without leaving it |
| `overshoot_count`, `max_overshoot` | `grip_hold` | Whole number 0–1000, and 0–1: times the level went above the band, and the most it went above |
| `steadiness` | `grip_hold` | 0–1: standard deviation of the level while inside the band (smaller is steadier) |
| `relaxation_ms` | `grip_hold` | 0 or more: the relax prompt to the level first falling below the relax level; `null` if it never did |
| `input_source` | `grip_hold` | `cv_grip`, `keyboard` or `emg`: where the level came from in this trial |

How each game fills the shared fields:

- **`balloon_pop`:** `target` is where the balloon waited (`distance_frac` is its height as a share of the reach in that direction); `enter` is the first touch; `movement_ms` runs from move onset to the touch; `activation_*` are set only when a squeeze is needed (`params.squeeze_to_pop` is 1); `dwell_done` is `null`. Outcomes are `success` (popped) or `miss`.
- **`fruit_catch`:** `target.x_sw` is where the fruit fell, `y_sw` is the basket line (-0.3), `direction_deg` is 0 (out) or 180 (across) and `sector` is `D0Rn` or `D4Rn`; `enter` is when the basket was first under the fruit; reach measures are sideways only, using the basket's x (the raw fingertip's x kept within the reach). Outcomes are `success` (caught) or `miss`.
- **`bloom`** (one trial is one flower): `target` is `{"kind": "bloom"}` and `trajectory` is empty, since the hand only has to be visible. `activation_start` and `activation_done` are the grip hold that collected the seed, and `activation_latency_ms` and `activation_peak` repeat `time_to_close_ms` and `peak_grip`. The reach measures are `null`. Outcomes are `success` (both phases done) or `miss` (a phase ran out of time; see `failed_phase`).
- **`finger_piano`** (one trial is one melody): `target` is `{"kind": "sequence", "notes": ["index", "ring", …]}` and `trajectory` is empty. `params` carries the melody as `note_1` … `note_n` (0 index to 3 little) beside the settings. Only `spawn` and `end` timings are set. Outcomes are `success` (at least 75% of the notes hit) or `miss`.
- **`path_trace`** (one trial is one trace): `target` is `{"kind": "path", "shape": "line" | "arc" | "s_curve" | "circle_part", "points": [[x, y], …]}` (at most 200 points, in SW). `enter` is when the fingertip first entered the start circle and `dwell_done` when its 500 ms hold was done and the guide set off; `movement_ms` is `null` (the guide sets the pace). `trajectory` is the raw fingertip. Outcomes are `success` (at least 70% of the trace in the corridor), `miss`, or `reach_fail` when the start circle was not held within 15 s (then the tracing metrics are `null`).
- **`paint_wall`** (one trial is one stripe): `target` is `{"kind": "stripe", "index": n, "target_frac": share}`, `index` being the stripe's place on the wall from 0 and `target_frac` the share of the patient's elbow range it asked for; `params` carries that range as `elbow_bent_deg` and `elbow_straight_deg`. Only `spawn` and `end` timings are set. Outcomes are `success` (the sweeps needed) or `miss` (the time limit, the paint kept). Moving the upper arm more than 20° during a sweep adds `upper_arm` to `compensation.type`, with `upper_arm_motion_deg` in `max_values`.
- **`pick_place`** (one trial is one object): `target` is `{"kind": "pick_place", "pick": [x, y], "place": [x, y], "object_radius_sw": r, "box_size_sw": s}`, in SW. `enter` is when the pinch point first reached the object and `dwell_done` the first grasp. `trajectory` is the RAW pinch point (midway between thumb and index tips). Outcomes are `success` (let go inside the box) or `miss` (the time limit). The carry measures (`transport_ms`, `transport_path_efficiency`, `release_error_sw`, `sparc`, `peak_speed_sw_s`) are those of the carry that succeeded, and `null` for a miss.
- **`grip_hold`** (one trial is one hold): `target` is `{"kind": "grip_band", "center": c, "width": w}`, the band of grip levels to hold. `activation_start` is when the level first entered the band and `activation_done` when the hold time was reached; `trajectory` is empty. Outcomes are `success` (the hold and then relaxing) or `miss`, with `failed_phase` `hold` or `relax`.

Response `200`: the game run, with `trials_done` counting every trial saved.

Errors: `404` (no such run, or another patient's), `409` if the run is no longer active, `422` (more than 50 trials, a repeated `trial_no`, more than 2000 trajectory points, `NaN`, or another invalid field).

### POST /api/games/{run_id}/end

Request:

```json
{
  "status": "completed",
  "score": 1525,
  "summary": {
    "successes": 15,
    "success_rate": 0.75,
    "mean_movement_ms": 1240.5,
    "mean_path_efficiency": 0.86,
    "compensated_trials": 3,
    "details": { "highest_popped_frac": 0.85 }
  }
}
```

`status` is `completed` or `aborted`, `score` is 0 or more, and `summary` is optional. In the summary, the means are over successful trials only and may be `null`; `compensated_trials` counts every trial with compensation flagged. `details` (optional, empty by default) holds up to 20 figures only one game has, each a number, text of up to 50 characters, `true`/`false` or `null`. Today `balloon_pop` sends `highest_popped_frac` and `fruit_catch` sends `widest_catch_frac`, both shares of the reach of the best success. `bloom` sends `mean_time_to_open_ms` (over successes) and `best_openness` (the highest `peak_openness` of any trial). `finger_piano` sends `note_hit_rate` (hits over notes, all melodies), `best_finger` (the finger with the best hit rate; with equal rates, more notes played, then index first; `null` with no note played) and `hit_rate_<finger>` for each finger used. The web app reads them for each game's main measure. Response `200`: the game run with `ended_at`, `score` and `summary` set.

Errors: `404`, `409` if the run has already ended, `422`.

### GET /api/admin/sessions

Query: `limit` (1–50, default 10).

Response `200`: every patient's sessions, newest first.

```json
[
  {
    "id": 1,
    "patient_id": 1,
    "patient_code": "P001",
    "patient_name": "Alice Rahman",
    "started_at": "2026-11-09T10:00:00Z",
    "status": "completed",
    "duration_seconds": 1320.0,
    "games": [{ "game_id": "reach_activate", "score": 1525.0, "success_rate": 0.75 }]
  }
]
```

Errors: `422` (limit out of range).

### GET /api/admin/sessions/{id}

Response `200`: everything recorded in one session: the session fields as in `GET /api/sessions/current`, plus these.

| Field | Meaning |
| --- | --- |
| `patient_code`, `patient_name` | Whose session it is |
| `duration_seconds` | `null` without an `ended_at` |
| `calibration` | The calibration object, or `null` |
| `warmup_results` | Every warm-up result, as in `GET /api/sessions/{id}/warmup` |
| `games` | Every game run in the order started, each with `trials`: every trial in `trial_no` order, with its trajectory, `id`, `game_run_id` and `created_at`; and `adaptation`: the engine's decisions (see [the decision log](#the-decision-log-in-the-admin-session-detail)) |
| `feedback` | The cool-down questionnaire, as in `GET /api/sessions/{id}/questionnaire`, or `null` |
| `flags`, `needs_review` | The safety flags the questionnaire raised, and whether any did |
| `reviewed_at`, `review_note` | When an admin reviewed the alert and their note, or `null` |

Errors: `404`.

## Game settings

Each game's settings and their ranges come from the web registry, exported to `shared/game-specs.json` with `cd web; npm run export:specs` (a web test fails when the file is out of date). The server reads that file (or `GAME_SPECS_PATH`) to check the admin's settings. A game the admin never saved is enabled, with its own defaults and number of trials.

### GET /api/admin/games

Response `200`: all nine games in the registry's order:

```json
[
  {
    "spec": {
      "id": "grip_hold",
      "name_key": "game.grip_hold.name",
      "description_key": "game.grip_hold.description",
      "movement_key": "game.grip_hold.movement",
      "implemented": true,
      "trials_default": 8,
      "estimated_minutes": 4,
      "params": [
        { "name": "band_width", "label_key": "param.bandWidth", "min": 0.1, "max": 0.35, "step": 0.05, "default": 0.3, "unit": "level", "harder": "lower" }
      ]
    },
    "enabled": true,
    "default_params": { "hold_ms": 5000 },
    "trials_default": 10,
    "notes": null,
    "updated_at": "2026-11-11T10:00:00Z",
    "effective_params": { "band_center": 0.5, "band_width": 0.3, "hold_ms": 5000 },
    "effective_trials": 10
  }
]
```

`default_params` holds only the admin's changes; `effective_params` is every setting's starting value (the admin's where set, the game's otherwise). `updated_at` is `null` until the game is first saved.

### PUT /api/admin/games/{game_id}

Request (the whole setting, replacing the one before):

```json
{ "enabled": true, "default_params": { "hold_ms": 5000 }, "trials_default": 10, "notes": "Start with short holds" }
```

Each `default_params` entry must be one of the game's settings, between its `min` and `max`; `trials_default` is a whole number from 5 to 40, or `null` for the game's own; `notes` up to 1000 characters. Response `200`: the game as in the list.

Errors: `404` for an unknown game, `422` for a setting the game does not have, a value outside its range (the message names the range), trials outside 5–40, or another invalid field.

### POST /api/admin/games/{game_id}/reset

Deletes the admin's setting: the game is enabled again with its own defaults and trials. Response `200`: the game as in the list. Errors: `404` for an unknown game.

### GET /api/games/settings

Response `200`: the games patients may play (built and enabled), in the registry's order, with each setting's starting value and the number of trials:

```json
[{ "game_id": "grip_hold", "params": { "band_center": 0.5, "band_width": 0.3, "hold_ms": 5000 }, "trials": 10 }]
```

A saved default no longer inside its range (the game's settings changed since) is ignored. The plan lists only these games, and the games start every trial from these defaults; a patient's own value from the warm-up still comes first where a game has one.

## Server metrics

The server works out its own measures from the RAW data the browser saves (`server/app/metrics/`, numpy and scipy). Every reported measure is listed, with its unit and which way is better, in [the metrics catalogue](../shared/metrics-catalog.json) (ids such as `K6` movement time, `H3` grip steadiness, `P1` pain).

### Trial measures: `metrics_server` and `data_quality`

When a game run ends (`POST /api/games/{run_id}/end`), every trial of the run gets two more fields, returned in the admin session detail's trials:

- **`metrics_server`** depends on the game.
  - Spatial games (`reach_activate`, `balloon_pop`, `fruit_catch`, `path_trace`, `pick_place`) are recomputed from the RAW trajectory and timings: `reaction_ms` (filtered fingertip speed above 0.15 SW/s for 50 ms), `movement_ms`, `path_length_sw`, `straight_dist_sw`, `path_efficiency` (`transport_path_efficiency` for `pick_place`), `sparc`, `peak_speed_sw_s` and `speed_peaks`.
  - Other games' client metrics are checked against the trial schema and copied.
  - `null` until the run ends or an admin recomputes.
- **`data_quality`**: `{engine_version, n_points, sampling_hz, gaps_over_200ms, max_gap_ms, source: "trajectory" | "client", mismatches}`. `mismatches` holds, for each measure where the server's value differs from the browser's by more than 10%, `{client, server}`. The browser's own `metrics` are never changed.

### Session measures

Each session gets one row per catalogue measure it has, with trial measures per game. They are computed when the questionnaire is sent, when the session ends, and by the admin recompute. The admin session detail (`GET /api/admin/sessions/{id}`) lists them as `session_metrics`: `[{metric_id, game_id, value, unit, n, details, computed_at}]`.

- **Trial measures** are the median per game (quartiles in `details`), from the server's values first and the browser's only where the server did not compute a measure.
- **Range measures** take the best value.
- **Rates** cover every counted item.
- **Missing parts:** a measure the session lacks (no games, a skipped exercise, no questionnaire) has no row.

### Changes against the baseline

- **Baseline:** the mean of the first two completed sessions with the measure.
- **Change:** `change` is the latest value minus the baseline, in the measure's unit.
- **change_mdc:** the change divided by the measure's minimal detectable change. It is signed so that **positive is always better**: a fall in movement time, or SPARC closer to 0, is positive.
- **Status:** `improved` (change_mdc of 1 or more), `worse` (−1 or less), `no_detectable_change`, or `no_baseline` (fewer than three sessions with the measure).
- **The MDC values are provisional placeholders** (`server/app/core/mdc.py`) until measured on Day 19.

### GET /api/patient/progress/metrics

Query `ids` (optional, comma-separated catalogue ids such as `K1,K6`; every measure if left out; an unknown id is `422`). Response `200`: the patient's own completed sessions, one series per measure (per game for trial measures):

```json
[{ "metric_id": "K6", "game_id": "reach_activate", "name": "Movement time", "unit": "ms", "better_when": "lower",
   "points": [{ "session_id": 12, "date": "2026-11-10T10:00:00Z", "value": 1120.0 }] }]
```

### GET /api/admin/patients/{id}/metrics

Response `200`:

- **`metrics`:** a table with one row per measure (and game): `metric_id`, `game_id`, `name`, `unit`, `better_when`, `baseline`, `latest`, `change`, `change_mdc`, `status`, `mdc`, `provisional`, `n_sessions`.
- **`series`:** the series behind the table.
- **`mdc_provisional`:** true while the MDC values are placeholders.

Errors: `404`.

### GET /api/sessions/{id}/plan

Role: the session's patient, or an admin; anyone else gets `404`. Today's games in order, each with a reason, from the session planner ([`server/app/services/planner.py`](../server/app/services/planner.py)). The plan is made the first time it is asked for while the session is active, from the patient's completed sessions before this one, and kept with the session: asking again returns the same plan. A session that ended without a plan gets `404`: a plan is never made afterwards.

```json
{
  "games": [
    { "game_id": "grip_hold", "trials": 8, "minutes": 3.9, "reason_key": "favourite", "reason_params": {} },
    { "game_id": "reach_activate", "trials": 20, "minutes": 5.0, "reason_key": "practise_weak_direction", "reason_params": { "direction_deg": 90 } },
    { "game_id": "bloom", "trials": 15, "minutes": 4.0, "reason_key": "focus_hand_opening", "reason_params": {} },
    { "game_id": "fruit_catch", "trials": 15, "minutes": 4.5, "reason_key": "variety", "reason_params": {} }
  ],
  "total_minutes": 17.4,
  "focus": { "movements": ["hand_opening"], "directions": [90] },
  "notes": [],
  "version": 1,
  "created_at": "2026-11-12T09:00:00Z"
}
```

**`reason_key`** is one of:
- `focus_<movement>`: the movement's measures were worse, or unchanged while others improved. Movements are `reach`, `shoulder`, `elbow`, `hand_opening`, `fingers`, `grip` and `smoothness`.
- `practise_weak_direction`: with `direction_deg`.
- `variety`: not played in the last 2 sessions.
- `favourite`: enjoyed and successful.
- `lighter_today`.
- `balance`: the plan's one reach or hand game; with `movement`.
- `keep_practising`: with `movement`.

**`notes`** may hold `{ "key": "lighter_today", "params": { "because": "fatigue" | "too_hard" | "pain" } }`. After a session with fatigue 7 or more, "too hard" or a pain flag, the plan has 3 games and about 12 minutes; otherwise 4 games and 16–18 minutes.

**Rules that always hold:**
- only games turned on in the Game Library;
- at least one reach or shoulder game and one hand, finger or grip game;
- no two shoulder-heavy games (`balloon_pop`, `path_trace`, `fruit_catch`) next to each other;
- the easiest game first and the most enjoyable last, when the other rules allow.

The web app sends the plan's trials with the game queue (`PATCH /api/sessions/{id}/progress`, `game_queue.trials`: game id to 5–40), and each game plays that many.

### GET /api/admin/patients/{id}/plan

Role: `admin`. The patient's most recent session with a plan: `{session_id, started_at, session_status, plan, overrides}`, with `plan` as in `GET /api/sessions/{id}/plan` and `overrides` as below; all `null` (and no overrides) before the first plan. Errors: `404`.

### POST /api/sessions/{id}/plan/override

Role: the session's patient, while it is active. Records the games the patient kept and their order, for analysis; the stored plan does not change.

```json
{ "games": ["bloom", "reach_activate", "fruit_catch"] }
```

Response `201`: every change recorded for the session so far:

```json
{
  "overrides": [
    {
      "at": "2026-11-12T09:02:00Z",
      "planned": ["grip_hold", "reach_activate", "bloom", "fruit_catch"],
      "games": ["bloom", "reach_activate", "fruit_catch"],
      "removed": ["grip_hold"],
      "added": [],
      "reordered": true
    }
  ]
}
```

Errors: `404`, `403` for an admin, `409` once the session has ended, `422` for an empty list or an unknown game.

### GET /api/sessions/{id}/facts

The session's facts for the LLM feedback module: codes and numbers only, never a name or an email. Only the patient who owns the session, or an admin, may read them; anyone else gets `404`. The schema, with an example, is in [session-facts.md](session-facts.md).

### POST /api/admin/metrics/recompute

Query `session_id` (optional: every session when left out). It recomputes every trial's `metrics_server` and `data_quality`, then the session measures. Running it again replaces the results.

Response `200`: `{ "sessions", "runs", "trials", "mismatched_trials", "session_metrics" }` (counts). Errors: `404` for an unknown session.

### CSV exports

Both are admin only (`403` for a patient) and downloads (`Content-Disposition: attachment`). Patients appear only by `patient_code`: never a name or an email.

- **`GET /api/admin/patients/{id}/export.csv`** (`P001-metrics.csv`): the patient's session measures, one row each (long format), oldest session first. Columns: `patient_code, session_id, session_started_at, session_status, metric_id, metric_name, game_id, value, unit, n, computed_at`. Errors: `404`.
- **`GET /api/admin/export/trials.csv`** (`muvi-rehab-trials.csv`): every trial of every patient, one row each. Columns:
  - `patient_code, is_demo, session_id, session_started_at, run_id, game_id, engine, input_source, trial_no, outcome, compensated`;
  - `params`, `target` and `timings`, each as JSON text;
  - `n_points, sampling_hz, gaps_over_200ms`, and `mismatches` (the names of the measures that differ);
  - one `server_<measure>` column for each server measure any trial has.

## Cool-down questionnaire and safety alerts

After the games, the patient answers a short questionnaire. It is stored as `SessionFeedback`, one per session. The LLM feedback module reads these field names, so they must not change.

The answers can raise safety flags on the session. The rules live in `server/app/services/safety.py`, and their thresholds are still to be confirmed with the supervisor:

| Flag | Raised when |
| --- | --- |
| `pain` | `pain_0_10` is 4 or more |
| `new_symptoms` | `new_symptoms` is `true` |
| `high_fatigue` | `fatigue_0_10` is 8 or more |

Flags are listed in that order. Any flag sets the session's `needs_review` to `true`. A flag asks a therapist to look at the session; it is not a diagnosis.

### POST /api/sessions/{id}/questionnaire

Role: `patient`, own session only. Allowed whatever the session's status.

Request:

```json
{
  "pain_0_10": 2,
  "fatigue_0_10": 5,
  "enjoyment_1_5": 4,
  "difficulty": "just_right",
  "new_symptoms": false,
  "comment": "Felt good today"
}
```

- `pain_0_10` and `fatigue_0_10` are whole numbers from 0 to 10, and `enjoyment_1_5` from 1 to 5. Strings and decimals are rejected.
- `difficulty` is `too_easy`, `just_right` or `too_hard`.
- `new_symptoms` is `true` or `false`.
- `comment` is optional, at most 300 characters. It is trimmed, and a blank comment is saved as `null`.

Response `201`:

```json
{
  "id": 1,
  "session_id": 12,
  "pain_0_10": 2,
  "fatigue_0_10": 5,
  "enjoyment_1_5": 4,
  "difficulty": "just_right",
  "new_symptoms": false,
  "comment": "Felt good today",
  "created_at": "2026-11-10T10:30:00Z",
  "flags": [],
  "needs_review": false
}
```

Errors: `404` for a missing or another patient's session, `409` (`Questionnaire already submitted`) when the session already has one, `422` for invalid answers.

### GET /api/sessions/{id}/questionnaire

Role: `patient`, own session only.

Response `200`: as for the POST. Errors: `404` for a missing or another patient's session, or when the questionnaire was not submitted (`Questionnaire not submitted`).

### GET /api/admin/alerts

Role: `admin`. Query: `reviewed` (optional) — `false` for open alerts only, `true` for reviewed ones only; leave it out for both.

Response `200`: sessions with `needs_review`, newest first.

```json
[
  {
    "session_id": 12,
    "patient_id": 3,
    "patient_code": "P003",
    "date": "2026-11-10T10:00:00Z",
    "flags": ["pain", "high_fatigue"],
    "reviewed": false,
    "reviewed_at": null,
    "review_note": null
  }
]
```

`date` is when the session started.

### POST /api/admin/alerts/{session_id}/review

Role: `admin`. The body is optional: `{ "note": "Called the patient" }`. The note is trimmed, at most 500 characters, and a blank note is saved as `null`.

Response `200`: the alert, as in `GET /api/admin/alerts`, with `reviewed` set to `true`.

Errors: `404` (`Alert not found`) for a missing session or one without `needs_review`, `409` (`Alert already reviewed`), `422` for a note that is too long.

## Progress and the session summary

### Local days

`GET /api/patient/dashboard`, `GET /api/patient/progress` and `GET /api/admin/patients/{id}/progress` take an optional `tz_offset_minutes` query: the browser's minutes ahead of UTC, from -720 to 840 (Dhaka, UTC+6, is `360`; the default is `0`). Streaks, weeks and the calendar use the local days it gives. Weeks start on Monday.

### The weekly goal

`is_demo` on the patient object is `true` only for demo patients made by `server/scripts/seed_demo_data.py`, whose sessions are synthetic. It cannot be set through the API.

The patient object has `weekly_goal`: completed sessions a week the patient aims for, a whole number from 1 to 14, default `5`. Admins set it with `POST` or `PATCH /api/admin/patients`.

### GET /api/patient/progress

Role: `patient`. Only **completed** sessions count.

```json
{
  "streak_days": 3,
  "sessions_this_week": 2,
  "weekly_goal": 5,
  "calendar": [{ "date": "2026-10-14", "completed": 0 }, "… 28 days, oldest first, ending today"],
  "series": [
    {
      "session_id": 12,
      "date": "2026-11-10T10:00:00Z",
      "hull_area_sw2": 1.42,
      "warmup_goals_reached": 5,
      "warmup_total": 6,
      "game_success_rate": 0.8,
      "total_reps": 64,
      "bloom_peak_openness": 0.81,
      "piano_hit_rate": 0.75,
      "path_sparc": -1.72,
      "elbow_range_deg": 68.4,
      "pick_transport_ms": 2450,
      "grip_steadiness": 0.041,
      "grip_relaxation_ms": 820
    }
  ],
  "last_session_date": "2026-11-10T10:00:00Z",
  "first_reach": null,
  "latest_reach": null
}
```

- `streak_days`: consecutive local days with a completed session, counting back from today. A day without one *yet* today does not break the streak: it then runs up to yesterday.
- `series`: one point per completed session, oldest first. `hull_area_sw2` is `null` without a calibration. `warmup_goals_reached` counts exercises whose goal was reached, out of `warmup_total` (skipped ones included). `game_success_rate` is successful trials over all trials of every game, leaving out `aborted` trials, or `null` without trials. `total_reps` is warm-up repetitions done in full. `bloom_peak_openness` is the mean of each Bloom trial's `peak_openness` and `piano_hit_rate` is hits over notes of every Finger piano melody, both leaving out `aborted` trials, each `null` without that game. Likewise `path_sparc` is the mean `sparc` of the Path trace trials (0 or less; closer to 0 is smoother), `elbow_range_deg` the mean `achieved_range_deg` of the Paint the wall stripes, `pick_transport_ms` the mean `transport_ms` of the Pick and place objects placed, and `grip_steadiness` and `grip_relaxation_ms` the mean `steadiness` and `relaxation_ms` of the Grip and hold trials that have them.
- `last_session_date`: when the latest session of any status started, or `null`.
- `first_reach` and `latest_reach`: the oldest and newest calibrations, each `{ session_id, date, reach_radii_sw, hull_sw, hull_area_sw2, valid }`, or `null`.

### GET /api/admin/patients/{id}/progress

Role: `admin`. As above, for one patient. Errors: `404`.

### GET /api/sessions/{id}/summary

Role: `patient`, own session only. Errors: `404` for a missing or another patient's session.

| Field | Meaning |
| --- | --- |
| `session_id`, `started_at`, `ended_at`, `status` | As in the session object |
| `duration_seconds` | Start to end, or `null` while the session is open |
| `active_seconds` | Warm-up exercise time (skipped exercises left out) plus the time of each finished game |
| `warmup` | The warm-up summary (`exercises_done`, `exercises_total`, `total_reps`, `goals_reached`, `mean_compensation_rate`), or `null` |
| `previous_warmup` | The same for the most recent earlier session with a warm-up, plus its `session_id`, or `null` |
| `games` | Finished runs in the order played: `run_id`, `game_id`, `status`, `score`, `trials_done`, `trials_planned`, `successes`, `success_rate`, `summary`, `main_measure`, `extra_measures`, `level_start` and `level_end` (the difficulty level, 1–10, the run started and ended at; `null` with fixed settings), and `previous` — the patient's last finished run of the same game in an earlier session (`session_id`, `score`, `success_rate`, `summary`), or `null` |
| `reach` | This session's calibration, as in `latest_reach` above, or `null` |
| `previous_reach` | The most recent calibration from an earlier session, or `null` |
| `feedback` | The cool-down questionnaire, or `null` |
| `flags` | The session's safety flags |

"Earlier" means a session of the same patient that started before this one, whatever its status. The web app decides "better / same / lower" from these figures.

`main_measure` is the headline figure the web app shows for each game, and `extra_measures` the figures shown beside it, in order. Each is `{ "name": …, "value": …, "unit": "ms" | "share" | "percent" | "count" | "deg" | "sparc" | "finger" }`, with `value` `null` when not recorded. A run without a summary has `main_measure: null` and no extra measures; games without extra figures have an empty list.

| Game | `main_measure` | `extra_measures` |
| --- | --- | --- |
| `reach_activate` | `mean_reach_ms` (ms) | — |
| `balloon_pop` | `highest_balloon_frac` (share) | — |
| `fruit_catch` | `widest_catch_frac` (share) | — |
| `bloom` | `flowers_grown` (count of successes) | `best_openness` (share) |
| `finger_piano` | `note_hit_rate` (share) | `best_finger` (finger) |
| `path_trace` | `stars` (count) | `mean_in_corridor_pct` (percent), `best_sparc` (sparc) |
| `paint_wall` | `stripes_finished` (count of successes) | `best_range_deg` (deg) |
| `pick_place` | `objects_placed` (count of successes) | `total_drops` (count), `mean_transport_ms` (ms) |
| `grip_hold` | `holds_completed` (count of successes) | `best_steadiness` (share: the smallest standard deviation; smaller is steadier), `mean_relaxation_ms` (ms) |

They read the run summary's `details`: `path_trace` sends `total_stars`, `mean_in_corridor_pct` and `best_sparc` (the trace closest to 0); `paint_wall` sends `mean_range_deg` and `best_range_deg`; `pick_place` sends `mean_transport_ms` (over the objects placed) and `total_drops`; `grip_hold` sends `mean_in_band_pct`, `best_hold_ms`, and over the holds completed `best_steadiness` and `mean_relaxation_ms`.

## Adaptive difficulty

From Day 12 each game's difficulty can adapt to the patient (see [docs/ai-engine.md](ai-engine.md)). A patient's `engine_mode` (`L0` fixed settings, `L1` staircase, `L2` Bayesian and workspace-aware, `L1` by default) is on the profile in `GET /api/auth/me` (`patient_profile.engine_mode`) and is copied to each new game run's `engine`, whatever the web app sends. An admin sets `engine_mode` with `PATCH /api/admin/patients/{id}` (`{"engine_mode": "L2"}`); it applies from the patient's next game run. A patient's maximum difficulty per game (`max_difficulty`, 0–1, 1 when unset) is stored on the profile and has no admin route yet.

### POST /api/engine/next

Role: `patient`, own active run only. The next trial's settings. The web app calls it once when a run starts (`last_trial: null`) and after every trial, and waits at most 300 ms: without an answer it keeps the previous settings.

```json
{
  "run_id": 12,
  "last_trial": {
    "trial_no": 3,
    "outcome": "reach_fail",
    "failure_type": "reach_fail",
    "compensated": false,
    "movement_ms": 1240,
    "completion_ms": null,
    "activation_peak": 0.62
  }
}
```

`trial_no` is 1–500; `outcome` as in a trial; `direction_deg` (0–360), `distance_frac` (0–2) and `side` (`out` or `across`, Fruit catch) say where the target was, so L2 credits the sector played (optional); `failure_type` (`reach_fail`, `activation_fail`, `miss` or `null`) says which kind of difficulty a failure points at, the outcome when left out; `completion_ms` is for games without a movement time; `activation_peak` is 0–1. Unknown fields are refused.

Response `200`:

```json
{
  "params": { "distance_frac": 0.66, "target_radius_sw": 0.27, "dwell_ms": 500, "activation_demand": 0.5, "rest_ms": 1500 },
  "level": 5,
  "cue": null,
  "decision": "A reach fail: spatial a little easier (0.52 -> 0.44).",
  "safety_override": null,
  "engine": "L1"
}
```

| Field | Meaning |
| --- | --- |
| `params` | Every setting of the next trial, within the game's spec bounds and the patient's maximum |
| `level` | 1–10, from the mean difficulty; the only figure patients see |
| `cue` | `posture`, `encourage`, `rest`, `finish_soon`, `finish` or `null`: the most important cue the safety rules gave |
| `decision` | The engine's reason in plain words, with its numbers (admin and research only) |
| `safety_override` | What the safety rules changed or blocked, `; `-separated, or `null` |
| `engine` | `L0`, `L1` or `L2` |
| `direction_deg`, `distance_frac`, `sector`, `side` | Where the next target goes, when the engine chooses it (L2 in Reach and squeeze, Balloon pop, Fruit catch, Pick and place and Path trace); `sector` is like `D2R3` (or `out-R2`); all `null` otherwise |

Every call writes one decision log row (the run and `trial_no`, 0 for the start). Reporting the same trial again returns the stored answer and writes nothing. For `L0` the settings are always the admin's defaults and the level never moves; the cues still come.

Errors: `404` for a missing or another patient's run, `403` for an admin, `409` for a run that has ended, `422` for an invalid trial (for example `trial_no` 0 or an unknown outcome).

### GET /api/admin/patients/{id}/levels

Role: `admin`. The patient's engine mode and current difficulty in each game played with it.

```json
{
  "engine_mode": "L1",
  "games": [
    {
      "game_id": "reach_activate",
      "engine": "L1",
      "level": 6,
      "d": { "spatial": 0.58, "activation": 0.5, "precision": 0.52 },
      "trials_seen": 140,
      "updated_at": "2026-11-11T10:20:00Z"
    }
  ]
}
```

`games` lists the stored states of the current `engine_mode` only, by game id; `d` is each component's difficulty (0 easiest, 1 hardest). Errors: `404`.

### The decision log in the admin session detail

`GET /api/admin/sessions/{id}` gives each run an `adaptation` list, in `trial_no` order: `trial_no` (0 for the start), `engine`, `state_before`, `state_after` (`{d, streak, turn}`), `params`, `decision`, `safety_override`, `cue`, `trial` (the `last_trial` sent, or `null` at the start), `details` (L2: the sampled values, the chosen sector and levels, and the target; `null` for L0 and L1), `level` (after the decision) and `created_at`. Runs with fixed settings that never called the engine have an empty list.

## Feedback reports (`server/app/api/feedback.py`)

Each session gets a report written by the local language model (see [ai-engine.md, "LLM feedback"](ai-engine.md#llm-feedback-serverappfeedback)).

**Writing a report.** A report is written in the background by one worker, so only one report uses the GPU at a time. The worker:
1. builds the facts;
2. asks the model, validating each answer and retrying up to twice;
3. falls back to the template report after that, or when Ollama is unreachable or the job passes `LLM_JOB_LIMIT_S` (120 s).

Each attempt is limited by `LLM_TIMEOUT_S`.

**Requests.** Submitting the cool-down questionnaire queues a report automatically, in the patient's language.

**The job is the report.** A job's id is the report's id. Its status runs `queued` → `running` → `done` (the model's report), `fallback` (the template) or `failed` (an unexpected error; no report).

**Versions.** Each session and language has one current report. Regenerating keeps the old one, marked `superseded`.

**Restarts.** Jobs live while the server runs. At start-up, jobs left `queued` or `running` are queued again.

**What patients see.** Model text is plain text, never HTML. Patients never get `therapist_summary`, validation errors or the raw output.

### POST /api/sessions/{id}/feedback

Role: the session's patient, or an admin. Others get `404`.

Request (optional): `{ "language": "en" | "bn", "regenerate": false }`. The language defaults to the patient's.

Response `202`: `{ "job_id": 12, "status": "queued" }`.
- A finished report in that language comes back as it is (`"status": "done"` or `"fallback"`) unless `regenerate` is true.
- A report already being written is never queued twice.
- A `failed` one is replaced.

### GET /api/feedback/jobs/{job_id}

Role: the report's patient, or an admin.

```json
{
  "job_id": 12,
  "session_id": 42,
  "language": "en",
  "status": "done",
  "report": {
    "language": "en",
    "patient_summary": "…",
    "highlights": [{ "metric_id": "K6", "text": "…" }],
    "suggestions": [{ "id": "REST_BREAKS", "text": "…" }],
    "next_session_text": "…"
  },
  "safety_notices": ["Please stop practising for today and …"],
  "meta": {
    "model": "qwen3.5:4b",
    "prompt_version": "v1",
    "latency_ms": 21400.5,
    "retries": 0,
    "fallback_used": false
  },
  "created_at": "…",
  "finished_at": "…"
}
```

- `report`, `safety_notices` and `meta` are `null` until the status is `done` or `fallback`.
- Admins also get `report.therapist_summary`.
- `safety_notices` is fixed approved text from `shared/safety-notices.json`; show it above the report.

### GET /api/sessions/{id}/feedback?language=en

The session's current report, as above, or `404`. Role: the session's patient, or an admin. The language defaults to the patient's.

### GET /api/patient/reports

Role: `patient`. Their current reports, newest session first; failed ones are left out:

```json
[
  {
    "job_id": 12,
    "session_id": 42,
    "session_no": 7,
    "date": "…",
    "language": "en",
    "status": "done",
    "preview": "Thank you for finishing session 7. …",
    "has_safety_notice": false
  }
]
```

### GET /api/admin/patients/{id}/reports

Role: `admin`. Every version of the patient's reports, newest first:
- `job_id`, `session_id`, `patient_id`, `patient_code`, `language`, `status`, `superseded`;
- `model`, `prompt_version`, `latency_ms`, `retries`, `fallback_used`, `error`;
- `validation_errors` (the first 3 of each attempt), `ratings` (a count), `created_at`, `finished_at`.

Errors: `404` for an unknown patient.

### GET /api/admin/reports?status=fallback

Role: `admin`. Monitoring across patients, newest first (at most 200), in the same shape; `status` is optional (`queued`, `running`, `done`, `fallback`, `failed`).

### GET /api/admin/reports/{id}

Role: `admin`. Everything about one report: the fields above, plus:
- `facts` and `candidates`, as they were when it was written;
- every attempt's `validation_errors`, `raw_output` (each answer the model wrote);
- `prompt_tokens`, `output_tokens`, `error`, `superseded`.

### POST /api/feedback/{report_id}/ratings

Role: the report's patient, rating as `participant`, or an admin, rating as `team` or `clinician` (another rater gets `403`).

Request:

```json
{ "rater": "participant", "scores": { "clarity": 5, "usefulness": 4 }, "comment": "Easy to follow" }
```

- `scores` is 1–5 for any of `clarity`, `usefulness`, `accuracy`, `tone` and `safety` (at least one).
- `comment` is at most 300 characters and is never sent to the model.

Response `201`: the rating (`id`, `report_id`, `rater`, `rater_user_id`, `scores`, `comment`, `created_at`).

Errors:
- `409` if the report is not finished, or this person already rated it;
- `404` for someone else's report;
- `422` for unknown criteria or scores outside 1–5.

### GET /api/admin/reports/{id}/ratings

Role: `admin`. The report's ratings, oldest first.

### GET /api/feedback/health

Role: any logged-in user.

```json
{ "provider": "ollama", "model": "qwen3.5:4b", "reachable": true, "model_loaded": true, "queue_length": 0 }
```

- `reachable: false` means reports use the template at once.
- `model_loaded` reflects Ollama's `/api/ps`. At start-up, the server loads the model in the background and never waits for it.
- `queue_length` counts reports queued or being written.
