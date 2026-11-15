# Known issues (1.0.0-rc1)

These are the open items at the release candidate, collected from the day logs, the reviews and the pending checks. For the checks that need a person or a device, see [pending-manual-checks.md](pending-manual-checks.md).

## Validation and evidence

- **Validation not run yet:**
  - the pilot validation (latency, joint angles, repeatability);
  - the LLM evaluation;
  - the usability test.

  Their results are PENDING ([results-summary.md](results-summary.md)).
- **MDCs:** they are provisional placeholders until the repeatability visits are done. After that they are "measured (n=1, pilot)".
- **Seated repetition counting:** on one recording, the shoulder exercises counted 0 of 3. The seated arm stays above the 30° rest line. The thresholds are to be decided after the validation session.
- **Bangla:** every string and the patient guide need a native speaker's review.
- **The L2 engine:** in simulation it did worse than L1 for moderate and severe patients. L1 is the default.

## Hardware

- **The muscle sensor:** not yet tested with the real ESP32 (Day 21, [emg-hardware-test.md](emg-hardware-test.md)).
- **Refresh in an EMG session:** a refresh during a muscle-sensor session loses the sensor calibration. Calibrate again.
- **Frame rate with the real webcam:** not yet measured on the target hardware. The replay measurements ([performance.md](performance.md)) do not include MediaPipe.

## Security and deployment

- **No HTTPS in the app:** put a reverse proxy with HTTPS in front for any use beyond `localhost`.
- **The login limit:** in memory and per email only. A restart clears it.
- **Tokens:** they cannot be revoked one by one. Deactivating a user stops theirs; changing `JWT_SECRET` ends every login.
- **Fonts:** they load from Google Fonts, so the browser contacts Google (no session data is sent).
- **The Ollama image:** its tag is not pinned (`OLLAMA_VERSION`, default `latest`). Pin it to the version you test with.
- **Development tools:** a moderate advisory (`minimatch`, in the linters) has no safe upgrade yet. It is never in the app.

## Product

- **The tiring rule:** it can fire often on noisy data, and is not tuned on patients.
- **Aborted study sessions:** they are not counted in study results.
- **The engine's decision log:** it is in English in every language (a research record).
