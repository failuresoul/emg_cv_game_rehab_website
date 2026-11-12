# Day 13

**L2, the session planner, and a simulation study.**

- **L2:** a Bayesian, workspace-aware difficulty engine that places each target in a sector of the patient's reach.
- **The planner:** chooses each session's games, with a plain-language reason for each.
- **The simulation study:** compares L0, L1 and L2 on simulated patients, through the same decision code as the app.

## What was built

- **Patient simulator** (`server/app/engine/sim/`):
  - **Patients:** abilities for reach per direction, activation, speed and precision, each a logistic chance of success against the trial's demand. Fatigue within a session, learning between sessions, and compensation beyond the reach. Mild, moderate (two weak directions) and severe profiles.
  - **Runner:** goes through the app's own `decide()` and warm restart, with an in-memory store. A test replays a simulated session through the API and gets identical decisions.
  - **Measures:** rolling success, challenge error, time in the 0.6–0.8 zone, trials to converge, compensation, workspace coverage, learning gain.
- **L2** (`engine/l2_bayes.py`):
  - **Sectors:** 8 directions × rings R1–R3, plus a stretch ring R4 that unlocks per direction. Balloon pop uses the upward directions, Fruit catch its sides, Pick and place its 4 carry directions, Path trace outward and inward. Ring priors are seeded from the calibration and warm-up.
  - **Levels:** 6 per other component, kept monotone by pool-adjacent violators.
  - **Choosing:** Thompson sampling, each part aiming at 0.70^(1/k) so the trial aims at 0.70; a coverage bonus weighted by feasibility; no third repeat; compensation blocks per direction.
  - **Between sessions:** 30% forgetting.
  - **Safety and logging:** the safety layer runs after it unchanged, and the log keeps its samples and target.
  - **The engine interface** gained engine state (`extra`), `new_session()` and `target()`.
- **Simulation study** (`analysis/run_simulation.py`, [results](../simulation-results.md)):
  - 3 profiles × 3 engines × 200 patients × 10 sessions × 40 trials, plus Bloom;
  - L2 ablations;
  - Kruskal–Wallis and Holm-corrected Mann–Whitney U with rank-biserial effect sizes;
  - figures;
  - a report written by `--doc`.
- **Session planner** (`services/planner.py`):
  - **Scoring:** need from each movement's measures, weak directions (L2 beliefs, else trial success per direction), variety, enjoyment, load.
  - **Rules:** Game Library only; one reach or shoulder and one hand game; no adjacent shoulder-heavy games; easiest first, favourite last.
  - **Reasons:** a reason key for each game.
  - **API:** `GET /plan` (made once, kept), `POST /plan/override`, `next_session` in the facts.
- **Web:**
  - the plan page with reasons, a lighter-day note, untick and reorder (recorded) and "Use recommended plan";
  - planned turns per game;
  - games place L2's targets and report where each target was;
  - admin engine selector with confirmation, latest plan with changes, and the L2 sector heat map;
  - "Next time we'll focus on …" on the summary.
- **Demo data:** demo patients on L2, with beliefs, a plan and a recorded change for every session.
- **Review (task 6):** see [the test report](day-13-test-report.md#review-findings).

## How to test

```powershell
# Analysis needs matplotlib (once)
server\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt

# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a running server (start it first in another terminal)
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# Demo data: L2 beliefs, plans and changes (about 17 s)
cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py

# The simulation study (3-5 minutes on 8 workers), and its report
server\.venv\Scripts\python.exe analysis\run_simulation.py --doc docs\simulation-results.md
```

- **Database:** the server adds the new columns on start (`session.plan`, `session.plan_overrides`, `adaptationlog.details`); existing data is kept.
- **Manual checks:** [the checklist in the test report](day-13-test-report.md#manual-checklist).

## Decisions

- **The simulator shares the app's code.** The engine, safety rules, L0 rule, settings and level come from one pure function, `decide()`, so simulation results describe the engines the app runs.
- **Per-part aim.** With failures attributed to the part they point at, each L2 belief is about its own part. Aiming every part at 0.70 would put the trial near 0.70³ ≈ 0.34, so each aims at 0.70^(1/k).
- **Shared blame.** A reach failure in a game with a precision level is shared between the sector and the precision level, because the browser cannot tell "too far" from "too small or brief to hold".
- **The coverage bonus is weighted by feasibility.** Unweighted, it kept pulling patients towards far sectors they failed almost every time.
- **Honest reporting.** The simulation report states that L2 was not better than L1 overall, with likely reasons; nothing was tuned to make L2 win.
- **The plan is a recommendation.** The patient may change it, every change is recorded, and the recommendation is never altered. A plan is never made for a session after it ended.
- **Demo patients play every game,** so the dashboards have data; their recorded change adds the unplanned games to the plan.

## Known issues

- **L2 in simulation:** worse than L1 for moderate and severe patients (slow learning with many independent sectors); see [the results](../simulation-results.md). The quick-run report is a draft until the full study is run.
- **L2's level jumps** from trial to trial, because it follows each chosen sector.
- **Balloon pop under L1:** the fixed rotation sets the balloon's height, overriding the adapted spatial setting, so L1 does not change balloon height (L2 does).
- **The tiring rule** fires often on noisy and synthetic data.
- **The facts' "next session" for an older session** uses today's measures.
- **No admin control** for the maximum difficulty per game.
- **The main web bundle** is about 1.47 MB (the build warns).

## Day 14 preview: the LLM feedback module, part 1

The feedback module (`server/app/feedback/`, built separately from these tasks) starts from the session facts:
- the measures against baseline, the directions and flags;
- the self-report;
- the next session's focus and planned games.

It turns them into a short, plain-language report for the patient, with the safety notice when the session raised one.
