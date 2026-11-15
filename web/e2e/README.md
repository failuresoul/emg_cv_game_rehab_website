# End-to-end tests (Day 18)

The tests run in headless Chromium without a webcam, a muscle sensor or Ollama:

- **Camera:** replayed or synthetic landmarks.
- **Muscle sensor:** the simulated sensor.
- **Feedback model:** the mock.

```powershell
cd web
npm run e2e                                    # the fast suite (every spec, short sessions)
npm run e2e:full                               # the main journey at its real length
npx playwright test --project=fast auth.spec   # one file
npx playwright show-report                     # the HTML report of the last run
.\..\scripts\check.ps1 -E2E                     # every check, then the fast suite
```

### The suites

| File                                    | What it covers                                                                                                                                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`                          | Landing page to login (admin and patient), a wrong password, role guards on typed addresses, logout, the login surviving a reload                                                                                                                                                            |
| `admin.spec.ts`                         | Create, edit, deactivate and activate a patient; a programme (a game off, a level cap, games per session, gentle warm-up); the Game Library; an alert acknowledged and resolved; a study created and a patient enrolled                                                                      |
| `patient-session.spec.ts`               | The main journey: camera check, calibration, all six warm-up exercises (counts within 1 of the script), the plan (the programme and its reasons), two games, the cool-down, the mock report, the history and the admin's session page; and the same first steps with Shadik's real recording |
| `emg.spec.ts`                           | The simulated muscle sensor: check to "ready" with a test squeeze, rest and three efforts, Grip and hold played with the sensor, the cable pulled (amber dot, camera fallback) and plugged back in                                                                                           |
| `resilience.spec.ts`                    | Refreshing in the warm-up and in game 2, leaving mid-session (aborted), the server away during a game (its trials saved later), the model failing (template report), the camera refused                                                                                                      |
| `bangla.spec.ts`                        | A short session in Bangla: no English on any screen (checked against `en.ts`), the report in Bangla                                                                                                                                                                                          |
| `research.spec.ts`                      | A three-condition study: three sessions in the participant's Latin-square order, identical screens, the results page                                                                                                                                                                         |
| `privacy.spec.ts`                       | No image or video in any request of a whole session, requests only to this computer (and Google Fonts), the camera let go afterwards                                                                                                                                                         |
| `smoke.spec.ts`, `record-guide.spec.ts` | Test mode itself, and the guided recorder's page and save endpoint                                                                                                                                                                                                                           |

### Projects

- **fast** (the default): short sessions through test settings, 2 warm-up repetitions and 2 game trials. In test mode the app reads them from localStorage `muvi-test-settings`.
- **full:** `patient-session.spec.ts` at the real lengths (10 repetitions, the games' own trials).

On a failure Playwright keeps a screenshot. Each failing test is retried once, and the retry records a trace (`npx playwright show-trace test-results/.../trace.zip`).

Playwright starts two servers, and stops them when the run ends:

- **API:** port 8001, with:
  - `APP_ENV=test`;
  - `LLM_PROVIDER=mock`;
  - its own database, `data/e2e-test.db`.
- **Web:** port 5174, with `VITE_TEST_MODE=true`.

It never reuses a running server, so a test cannot touch your own database. If port 8001 or 5174 is already in use, it stops with an error.

## Test mode

Test mode exists only in a development build started with `VITE_TEST_MODE=true`. A production build has none of the hooks below, and it leaves out `public/test-fixtures/`.

### Replay

The vision engine plays landmarks instead of opening the camera. It never asks for the camera. There are three ways to choose them:

| How                                                   | What it plays                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `?replay=<name>` (or localStorage `muvi-test-replay`) | `public/test-fixtures/landmarks/<name>.json`; add `&replayLoop=1` to loop it  |
| `?replay=synth:still` or `?replay=synth:demo`         | A built-in synthetic script; add `&replaySide=right` for a right-side patient |
| `window.__muviTest.vision.play(script)`               | A synthetic script, from that moment                                          |

### `window.__muviTest`

| Part                                                                                                 | What it does                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `currentTarget`                                                                                      | The current game's goal: `phase`, `pointSw` (body frame), `hand`, `finger` and `level`. `null` between trials |
| `game.stage`, `game.level`, `game.source`                                                            | The current game's stage, its activation level and input source (`emg`, a camera source…)                     |
| `vision.play`, `playRecording` (with a `marker`), `clear`, `source`, `framesEmitted`, `engineStatus` | Control and check the replay; a marker plays one step of a guided recording                                   |
| `emg.setLevel(x)`                                                                                    | Holds the simulated muscle sensor at x (0 rest, 1 full). `null` gives the M key back                          |
| `emg.unplug()`, `emg.replug()`                                                                       | Pulls the simulated sensor's cable, and plugs it back in                                                      |
| `i18n.values(language)`, `i18n.language()`                                                           | The app's strings, so the tests find buttons in either language                                               |

### Server helpers

These exist only with `APP_ENV=test`; `tests/test_test_routes.py` proves it.

- `POST /api/test/reset`: a fresh database with the admin and the two demo patients. It takes `{"demo_patients": false}` for the admin only. The patients' password is in the answer.
- `POST /api/test/seed-session`: a completed session with data for a patient. It takes `{"patient_id": 1, "progress": 0.5, "pain": false, "days_ago": 0}`.
- `POST /api/test/llm`: `{"mode": "fail"}` makes the feedback model fail, so reports use the template; `{"mode": "ok"}` (or a reset) undoes it.

The test server's mock model writes a valid report ("You completed today's session…"), so a test can tell the model's report from the template's.

## Synthetic scripts

See `src/testing/synthLandmarks.ts`. A script is a list of steps with durations:

```ts
await page.evaluate(() =>
  window.__muviTest!.vision.play({
    affectedSide: "left",
    steps: [
      { do: "still", ms: 1000 },
      { do: "reach", to: "target", ms: 1200, holdMs: 800 }, // the game's current target
      { do: "hand", open: 0, ms: 400, holdMs: 1000 }, // squeeze
      { do: "hand", open: 1, ms: 400 },
    ],
  }),
);
```

These are the steps:

- **Sitting and reaching:**
  - `still`;
  - `reach` (to a body-frame point or `"target"`, with optional `holdMs` and `back`);
  - `follow` (stays on a moving target).
- **Arm angles:**
  - `raise` (`plane`: `"forward"`, `"sideways"` or a number of degrees; `deg`);
  - `elbow`;
  - `arm`.
- **Hand:**
  - `hand` (`open`: 0 to 1);
  - `thumbTouch`;
  - `pinch` and `release`. For a pinch-carry-release, use reach, then `pinch`, then reach, then `release`.
- **Playing a game by itself:** `auto` follows the game's target and does what it asks of the hand, every frame.
- **Calibration:** `reach` with `by: "wrist"` puts the wrist (not the fingertip) on the point.
- **Trunk:** `lean` (`forwardDeg`, `sidewaysDeg`).
- **Losing sight:**
  - `hideHand` (the hand is lost);
  - `leave` (nobody in view).

## Recording your own landmark file

1. Start the app in development: `cd web; npm run dev` (and the server).
2. Open `http://localhost:5173/dev/exercise-lab` and click **Start camera**.
3. Type a name (letters, digits, `.`, `-`, `_`), click **Record landmarks**, do the movements, then click **Stop**.
   - **What it saves:** the browser downloads `<name>.json`, with landmarks only and never the image.
   - **Size:** about 3 kB a frame, so 2 minutes is about 11 MB.
4. Move the file to `web/public/test-fixtures/landmarks/`.
5. Play it in test mode:
   - in a test: `page.goto("/session/...?replay=<name>")`;
   - by hand: run `$env:VITE_TEST_MODE="true"; npx vite`, then open a page with `?replay=<name>`.

`npm run fixtures:landmarks` rebuilds the synthetic example, `synthetic-session.json`.
