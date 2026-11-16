# Day 20

**Release candidate 1.0.0-rc1: production-safe, documented, and the muscle-sensor path ready without hardware.**

## What was built

- **Task 1: release candidate.**
  - **Version:** 1.0.0-rc1 in `web/package.json`, `server/pyproject.toml` and `app.__version__`; the footer, Admin → System and `GET /api/version`.
  - **Production safety:** the server refuses to start with a default or short admin password or JWT secret; test routes only with `APP_ENV=test`; `/dev` pages only in development builds.
  - **Docker release:** `docker-compose.yml` (named volume, nginx on 8080, Ollama CPU/GPU profiles, model pull, host-Ollama and mock options); `scripts/start.ps1`, `stop.ps1`, `backup.ps1`, `restore.ps1`.
  - **Dependencies and notices:** exact pins; `THIRD_PARTY_NOTICES.md`.
  - **Demo data:** four weeks, left out of exports.
  - **Docs:** install guides (English and Bangla), known issues, model choice, release notes.
- **Responsive layout:** every page at 360, 768 and 1280 px with no sideways scroll, and a bottom tab bar for patients on phones. Checked by `web/e2e/responsive.spec.ts`.
- **Task 2: the EMG path without hardware.**
  - **Protocol agreement:** firmware, browser, mock and docs are checked by tests; a firmware race after `START` was fixed; INFO is sent on connect.
  - **Mock ESP32:** `mockSerial.ts`, with whole-path tests (`hardwarePath.test.ts`).
  - **Board simulation badge**, and the device mode stored with the calibration.
  - **`/dev/emg-monitor`:** a live plot, readiness and "Record 30 s CSV".
  - **EMG settings:** in one spec, with an admin panel and API.
  - **`analysis/emg/emg_validation.py`** and **`docs/hardware-day.md`**.
- **Task 3: README.**
  - **Brought up to date and extended**, with 38 screenshots and 3 diagrams.
  - **Screenshots:** `web/e2e/docs/screenshots.spec.ts` captures them in test mode.
  - **Scripts:** `scripts/docs/make_screenshots.ps1`, `optimise_images.py`, `check_readme_links.py`.
- **Task 4: technical report** (`docs/MuVi_Rehab_Technical_Report.docx`, 63 pages).
  - **Chapters:** 16, each part described as What / How / Why / Alternatives, with file paths.
  - **Q&A:** 68 questions.
  - **Appendices:** generated from the code.
  - **Built by:** `tools/docs/build_report.py`, with one command, `scripts/docs/make_report.ps1`.
- **Task 5: manual testing guide** (`docs/MuVi_Rehab_Testing_Guide.docx`, 23 pages).
  - **Tests:** 130, each with steps, expected result, screenshot, Pass/Fail and notes.
  - **Labels:** looked up by key in `en.ts`.
  - **Built by:** `tools/docs/build_testing_guide.py`, with one command, `scripts/docs/make_testing_guide.ps1`.
- **Task 6: this review.**

## Fixes found along the way

- **About page:** "Personal feedback reports" was still marked "coming soon"; the unused `PlaceholderPage` was removed.
- **Board simulation badge:** it also showed for the browser's own simulated sensor; it now shows only for a real ESP32 in `SIM ON` mode.
- **Login after 5 failed attempts:** the generic error replaced by "Too many attempts. Please wait a moment and try again." (the server's 429).
- **`methods-draft.md`:** warm-up counting uses the median and moving-average filter, not the one-euro filter (cursor and pinch only).
- **Old version mentions:** the admin guide said v0.1, and the API contract's example said 0.1.0. The demo script is labelled as the historical v0.1 demo.

## Review results (task 6)

| Check | Result |
| --- | --- |
| Server with production settings (`APP_ENV=production`, strong secrets, temporary database) | `/api/version`: 1.0.0-rc1, production; `/api/test/reset`, `/llm`, `/seed-session`: 404; admin and EMG settings without a login: 401; security headers present |
| Production refusal of default secrets | `tests/test_release.py` (in the 215 below) |
| Web production build | `scan:bundle` 55 files, 0 findings; `check:csp` 0 violations; no `/dev` page, test hook, test route, save endpoint or mock board in `dist` |
| Secrets in the repository | None: 981 tracked and new text files scanned for keys and tokens; only placeholders and test values; `server/.env`, databases, `tools/docs/.venv` and backups are git-ignored |
| Version | 1.0.0-rc1 in `package.json`, `pyproject.toml`, `__init__.py`, README, CHANGELOG and release notes |
| README, docs index, pending checks, demo script | Every link, image and path exists (`check_readme_links.py`) |
| Technical report | `make_report.ps1`: 63 pages, 22 images, 24 tables, 68 questions, PASS |
| Testing guide | `make_testing_guide.ps1`: 23 pages, 130 tests, 47 images, PASS |
| Server tests | Full suite 1,472 passed (task 2; no server code changed since); production-related suites re-run: 215 passed |
| Web tests | Vitest 1,626 passed (task 5); `tsc` (app and e2e), eslint, Prettier and `i18n:check` clean |
| Docker | `docker compose config` valid (release, GPU profile, development) |
| Playwright | EMG and admin specs 5 passed and 1 flaky (task 2); the responsive spec passed (Day 20); the full project not run |

## Decisions

- **The documents are generated from the code:** the report and the guide read the specs, strings, settings and results, so a rebuild keeps them true. A missing string key stops the guide's build.
- **The docs tool environment** (`tools/docs/requirements.txt`, python-docx) is separate from the server's dependencies.
- **EMG recordings are committed with the analysis data**, like the other validation inputs. They must be labelled with patient codes, never names.

## Found for you

- **Your local `server/.env` has an old `APP_NAME`**, so `/api/health` shows the code name. Set `APP_NAME=MuVi Rehab` (item 1 in `pending-manual-checks.md`).

## Open

See the ordered list in [pending-manual-checks.md](../pending-manual-checks.md): the manual testing guide, a full automated run with the Playwright full project, the model's licence, the Bangla review, the real muscle sensor (Day 21), the validation and repeatability sessions, the LLM evaluation, usability, then v1.0.0.
