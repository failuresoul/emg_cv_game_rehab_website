# MuVi Rehab 1.0 — release notes (1.0.0-rc1)

MuVi Rehab is home upper-limb rehabilitation after stroke, with a webcam and an optional muscle sensor. It runs on one computer; video never leaves the browser. **It is a research prototype, not a medical device.**

## What is in 1.0

- **A guided session:**
  - a camera check;
  - an optional muscle-sensor check and calibration;
  - an eight-direction reach calibration;
  - a six-exercise warm-up with repetition counting;
  - a plan of games with reasons;
  - the games;
  - a cool-down questionnaire;
  - a summary with a written feedback report.
- **Nine games:**
  - reaching (Reach and squeeze, Balloon pop, Fruit catch, Pick and place);
  - the elbow (Paint the wall);
  - smoothness (Path trace);
  - the hand (Bloom, Finger piano);
  - grip (Grip and hold).
- **Adaptive difficulty:**
  - fixed (L0), a staircase (L1) and a Bayesian engine (L2);
  - a safety layer the engines cannot override;
  - the therapist's caps.
- **Feedback reports:**
  - written by a local model (Ollama) from the session's facts only;
  - checked against the facts;
  - a template when the check fails;
  - English and Bangla.
- **For therapists:**
  - patients and programmes;
  - progress and measures (with MDC-based changes);
  - alerts;
  - research mode (blinded Latin-square studies);
  - repeatability visits;
  - pseudonymous CSV exports.
- **Accessible and bilingual:**
  - English and বাংলা;
  - text size, high contrast, reduce motion, sound and voice settings;
  - keyboard and screen-reader support.

## Installing

See [install.md](install.md) ([বাংলা](install.bn.md)). In short, use Docker with `scripts\start.ps1`, open `http://localhost:8080` in Chrome or Edge, and set a real admin password and JWT secret first.

## New in this release candidate

- **Version:** 1.0.0-rc1 everywhere (the footer, the admin's System page, `GET /api/version`).
- **Production safety:** production refuses to start with the default admin password or JWT secret. Test routes and developer pages are never in production.
- **Docker:**
  - the release `docker-compose.yml`, with the database in a named volume, nginx on 8080 and security headers;
  - Ollama profiles (CPU, NVIDIA GPU), a model pull, host-Ollama and no-model options.
- **Scripts:** start, stop, backup and restore.
- **Dependencies:** pinned exactly; `THIRD_PARTY_NOTICES.md`.
- **Demo data:** four weeks for two demo patients, with reports, left out of research exports; `--reset`.

## Before relying on it

Read [known-issues.md](known-issues.md):

- **Validation is still to run:** the pilot validation, the LLM evaluation and usability are PENDING.
- **The muscle sensor:** not yet tested on real hardware.
- **HTTPS:** needed for any use beyond `localhost`.
