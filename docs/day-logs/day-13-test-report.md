# Day 13 test report (L2, the planner and the simulation study)

Date: 2026-11-13. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 1,203 passed (106 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with the chunk size warning (1,495 kB, 426 kB gzipped) |
| `pytest` | 841 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **99%** of 6,544 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 60 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |
| `analysis/run_simulation.py --quick` | Runs in 0.5 minutes and writes every output (tested); **the full study has not been run yet** |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/engine/sim/patient.py`, `measures.py` | 100% |
| `app/engine/sim/runner.py` | 98% |
| `app/engine/l2_bayes.py` | 97% (defensive fall-backs: no allowed sector, a game without lanes) |
| `app/services/planner.py` | 99% |
| `app/services/adaptation.py` | 98% |
| `app/services/engine_store.py`, `app/engine/base.py`, `safety.py` | 100% |

## Day 13 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| The simulator drives the real engines | pytest: `test_the_simulator_and_the_api_make_the_same_decisions` (L1), `test_the_simulator_and_the_api_agree_for_l2`, `test_the_simulator_runs_the_apps_own_decision_function` | PASS | A replay through the API gives identical settings, levels, cues and reasons |
| Simulator determinism, fatigue, learning, measures | pytest: `test_sim.py` (20 tests) | PASS | |
| L2: Beta updates, ring priors, stretch unlock, Thompson near the aim, no third repeat, blocked sectors, monotone levels, forgetting | pytest: `test_l2.py` (30 tests) | PASS | |
| L2 always passes through the safety layer | pytest: `test_every_l2_decision_in_the_app_goes_through_the_safety_layer`, `test_three_failures_ease_an_l2_target`, `test_l2_targets_never_pass_the_patients_maximum`, `test_the_safety_layer_still_caps_everything` | PASS | Only the simulator can switch the layer off, for ablations |
| Every engine decision is logged | pytest: `test_every_engine_decision_is_logged_with_its_samples`; `test_every_engine_call_writes_exactly_one_log_row` | PASS | L2 rows keep samples and target |
| L2 responds within 100 ms | pytest: `test_an_l2_decision_takes_well_under_100_ms` (at most 20 ms; about 1 ms typical), API 95th percentile under 100 ms | PASS | |
| Plans only include enabled games and always satisfy the rules | pytest: `test_disabled_games_are_never_planned`, `test_the_rules_hold_for_many_histories` (40 random histories, random games turned off) | PASS | |
| Different histories give different plans; fatigue lightens; determinism | pytest: `test_planner.py` | PASS | |
| No plan after a session ended | pytest: `test_no_plan_is_made_after_the_session_ended` | PASS | Fixed in this review |
| The patient can always change the plan | pytest: `test_the_patient_can_always_change_the_plan` (one game, all reordered, games added), `test_patient_changes_to_the_plan_are_recorded` | PASS | The recommendation is kept unchanged |
| Reasons make no medical claims, never say "AI" | Vitest: `no medical claims` (every reason and plan message, English and Bangla) | PASS | New in this review |
| `next_session` in the facts after the session ends | pytest: `test_the_facts_carry_the_next_sessions_plan`; smoke test | PASS | |
| The simulation study writes every output | pytest: `test_quick_run_writes_every_output` | PASS | |
| Demo patients use L2 with beliefs, plans and changes | pytest: `test_seed_demo_data.py` | PASS | |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| `GET /plan` made and stored a plan for a session that had already ended (for example an admin opening an old session), from later measures | Medium | Fixed: plans are made only for active sessions; others get `404` |
| Two accessibility tests (Day 12) had a control character instead of `\b` in a regular expression: weaker alt-text checks, and lint failed | Low | Fixed |
| L2 is worse than L1 for moderate and severe simulated patients | — | Reported in [simulation-results.md](../simulation-results.md) and [ai-engine.md](../ai-engine.md); not a code fault |
| Balloon pop under L1 never changes balloon height (the rotation overrides the adapted setting) | Low (since Day 12) | Known issue; not changed in a review |
| L2's level moves with each chosen sector | Low | Known issue |

## Smoke test against a live server

Not run in this review; run it yourself:

```powershell
# Terminal 1
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
# Terminal 2
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 60 lines starting with PASS, then "All steps passed", exit code 0. The new steps:

- `PASS  Admin switches the patient to the Bayesian engine (L2)`
- `PASS  Patient gets today's plan, with a reason for each game`
- `PASS  Patient's change to the plan is stored`
- `PASS  L2: a run returns sectors and its beliefs update`
- `PASS  Facts plan the next session once this one ends`

## Manual checklist

Seed the demo data first (`cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py`), then start the server and the web app.

### Plans and reasons

- [ ] **Plan differences between the demo patients:**
  - Log in as Demo Rahim, start a session and reach the plan step; note the games and reasons. Do the same as Demo Salma.
  - The plans differ, each with 3 or 4 games and at least one reach or shoulder game and one hand game.
  - If the patient's last session was hard (fatigue 7 or more, "too hard", or pain), the plan shows "A lighter session today" with 3 games.
- [ ] **Reasons:**
  - Every planned game shows a lightbulb line in plain words, such as "Your hand opening has improved less than your other movements — let's focus on it" or "Reaching up is a little harder for you — this game practises it gently".
  - No medical claims and no "AI".
- [ ] **Override and restore:**
  - Untick one game and move another up: "Use recommended plan" appears.
  - Press it: the plan's order and ticks come back.
  - Change the plan again and press Start: in Admin → that patient → Overview → Latest plan, "The patient's changes" lists what was unticked, added or reordered.
- [ ] **Planned turns:** a planned game plays the number of turns the plan card showed (the turn counter in the game's top bar).

### L2 in the games

- [ ] **Targets near your limit:**
  - Set your own test patient to L2 (Admin → patient → Overview → Difficulty engine → Bayesian (L2) → Change engine → confirm), calibrate, and play Reach and squeeze.
  - Targets come in chosen directions rather than a strict rotation, mostly within your reach. After a few failures in one direction, that direction's far targets come less often.
  - In the browser's network tab, each `/api/engine/next` answer has `direction_deg`, `distance_frac` and `sector`.
- [ ] **Other games:**
  - In Balloon pop, balloons rise only up-and-out, up or up-and-across.
  - In Fruit catch, fruit falls on the side and at the distance chosen.
  - Pick and place and Path trace still play normally.
- [ ] **Heat map:**
  - Admin → that session → the Reach and squeeze card shows a sector map under the Adaptation panel: pale (less likely) to teal (more likely) sectors, numbers for trials learned from, and orange dots for the targets chosen (darker later).
  - Hovering a sector shows its chance and trials.
- [ ] **Engine selector:** changing the engine needs the confirmation dialog, and applies from the next game.

### Summary and simulation

- [ ] **Next-session focus on the summary:** finish a session (through the cool-down). The summary shows "Next time we'll focus on …" in plain words, such as "opening your hand and reaching up".
- [ ] **Simulation figures:**
  - Run `server\.venv\Scripts\python.exe analysis\run_simulation.py --doc docs\simulation-results.md` (3–5 minutes) and open `docs/simulation-results.md` in VS Code's Markdown preview.
  - The "Quick run" banner is gone; the tables say 200 patients (50 for Bloom).
  - All figures show, with readable legends and visible error bars.
  - The interpretation states honestly how L2 compared with L1.
