# Day 18

**Testing day: everything can be tested without a webcam, a muscle sensor or a language model.**

## What was built

- **Task 1: test infrastructure.**
  - **Recording:** the landmark recorder in the Exercise Lab.
  - **Replay:** the replay camera (`?replay=<name>` in test mode).
  - **Synthetic movements:** the generator (`src/testing/synthLandmarks.ts`), with a script format.
  - **Test hooks:** `window.__muviTest` gives the game's target, the simulated sensor's level and the strings.
  - **Server routes:** `APP_ENV=test` adds `/api/test/reset`, `/seed-session` and `/llm`.
  - **Playwright:** its configuration.
- **Extra: the guided recorder.** `/dev/record-guide` records ten timed steps with markers and saves the file straight into the test fixtures. Your recording, `shadik_full.json`, was made with it.
- **Task 2: end-to-end suites.** Auth, admin, the patient's session, EMG, resilience, Bangla, research and privacy.
  - **Projects:** fast (by default) and full.
  - **Check script:** `scripts/check.ps1 -E2E`.
- **Task 3: coverage and performance.**
  - **Coverage:** every target was met.
  - **API contract:** a test checks the routes against `docs/api-contract.md`, and 18 missing routes were documented.
  - **Performance:** the scripts and `docs/performance.md`.
  - **Indexes:** four were added.
- **Task 4: security review.** See [docs/security.md](../security.md):
  - a login rate limit;
  - request size and depth limits;
  - security headers and a CSP;
  - safe errors;
  - SQLite busy timeout and WAL.
- **Task 6: this review.** `docs/testing.md`, and a production-build scan that now also covers the developer pages and test routes.

## Found and fixed by the tests

- **Mock reports:** the mock model never produced a valid report, so every report used the template. On the test server it now writes valid reports.
- **Simulated sensor:** its rest was too flat for the calibration's rest check, so calibrating with it always failed. It now has a slow resting wander.
- **Vision engine:** a cancelled test-mode start could leave it stuck on "Waiting for your camera". Fixed.
- **Security gaps:** no login rate limit, no request size or depth limits, no security headers, and no safe answer for unexpected errors (see the security review).

## Decisions

- **No hardware in automated tests.** Real EMG hardware is tested on Day 21 (`docs/emg-hardware-test.md`).
- **Test-only code stays out of production.** It exists only in a development build with `VITE_TEST_MODE=true` and on a server with `APP_ENV=test`; the scans and a pytest prove it.
- **The server never repeats a request on "database locked".** It answers 503, and the browser retries.

## Open issues for Days 19–21

- **Day 19, validation and docs:**
  - **Never run:** the Playwright full project, and `check.ps1 -E2E` end to end.
  - **Usability test:** 3–5 volunteers in both languages, with the System Usability Scale.
  - **Native-speaker review:** the Bangla strings and the patient guide.
  - **Manual checks:** the large-text and high-contrast checks by eye, still open from Day 17.
- **Day 20, release v1.0:**
  - **Fonts:** self-host them (they still load from Google), or accept and document it.
  - **HTTPS:** set up an HTTPS reverse proxy for any use beyond one computer.
  - **Dev tools:** the moderate `minimatch` advisory in the linters, once upstream fixes it.
- **Day 21, hardware:**
  - **EMG hardware:** the real ESP32 test (`docs/emg-hardware-test.md`).
  - **Real camera:** the frame budget with the real webcam and MediaPipe.
- **Known limits:**
  - **Login limit:** in memory and per email only.
  - **Tokens:** they cannot be revoked one at a time.
  - **Sensor calibration:** a refresh during a muscle-sensor session still loses it (from Day 16).
