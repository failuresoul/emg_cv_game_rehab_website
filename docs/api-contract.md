# MotionLab API contract

This document lists every API route the server provides today, plus the routes reserved for the LLM feedback module. The examples are real responses captured from the server, with the token shortened.

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
| POST   | `/api/sessions/{id}/end`             | `patient` | End own session                 |
| POST   | `/api/sessions/{id}/calibration`     | `patient` | Save a calibration              |
| POST   | `/api/sessions/{id}/warmup`          | `patient` | Save or replace warm-up results |
| GET    | `/api/sessions/{id}/warmup`          | `patient` | Get a session's warm-up results |

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
{ "status": "ok", "app": "MotionLab", "version": "0.1.0" }
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
    "full_name": "MotionLab Admin",
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

`sessions_today` counts sessions started since midnight UTC. `open_alerts` is always `0` for now.

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
    "warmup_summary": null
  }
]
```

`warmup_summary` is a [warm-up summary](#warm-up-summaries), or `null` for a session without warm-up results.

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

### POST /api/sessions/{id}/end

Request:

```json
{ "status": "completed" }
```

`status` must be `completed` or `aborted`. Response `200`: the session, with `ended_at` set.

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

## Reserved for the LLM feedback module (teammate, server/app/feedback/)

These routes are **not implemented yet**. The module's owner builds them in `server/app/feedback/`, and they are included under `/api` on Day 16. Other code must not use these paths for anything else.

| Method | Path                                |
| ------ | ----------------------------------- |
| POST   | `/api/sessions/{id}/feedback`       |
| GET    | `/api/feedback/jobs/{job_id}`       |
| GET    | `/api/sessions/{id}/feedback`       |
| POST   | `/api/feedback/{report_id}/ratings` |
| GET    | `/api/feedback/health`              |

Their roles, requests and responses are for the module's owner to define, and will be added here at integration.
