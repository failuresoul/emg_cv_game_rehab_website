# Docs

Project documentation, such as design notes and technical decisions. Daily progress logs are in [day-logs/](day-logs/).

| Document | For |
| --- | --- |
| [Guide for patients](user-guide-patient.md) | Patients and carers: set-up, camera tips, the session steps, the summary and safety |
| [Guide for therapists and researchers](admin-guide.md) | Admins: patients, weekly goals, sessions, progress, alerts and demo data |
| [Demo script](demo-script.md) | A 10-minute supervisor demo, with a backup plan |
| [API contract](api-contract.md) | Every API route, request and response |
| [Adaptive engine and session planner](ai-engine.md) | Researchers: components, the mapping, L1 staircase, L2 Bayesian engine, safety rules, decision log and the session planner (methods) |
| [Simulation results](simulation-results.md) | Researchers: L0, L1 and L2 compared on simulated patients, with ablations |
| [Session facts](session-facts.md) | The facts the LLM feedback module reads for each session |
| [LLM evaluation](llm-evaluation.md) | Researchers: model choice, quality targets and the blind human review |
| [Firmware and hardware guide](../firmware/README.md) | The muscle sensor: parts, wiring, voltage divider, electrodes and the ESP32 firmware |
| [EMG hardware test](emg-hardware-test.md) | The first test of the real muscle sensor, step by step, with a table to fill in |
| [Hardware day](hardware-day.md) | The one-page runbook for the muscle sensor: safety, wiring, step order, troubleshooting |
| [Install](install.md) ([বাংলা](install.bn.md)) | Installing 1.0: Docker and native Windows, troubleshooting |
| [Release notes 1.0](release-notes-v1.0.md) | What is in 1.0 |
| [Known issues](known-issues.md) | The open items at the release candidate |
| [Architecture](architecture.md) | Components, data flow and a session, as diagrams; privacy and safety |
| [Data dictionary](data-dictionary.md) | Every table and field, the metric catalogue and the facts schema (generated) |
| [Methods (draft)](methods-draft.md) | An academic Methods section |
| [Validation](validation.md) | The pilot validation protocol, results, limitations and the EMG validation |
| [Results summary](results-summary.md) | Every number with its label and source (generated) |
| [Model choice](llm-model-choice.md) | The local feedback model and its licence |
| [Testing](testing.md), [Performance](performance.md), [Security](security.md) | How the system is tested, and the results |
| [Pending manual checks](pending-manual-checks.md) | Checks that need a person or a device |
| [Images](images/) | The README's screenshots and diagrams (made by `scripts/docs/make_screenshots.ps1`) |
| [Changelog](../CHANGELOG.md) | What changed in each release |
