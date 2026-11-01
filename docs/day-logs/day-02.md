# Day 2

**FPS measured with a real webcam: ___**

Fill this in from the camera check's corner label, and note GPU or CPU.

## What was built

- **Session storage:** `Session` and `Calibration` tables, with routes to start or resume, end and calibrate a session. An active session older than 2 hours is marked aborted.
- **Tracking layer:** body-frame geometry, a stable shoulder width (median of 30 frames), a One Euro filter for the on-screen cursor only, and the `useTracking` hook. Vitest was added for pure logic.
- **Session flow:** Start session, then camera check, then calibration, then the warm-up placeholder. Exit asks for confirmation and ends the session as aborted.
- **Reach calibration:** 8 guided directions with a countdown, a 3-second hold, quality rules, redo one direction, and saving with device information.
- **Reach map:** a reusable `ReachMap` component, with an earlier map as a dashed outline and a similar, larger or smaller comparison.
- **Dashboards:** patient home and history pages, admin Sessions and Progress tabs, and a real sessions-today count.
- **Smoke test:** `server/scripts/smoke_test.py` checks the main API flow on a running server.
- **Docs:** [the API contract](../api-contract.md) and [the Day 2 test report](day-02-test-report.md).

### Routes added beyond the original plan

- `PATCH /api/sessions/{id}/device-info`, because FPS and GPU or CPU are only known once the camera has been running.
- `GET /api/patient/sessions/{id}`, because no other route returned a past session's calibration.

## How to test

Follow the [How to run](../../README.md#how-to-run) steps first.

```sh
# From server/, with the virtual environment active
pytest

# From web/
npm test
npm run lint
npm run build

# From server/, with the server running in another terminal
python scripts/smoke_test.py
```

The smoke test adds one test patient and one session to the database each time it runs, then deactivates the patient.

For the camera, follow the manual rows in the [test report](day-02-test-report.md).

## Known issues

**Could change results**

- **No real person has done a calibration yet.** Browser tests used simulated body positions, so the measurements, the lean rule and the hand-lost rule still need real movement.
- **The 0.15 SW trunk limit may be too tight.** Reaching naturally moves the shoulders, so normal reaches could be asked to repeat, especially upward.
- **Long reaches can leave the camera's view.** That counts as a lost hand. A patient who gets stuck can use **Skip this direction**.
- **Measuring continues behind the Exit dialog.** If a hold window ends while the dialog is open, that direction is recorded.

**Behaviour to improve**

- **A session stays active after calibration.** Nothing marks it completed until the later session steps exist. Starting again within 2 hours resumes it and goes straight past calibration to the warm-up placeholder.
- **Returning to a session page starts a session.** The browser's Back button after Exit, or opening a session address directly, starts a new one, because the session pages always need one.
- **The cursor lags on fast reaches.** With beta 0.01, a simulated 1 SW reach in 0.5 seconds leaves it 0.28 SW behind. Saved data is not affected, but beta needs tuning before games use the cursor.
- **"Sessions today" counts from midnight UTC,** which is 6 am in Bangladesh and around 8–11 am in Australia.
- **Patients have no progress chart yet.** The home card says one is coming, and the `/patient/progress` page still has placeholder text.

**Technical debt**

- **The Bangla text needs a native speaker's review,** including today's additions.
- **React screens have no automated tests in the repository.** Vitest covers pure logic only. Today's browser checks were throwaway scripts and are not committed.
- **Coverage is not part of the project.** `pytest-cov` is not in the stack, so it was installed outside the project for this review.
- **The main JavaScript file is large,** at about 830 kB. It needs splitting by route.
- **There are no database migrations.** Today's new tables are created automatically, but later changes to existing tables will not be.
- **Calibration requests have no upper limit on hull size,** and session notes have no length limit. A patient could only affect their own records, but limits would be sensible.

## Day 3 preview

This is a proposed plan, to be adjusted as needed.

1. Run the real-person checks, record the FPS above, and adjust the trunk limit if needed.
2. Build the webcam-tracked warm-up exercises on `/session/warmup`, using `useTracking` and the saved calibration from `SessionContext`.
3. Record warm-up results using raw positions, with backend storage and tests.
