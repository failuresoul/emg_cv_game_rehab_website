# End-to-end tests (Day 18)

The tests run in headless Chromium without a webcam, a muscle sensor or Ollama:

- **Camera:** replayed or synthetic landmarks.
- **Muscle sensor:** the simulated sensor.
- **Feedback model:** the mock.

```powershell
cd web
npm run e2e                 # all tests; Playwright starts and stops both servers
npx playwright test smoke   # one file
npx playwright show-report  # the last run's report
```

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

| Part                                                               | What it does                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `currentTarget`                                                    | The current game's goal: `phase`, `pointSw` (body frame), `hand` and `finger`. `null` between trials |
| `game.stage`                                                       | The current game's stage                                                                             |
| `vision.play`, `playRecording`, `clear`, `source`, `framesEmitted` | Control and check the replay                                                                         |
| `emg.setLevel(x)`                                                  | Holds the simulated muscle sensor at x (0 rest, 1 full). `null` gives the M key back                 |

### Server helpers

These exist only with `APP_ENV=test`; `tests/test_test_routes.py` proves it.

- `POST /api/test/reset`: a fresh database with the admin and the two demo patients. It takes `{"demo_patients": false}` for the admin only. The patients' password is in the answer.
- `POST /api/test/seed-session`: a completed session with data for a patient. It takes `{"patient_id": 1, "progress": 0.5, "pain": false, "days_ago": 0}`.

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
