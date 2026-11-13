# Day 16

**The muscle sensor (EMG): from the ESP32 to the games and the dashboards.**
- An Advancer Muscle Sensor V3.0 on an ESP32 streams 500 samples per second over USB.
- The browser reads it over Web Serial, checks it, and calibrates it.
- It drives the grip and hand-opening games, falling back to the webcam whenever it pauses.
- Every trial with the sensor saves a %MVC trace and its measures; the server turns them into session measures, facts and dashboards.

Everything also works with a **simulated sensor**, because the real hardware is first tested tonight ([EMG hardware test](../emg-hardware-test.md)).

## What was built

- **Task 1: firmware, hardware guide and serial tools.**
  - `firmware/emg_stream/emg_stream.ino`:
    - 500 Hz sampling on GPIO34 in a FreeRTOS task on core 0, which never prints or allocates;
    - a queue to `loop()` on core 1, which writes `E,<counter>,<mV>` lines and an `S` status line each second;
    - the commands `START`, `STOP`, `PING`, `RATE`, `SIM ON/OFF` and `INFO`, and a simulated signal;
    - builds on the ESP32 Arduino core 2.x and 3.x.
  - [firmware/README.md](../../firmware/README.md): parts, wiring, the voltage divider (GPIO34 ≤ 3.0 V), electrode placement, uploading and troubleshooting.
  - `firmware/test-lines.txt`: the line protocol, shared by the browser and Python tests.
  - `analysis/tools/serial_rate.py` (pyserial): rate, counter gaps and firmware drops.
- **Task 2: EMG in the browser** (`web/src/emg/`):
  - a Web Serial stream at 230400 baud, and a simulated stream (**M** squeezes);
  - a sample clock from the counters;
  - processing: a 50 ms moving average, %MVC (0–120), onset and offset detection, saturation and flat-line checks;
  - one `EmgEngine` for the whole app, and `/dev/emg-lab` (development only).
- **Task 3: muscle sensor check and calibration** (`/session/emg`):
  - **Safety and placement:** laptop on battery, fresh batteries, electrodes on; and the site (flexors or extensors).
  - **Sensor check:** nine items, green for 2 s, then a test squeeze.
  - **Calibration:** rest for 10 s, three strongest efforts (an extra one if they differ by more than 15%), and the 3 × rest rule.
  - **Server:** `EmgCalibration` and its routes; a real sensor requires `battery_ok`.
  - The session's status dot, and Skip at every stage.
- **Task 4: EMG in the games and the measures.**
  - **Input:** `EmgSource` (level = clamp(%MVC / 100), smoothing 0.3). The input manager falls back to the webcam while the sensor is paused, and returns by itself.
  - **Games:**
    - the flexors drive grip in Reach and squeeze and Grip and hold, and the extensors drive opening in Bloom;
    - the badge, the paused banner, and `input_source: "emg"`.
  - **Per trial:** a %MVC trace (50 Hz, ≤ 1500 points), peak, mean when active, onset latency, relaxation time, time in band and steadiness.
  - **Server:** E2, E3, E5, E6, E8, E9 in session measures and facts; a worse E6 brings "relax after a squeeze".
  - **Dashboards:** the session's "Muscle sensor" card with traces, EMG trends on Progress, and the EMG level in the Exercise Lab.
- **Task 5: review, smoke test and docs.**
  - **Five fixes** (see [the test report](day-16-test-report.md#review-findings)):
    - the safety answers can no longer be skipped by way of the simulated sensor;
    - the port closes when leaving the session pages or the lab;
    - re-plugging the USB reconnects by itself;
    - a restarted board is started again;
    - the engine refuses the simulated sensor in production.
  - **Smoke test:** a fourth session with an EMG calibration and an EMG Grip and hold run (71 steps).
  - **Docs:** [the hardware test](../emg-hardware-test.md), the API contract's [Muscle sensor (EMG)](../api-contract.md#muscle-sensor-emg) section, the README's hardware section, and the changelog.

## How to test

```powershell
# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a live server with the mock model (two terminals)
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# The app, with the simulated sensor (development build)
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
cd web; npm run dev
```

- **With the simulated sensor:** at setup, turn on **Use the muscle sensor today**; in the EMG step choose the site, then **Use simulated sensor**; hold **M** to squeeze.
- **With the real sensor:** follow [the hardware test](../emg-hardware-test.md).
- **Database:** the new table (`emgcalibration`) and the `trial.emg` column are created on start; existing data is kept.

## Decisions

- **One electrode site per session.** The flexors drive grip, the extensors drive opening, and the other signal stays on the webcam. A second site needs a new session and a new calibration.
- **The camera is always the fallback.** The sensor and the camera both run while the sensor is chosen. A pause (unplugged, an electrode off, more than 1% of the last second's samples lost) switches to the camera at once, and recovery switches back. EMG can never block a session: Skip is on every stage, and every game works without it.
- **Numbers only.** The server gets the calibration's levels in mV and, per trial, a 50 Hz %MVC trace and its measures. The raw 500 Hz signal stays in the browser, like the webcam video.
- **Safety in three places:**
  - the safety answers come before a real sensor can be connected;
  - the server refuses a real sensor's calibration without `battery_ok`;
  - the hardware guide and the test put the laptop on battery and GPIO34 at or below 3.0 V.
- **Leaving the session closes the port and forgets the calibration,** so the next session starts with its own check and calibration.
- **The trial's cues come from the game's own timings:**
  - onset after the activation cue (the dwell's end in Reach and squeeze, the spawn in Grip and hold and Bloom);
  - relaxation after the release cue (activation done; Bloom's close).
- **E9 (fatigue slope)** needs at least 4 sensor trials; E2 is the calibration's MVC, which depends on electrode placement and gain, so it is compared across sessions with care.
- **The Day 14 LLM test set** leaves out the EMG measures, so it stays the set the models were compared on.

## Known issues

- **Not yet run on the real sensor:**
  - the firmware, rates, thresholds, auto-reconnect and games are tested only with mocks and the simulated sensor;
  - [the hardware test](../emg-hardware-test.md) is tonight.
- **The readiness and calibration thresholds** (`web/src/emg/readinessConfig.ts`) are first guesses for the Advancer V3.0. They may need tuning after the hardware test.
- **A refresh during a session** loses the sensor connection and the calibration. Redoing the EMG step in the same session is refused (`409`, one calibration per session), so the games use the camera for the rest of it.
- **`input_source`** is recorded when a game starts. A run started while the sensor was paused says `cv_grip`, although its later trials may carry EMG data.
- **The MDC values of E2–E9 are provisional** until Day 19.
- **The simulated sensor in a production build** can only be turned on through `localStorage` (`muvi-simulated-emg` = `on`); there is no setting in the app.
- **Bangla:** the new EMG strings need a native speaker's review.
