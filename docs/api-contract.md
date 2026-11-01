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
| GET    | `/api/patient/dashboard`             | `patient` | Get the patient's home page data |
| GET    | `/api/patient/calibration/latest`    | `patient` | Get own latest calibration      |
| GET    | `/api/patient/sessions`              | `patient` | List own sessions               |
| POST   | `/api/sessions`                      | `patient` | Start or resume a session       |
| GET    | `/api/sessions/current`              | `patient` | Get own active session          |
| PATCH  | `/api/sessions/{id}/device-info`     | `patient` | Save browser, FPS and GPU/CPU   |
| POST   | `/api/sessions/{id}/end`             | `patient` | End own session                 |
| POST   | `/api/sessions/{id}/calibration`     | `patient` | Save a calibration              |

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

A 422 response lists each problem. `loc` names the field:

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
    { "step": "warmup", "minutes": 6 },
    { "step": "games", "minutes": 15 },
    { "step": "feedback", "minutes": 2 }
  ],
  "last_session": {
    "date": "2026-11-02T09:00:00Z",
    "status": "completed",
    "duration_seconds": 1560.0
  },
  "latest_calibration": {
    "hull_sw": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
    "hull_area_sw2": 0.5
  },
  "streak_days": 0
}
```

`last_session` and `latest_calibration` are `null` until they exist. `duration_seconds` is `null` for a session with no `ended_at`. `today_plan` is a fixed list and `streak_days` is always `0` for now.

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
    "hull_area_sw2": 0.5
  }
]
```

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

- `affected_side` must match the patient's profile.
- `directions_deg` must be exactly the eight angles shown.
- `reach_radii_sw`, `reach_points_sw` and `quality.valid` must each have exactly 8 items.
- Each radius must be between 0.2 and 3.0 SW.
- `hull_sw` must have at least 3 points.
- `shoulder_width_px` and `hull_area_sw2` must be greater than 0.

Response `201`: the same fields, plus `id`, `session_id` and `created_at`.

Errors: `404`, `409` if the session already has a calibration or has ended, `422`.

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
