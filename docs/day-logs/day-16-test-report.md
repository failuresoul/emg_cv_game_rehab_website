# Day 16 test report (the muscle sensor)

Date: 2026-11-14. Nothing in this report failed at the end of the review. **MANUAL** means a person still has to check it; it has not been confirmed yet. **HARDWARE** means it waits for the real sensor ([the EMG hardware test](../emg-hardware-test.md), tonight). Serial ports and hardware are mocked in every automated test.

## Automated results

| Check | Result |
| --- | --- |
| `pytest --cov=app --cov=scripts` | 1,143 passed, 1 warning (`httpx` deprecation); **99%** of 8,793 statements |
| `npm test` (Vitest) | 1,392 passed (125 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with the chunk size warning (1,643 kB, 464 kB gzipped) |
| `scripts/smoke_test.py` | 71 steps pass in-process under `pytest`; **not yet run against a live server** |
| Firmware (`emg_stream.ino`) | Checked by `tests/test_emg_firmware.py` (structure, protocol, the sampling task); **not compiled here**. HARDWARE |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/models/emg.py`, `app/schemas/emg.py`, `app/services/emg.py` | 100% |
| `app/services/session_metrics.py` (E2–E9), `app/core/mdc.py`, `app/feedback/names.py`, `app/models/game.py` | 100% |
| `app/api/admin.py`, `app/api/patient.py` | 100% |
| `app/services/session_facts.py`, `app/feedback/rules.py`, `app/schemas/game.py`, `scripts/smoke_test.py` | 99% |
| `app/api/sessions.py`, `app/services/games.py` | 96% |

## Day 16 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| The safety stage cannot be skipped with a real sensor | Vitest `emgFlow.test.ts`: each missing answer keeps the safety stage; a real sensor connected after choosing the simulated one goes back to it; the simulated sensor alone needs no answers. pytest: a real sensor's calibration without `battery_ok` is `422`; smoke step "A real sensor's calibration on mains power is refused" | PASS | Fixed in this review (see below) |
| The readiness check must pass before calibration | Vitest: `ready` is refused before the test squeeze passed, or outside the check stage; rest and attempts cannot start before; `readiness.test.ts` (items green for 2 s, latch, squeeze) | PASS | New tests in this review |
| EMG never blocks a session | Vitest `emgSource.test.ts`: the input manager falls back to the camera on electrode-off, disconnect, no samples and > 1% gaps, and recovers; the camera runs alongside. Code review: Skip on every stage of `/session/emg`; the step only appears when chosen at setup | PASS | |
| The sensor comes back after re-plugging | Vitest `serial.test.ts`: replug events only after a lost port; the engine reopens, pings, starts and keeps the calibration. `engine.test.ts`: a restarted board is started again | PASS (mocked); HARDWARE | Fixed in this review |
| The sampling task never prints | pytest `test_the_sampler_runs_on_core_0_and_never_prints_or_allocates`, now also covering `readMillivolts` and `simulatedMillivolts` | PASS | Extended in this review |
| The serial port is closed when leaving pages | Code review and fix: the session layout closes it on leaving the session pages (Exit, end, Back) and forgets the calibration; `/dev/emg-lab` closes it on leaving; the app root closes it on unload | PASS; MANUAL | Fixed in this review |
| The simulated sensor is unavailable in production unless enabled | Code review: its buttons and `/dev/*` routes exist only with `import.meta.env.DEV` or `muvi-simulated-emg` = `on`. Vitest: the engine refuses it in a production build | PASS | Engine guard added in this review |
| No raw video; EMG only as numbers | Code review: the only frame read (`getImageData`) is a local brightness check; nothing uploads frames. pytest: `TrialEmg` and `EmgCalibrationCreate` forbid extra fields; a trace over 1500 points or %MVC over 120 is `422`; smoke step "The session facts hold the EMG measures, without traces" | PASS | |
| %MVC → level, smoothing, trace cap, EMG metrics on synthetic traces | Vitest `emgSource.test.ts`, `trialEmg.test.ts` (onset, offset, blips under 50 ms, band, steadiness, 1500-point cap) | PASS | |
| E-measures, facts, RELAX_AFTER_SQUEEZE from E6 | pytest `test_emg_metrics.py`; smoke steps "The session metrics hold E2, E3, E5, E6, E8 and E9" (E2 = MVC, E3 = 3 of 4, E9 = −5) and the facts step | PASS | |
| Rates, thresholds, games and fallback with the real sensor | [EMG hardware test](../emg-hardware-test.md) | **HARDWARE** | Tonight |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| Choosing the simulated sensor skips the safety questions (as designed), but the check stage still offered **Connect sensor** for a real one. A real sensor could then be calibrated without the safety answers. The server's `battery_ok` rule only refused the save at the end | High (safety) | Fixed: the real Connect is hidden after choosing the simulated sensor; the flow sends a real connection back to the safety stage; going on without the simulated sensor forgets it. Tests added |
| The serial port stayed open after leaving the session pages or `/dev/emg-lab` (the engine lives at the app root), and the day's calibration stayed for the next session | Medium | Fixed: leaving the session pages closes the port and clears the calibration and site; leaving the lab closes the port |
| After the USB was unplugged in a game, the sensor never came back without a click (only the lab had Reconnect), so the game stayed on the camera, against task 4's "switches back automatically" | Medium | Fixed: on the browser's `connect` event after a lost port, the engine reopens the same port (no chooser) after 500 ms, pings and starts; the calibration is kept. Tests added |
| A board that restarts after `START` (on re-plugging, or if opening the port resets it) sends its start-up line with `streaming=0` and would never stream | Medium | Fixed: the engine remembers that it asked for streaming and sends `START` again on that line; not after `STOP`. Tests added |
| The simulated sensor was gated only in the UI; `engine.connectSimulated()` accepted it in any build | Low | Fixed: the engine refuses it unless allowed. Test added |
| The firmware test checked only the sampling task's own body, not the helpers it calls for each sample | Low | Test extended; no fault found |
| A refresh during a session loses the sensor and its calibration, and the EMG step cannot be redone in that session (`409`) | — | Known issue; the games use the camera. For Day 18 |
| The readiness and calibration thresholds are untested on the real sensor | — | The hardware test |

## Smoke test against a live server

Not run in this review; run it yourself, with the mock model so the reports take seconds:

```powershell
# Terminal 1
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
# Terminal 2
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 71 `PASS` lines, then `All steps passed`, exit code 0. The new steps are:

- "Patient starts a fourth session, with the muscle sensor"
- "A real sensor's calibration on mains power is refused"
- "Patient saves an EMG calibration with its readiness results"
- "Patient plays Grip and hold with input_source emg and EMG data"
- "The session metrics hold E2, E3, E5, E6, E8 and E9"
- "The session facts hold the EMG measures, without traces"

## Manual checklist

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1 | Session with the simulated sensor (development build): choose flexors, **Use simulated sensor**, hold **M** in the check and calibration | The nine items go green, calibration saves | MANUAL |
| 2 | Same session: on the check stage, is **Connect sensor** shown? | No (only after going back and answering the safety questions) | MANUAL |
| 3 | Grip and hold with the simulated sensor | Badge "Muscle sensor", no "Using hand closing…" note, the kite follows **M** | MANUAL |
| 4 | Admin → that session | "Muscle sensor" card with traces and onset/offset lines; E-measures listed | MANUAL |
| 5 | Exit the session, open `/dev/emg-lab`, Connect | No "port busy" error | MANUAL (real sensor) |
| 6 | The [EMG hardware test](../emg-hardware-test.md), steps (a)–(j) | Every row filled in | **HARDWARE** |
