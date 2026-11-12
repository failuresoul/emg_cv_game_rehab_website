# The adaptive engine and the session planner

How MuVi Rehab sets each trial's difficulty, keeps it safe and explains every change, and how it plans each session's games. Written for the research paper: the numbers below are the ones in the code (`server/app/engine/`, `server/app/services/adaptation.py`), and each claim names the test that checks it.

## Principles

1. **Bounded.** The engine never sets a value outside the game's spec bounds or above the maximum difficulty a therapist sets for the patient.
2. **Safety wins.** A safety layer runs after every engine decision and can block or reverse it. The engine never sees or overrides the safety rules.
3. **Explained.** Every decision is logged with a reason in plain words, the state before and after, and any safety override.
4. **Gentle for patients.** Patients see only a level from 1 to 10 and, sometimes, a short cue ("Let's take a short rest"). The word "AI" and the reasons are for therapists and researchers.

## Difficulty components

Each game's adaptable settings are grouped into up to four **components**. One number per component, **d ∈ [0, 1]** (0 easiest, 1 hardest), moves all the settings of that component together.

| Component | What it makes harder |
| --- | --- |
| `spatial` | How far, how high or how wide the movement must go |
| `activation` | How strong, long or complete a squeeze or hand opening must be |
| `speed` | How little time there is |
| `precision` | How small or exact the target is |

The grouping is part of each game's spec (`web/src/games/*/params.ts`, exported to `shared/game-specs.json`). Settings marked `fixed` (for example rest times, the number of turns) are never adapted.

| Game | spatial | activation | speed | precision |
| --- | --- | --- | --- | --- |
| Reach and squeeze | `distance_frac` | `activation_demand`, `activation_window_ms` | — | `target_radius_sw`, `dwell_ms` |
| Balloon pop | `height_frac` | `activation_demand` | `hover_ms` | `balloon_radius_sw` |
| Fruit catch | `spread_frac` | — | `fall_speed_sw_s`, `spawn_interval_ms` | `basket_width_sw` |
| Bloom | — | `open_demand`, `open_hold_ms`, `close_demand` | `phase_time_limit_ms` | — |
| Finger piano | — | — | `note_interval_ms`, `hit_window_ms` | `finger_count`, `sequence_length`, `touch_threshold` |
| Path trace | `path_length_frac`, `ring_frac` | — | `guide_speed_sw_s` | `corridor_width_sw` |
| Paint the wall | `required_range_frac` | `sweeps_needed` | `time_limit_ms` | — |
| Pick and place | `pick_distance_frac`, `place_distance_frac`, `carry_angle_deg` | — | `time_limit_ms` | `object_radius_sw`, `box_size_sw` |
| Grip and hold | — | `band_center`, `hold_ms` | `time_limit_ms` | `band_width` |

## From d to a setting

Each adaptable setting has spec bounds `min`, `max`, a `step` and a direction `harder` (`higher` or `lower`). Its **easy** end is the bound on the easier side, and its **hard** end the other:

```
value(d) = snap(easy + d · (hard − easy))
```

`snap` rounds to the setting's step from `min` and keeps the result within `[min, max]`. So for any d, every setting is inside its spec bounds (`test_engine.py::test_values_are_rounded_to_the_step_and_kept_in_bounds`).

**Starting point.** A patient's first state is the d of each component that reproduces the admin's default settings: the mean of the inverse mapping `d = (value − easy) / (hard − easy)` over the component's settings. A component with several settings reproduces each default only approximately (for example Reach and squeeze's dwell time of 500 ms becomes 550 ms), so the very first trial of a run uses the admin's defaults exactly and the engine takes over from the second.

**Level.** Patients see `level = 1 + floor(9 · mean(d) + 0.5)`, from 1 (all easiest) to 10 (all hardest).

## Engines

Every engine implements one interface (`server/app/engine/base.py`):

| Method or field | Purpose |
| --- | --- |
| `name` | `L0`, `L1` or `L2`, stored with the state and every decision |
| `adapts` | Whether the settings ever change |
| `new_session(state, context)` | The stored state at the first use in a new session: L1's warm restart, L2's forgetting |
| `target(state, context)` | Where the next target goes (L2, spatial games), or none |
| `initial(context)` | The state that reproduces the admin's defaults, capped at the patient's maximum |
| `update(state, trial, context)` | The state after a trial's outcome, with the reason |
| `next_params(state, context)` | Every setting for the next trial, within the spec bounds and the maximum |

The context holds the game spec, the admin's current settings for it and the patient's maximum difficulty for the game.

### L0: fixed settings

Always the admin's defaults; nothing adapts. The safety layer's cues (rest, finish) still reach the patient, but nothing is eased, and the level never moves (`test_engine_review.py::test_l0_patients_get_exactly_the_admin_defaults_and_a_steady_level`).

### L1: transformed up-down staircase

A staircase per component, after Levitt's transformed up-down method:

> Levitt H (1971). Transformed up-down methods in psychoacoustics. *Journal of the Acoustical Society of America* 49(2B):467–477. https://doi.org/10.1121/1.1912375

Levitt's 2-down-1-up rule (here, two successes make it harder, one failure makes it easier) converges on the level at which the probability of two successes in a row is 0.5, that is about **70.7% success**. L1 uses a larger step down than up:

| Constant | Value |
| --- | --- |
| Successes in a row to step up | 2 |
| Step up | 0.06 (one component) |
| Step down | 0.08 (the component the failure points at) |

With unequal steps the equilibrium moves (the weighted up-down idea of Kaernbach, *Perception & Psychophysics* 49:227–229, 1991). In simulation, a patient of fixed ability settles at about **75% success**, inside the 60–80% band commonly aimed for in motor practice. The larger step down also means one failure eases things quickly (`test_engine.py::test_a_simulated_patient_settles_between_60_and_80_percent`).

**Which component moves.**

- **After two successes:** the component with the most room left below the patient's maximum. Components with equal room take turns.
- **After a failure:** the one it points at, routed by the trial's failure type:

  | Failure type | Eases, in order of preference |
  | --- | --- |
  | `reach_fail` (did not get there) | spatial, then precision |
  | `activation_fail` (could not squeeze, open or hold enough) | activation |
  | `miss` (too slow or off target) | speed, then spatial |
  | other, or none of those left to ease | every component by half a step (0.04) |

- **A stopped (aborted) trial** changes nothing.

The browser works out each trial's failure type from the game's own outcome (`web/src/ai/trialSummary.ts`); the server has the same mapping for replayed data (`server/app/engine/trial_summary.py`).

**Warm restart.** The first time a game is played in a new session, every d is eased by 0.05 (not below 0), so a day never starts at the very edge of what the patient managed last time. It happens once per session per game: a second run of the same game in the same session carries on where the first ended (`test_engine_review.py::test_the_warm_restart_happens_once_per_session_and_game`).

### L2: Bayesian, workspace-aware (`server/app/engine/l2_bayes.py`)

L2 keeps beliefs about the chance of success and chooses the next trial by Thompson sampling. It implements the same interface as L0 and L1. The safety layer runs after it unchanged, and every decision is logged the same way, with its samples in the log's `details`.

**Workspace sectors.** These apply to spatial games whose targets have a direction:
- Reach and squeeze uses all 8 directions.
- Balloon pop uses only the upward directions (45°, 90° and 135°).
- Pick and place uses its four carry directions (0°, 90°, 180°, 270°).
- Path trace uses outward (0°) and inward (180°).
- Fruit catch uses its two sides, "out" and "across".

Each direction (or side) has rings of the target's distance fraction:

| Ring | Distance fraction | Prior Beta(α, β) |
| --- | --- | --- |
| R1 | 0.40–0.55 | (4, 1) |
| R2 | 0.55–0.85 | (3, 2) |
| R3 | 0.85–1.00 | (2, 2) |
| R4 (stretch) | 1.00–1.10, where the game allows it | (1, 3) |

R4 opens in a direction once that direction's R3 has a posterior mean above 0.8 from at least 5 trials. The priors are nudged by the patient's latest calibration (a direction under 75% of the median reach: R2–R4 0.1 less likely) and warm-up (forward-reach completion moves R3–R4 by up to ±0.1; a compensation rate of 0.3 or more takes 0.05 off).

**Levels.** Every other component (and every component of a game without directions) has 6 levels, d = 0, 0.2, …, 1, each with its own Beta:
- The priors fall from easy to hard, centred on about 0.7 success at the admin's default level.
- The warm-up's hand opening and closing moves the activation priors by up to ±0.1.
- After each update, a pool-adjacent-violators pass keeps the means monotone: an easier level is never less likely than a harder one.

**Updates.**
- A success adds 1 to α of the sector and of every level used.
- An activation failure counts only against the activation level, and a miss against the speed level (else the sector). Neither touches the spatial beliefs.
- A reach failure counts against the sector. In games with a precision level it may have been too far *or* too small or brief to hold, so its 1 is shared between the sector's β and the precision level's, in proportion to how likely each was to fail.
- The trial reports where its target was (`direction_deg`, `distance_frac`, `side`), so L2 credits the sector actually played; without them it credits its own choice.

**Choosing.**
- The trial aims at p* = 0.70. A trial succeeds only when every chosen part does, and each belief is about its own part, so each of the k parts aims at 0.70^(1/k) (0.89 for Reach and squeeze's sector and two levels).
- **Sector:** draw θ from every allowed sector and take the best score −|θ − aim| + 0.05 × min(2, trials since last chosen / 10) × the sector's posterior mean. Weighting the coverage bonus by the mean means it favours sectors the patient can plausibly do; unweighted, simulation showed it kept pulling patients to far sectors they almost always failed.
  - No sector is chosen more than twice in a row.
  - In a direction with 2 of the last 3 trials compensated, the ring of those trials and every farther ring (never R1) are left out.
  - The distance is a random setting value inside the sector.
- **Levels:** for each component, the level whose draw is closest to the aim.
- The choice becomes the state's d, so the safety layer checks it as for any engine. If it eases the spatial d, the target's distance and ring follow.
- Random draws are seeded by the engine's seed and the number of choices made, so the same state always gives the same choice.

**Between sessions** the beliefs forget 30%: α ← prior + 0.7 (α − prior), and the same for β.

**In formal terms.**
- For each allowed sector s with posterior Beta(α_s, β_s), L2 draws θ_s ~ Beta(α_s, β_s) and chooses
  s* = argmax_s [ −|θ_s − a| + w · min(2, Δ_s / 10) · α_s / (α_s + β_s) ],
  where a = p*^(1/k) is the per-part aim, w = 0.05 and Δ_s the trials since s was last chosen. This is Thompson sampling (Thompson 1933; Russo et al. 2018) aimed at a target success rate rather than at the most likely success.
- For each level component it draws θ_ℓ ~ Beta(α_ℓ, β_ℓ) for every level ℓ and takes argmin_ℓ |θ_ℓ − a|.
- The monotone constraint is isotonic regression by pool-adjacent violators (Ayer et al. 1955) on the posterior means μ_ℓ = α_ℓ / (α_ℓ + β_ℓ), weighted by n_ℓ = α_ℓ + β_ℓ, keeping each n_ℓ.
- Forgetting is α ← α₀ + γ(α − α₀), β ← β₀ + γ(β − β₀), with γ = 0.7.

**How it compared in simulation.** On simulated patients ([docs/simulation-results.md](simulation-results.md)), L2 kept mild patients closer to the 70% target than L1. It was further from the target than L1 for moderate and severe patients, mainly because 24–32 independent sector beliefs learn slowly in 40-trial sessions. The ablations there show the effect of each part. L2 is therefore offered alongside L1, not as its replacement.

## The safety layer

`server/app/engine/safety.py::apply_safety` runs after every engine decision, with the state before and the engine's proposal. The rules apply in this order (`test_safety.py::test_rules_apply_in_order_and_the_most_important_cue_wins`):

| # | Rule | Condition | Effect | Cue |
| --- | --- | --- | --- | --- |
| 1 | Hard bounds | Any d outside [0, max] | Clipped to [0, the patient's maximum] | — |
| 2 | Compensation | 2 of the last 3 trials compensated (trunk lean, shoulder hike) | No spatial component may get harder; spatial stays where it was | `posture` |
| 3 | Repeated failure | 3 failures in a row | Every component 0.15 easier | `encourage` |
| 4 | Tiring | Comparing the last 5 trials of the run with its first 5 (needs 10): any of the three signs below | Every component 0.1 easier; at most once every 5 trials | `rest` |
| 5 | Session time | Active play over 25 minutes; over 35 | Nothing eased | `finish_soon`; `finish` |

The three signs of tiring are:
- the success rate falls by 0.4 or more;
- the median movement (or completion) time rises by more than 30%;
- the median activation peak falls by more than 20%.

The time limits come from the server's environment (`SESSION_FINISH_SOON_MIN`, `SESSION_FINISH_MIN`), so they can be lowered for testing.

Every rule that changes or blocks something writes a reason to `safety_override`. When several rules give a cue, the most important is sent, in this order: `finish`, `rest`, `finish_soon`, `encourage`, `posture`.

Rules 2–4 only ever ease or hold, never make harder, so after rule 1 every d stays within the bounds. A random-play test drives every game for 120 trials at maximum difficulties 1, 0.6, 0.25 and 0. It checks every d and every setting after each trial (`test_engine_review.py::test_random_play_never_leaves_the_spec_bounds_or_the_maximum`).

## The decision log

Every call to the engine writes exactly one `AdaptationLog` row (`test_engine_review.py::test_every_engine_call_writes_exactly_one_log_row`):

| Field | Meaning |
| --- | --- |
| `game_run_id`, `trial_no` | The run, and the trial the decision came after (0 for the start); unique together |
| `engine` | `L0`, `L1` or `L2` |
| `state_before`, `state_after` | `{d, streak, turn}` before the trial and after the engine and the safety layer |
| `params` | The settings sent for the next trial |
| `decision` | The engine's reason with its numbers, for example "Two successes in a row: spatial a little harder (0.52 → 0.58)." |
| `safety_override` | What the safety layer changed or blocked, or empty |
| `cue` | The cue sent, or empty |
| `trial` | The trial summary the engine learned from |
| `created_at` | When |

**How the log is written:**
- The state and the log row are saved in one transaction.
- Reporting the same trial again returns the stored answer and writes nothing, even when two copies arrive at once (`test_the_same_trial_reported_twice_at_once_gives_one_answer`).
- Admins see the log as a chart and a table on the session page, and each patient's current level per game on the patient page.

## Runtime

- **Endpoint:** `POST /api/engine/next` (see the [API contract](api-contract.md#adaptive-difficulty)).
- **State:** the patient's state per game and engine is kept in `EngineState`, with the session it was last used in.
- **Speed:** a call takes well under 100 ms on a laptop (`test_engine_api.py::test_fast_enough_for_every_trial`).
- **The browser never waits for the server.**
  - The next trial always starts from the settings already known.
  - The answer is applied when it arrives.
  - Without an answer within 300 ms, or on an error, the previous settings stay and a fallback is counted (`web/src/ai/remoteProvider.ts`).
  - Answers from an earlier run, or older than one already applied, are ignored.

## The session planner (`server/app/services/planner.py`)

The planner chooses the session's games and their order, and gives each a reason.
- **When:** it runs once per session, when the patient reaches the plan step, and the plan is kept with the session. It never makes a plan for a session that has already ended.
- **Inputs:** the patient's completed sessions before this one.
- **Facts:** after a session it also plans the next one, for the session facts (`next_session`).

**Score.** Each game the Game Library has turned on gets

score = need + 0.4·[weak direction] + 0.3·[variety] − 0.6·[third session in a row] + 0.15·success + 0.1·enjoyment + ε

| Term | Definition |
| --- | --- |
| need | The most needy of the game's movement measures against the baseline: worse 1.0; no detectable change 0.7 when other measures improved, else 0.4; no baseline 0.3; improved 0. Reach: K1, K6, K7 (Reach and squeeze, Fruit catch, Pick and place); shoulder: R1, R2 (Balloon pop); elbow: R3 (Paint the wall); hand opening: H1, H6 (Bloom); fingers: H2 (Finger piano); grip: H3, H4 (Grip and hold); smoothness: K8 (Path trace) |
| weak direction | A reach direction whose success is ≥ 0.15 below the patient's average in their L2 beliefs, or ≥ 0.2 below in the last 3 sessions' reach trials; for games that can place it |
| variety | Not played in the last 2 sessions |
| third session in a row | Played in both of the last 2 sessions |
| success | The game's success rate over the last 3 sessions (0.6 when unknown); doubled on a lighter day |
| enjoyment | The mean enjoyment rating (1–5, scaled to −1..1) of recent sessions that included the game |
| ε | A tie-break below 10⁻⁶ from a hash of the patient, the session and the game, so the same inputs give the same plan |

**Load.** After a session with fatigue ≥ 7, "too hard", or a pain flag, the plan has 3 games and about 12 minutes. Otherwise it has 4 games and 16–18 minutes; trials are scaled to fit, within 5–40 per game.

**Rules,** applied after choosing the highest scores:
1. Only games turned on in the Game Library.
2. At least one reach or shoulder game and one hand, finger or grip game, when any is turned on.
3. No two shoulder-heavy games (Balloon pop, Path trace, Fruit catch) next to each other.
4. The easiest game (highest recent success) first and the most enjoyable last, when the other rules allow. The order is chosen over every permutation of the 3–4 games.

A test checks the rules on 40 random histories with random games turned off.

**Reasons.** Each game gets one plain-language reason, in this priority:
- `practise_weak_direction` (with the direction);
- `focus_<movement>` (need ≥ 0.6);
- `variety`;
- `favourite`;
- `lighter_today`;
- `balance` (the plan's only game of a required group);
- `keep_practising`.

The web app words them gently, for example "Your hand opening has improved less than your other movements — let's focus on it". A test checks that, in both languages, they make no medical claim and never mention AI.

**The patient decides.** The patient may untick, add or reorder games. Each change is recorded with the plan (`plan_overrides`: planned, played, removed, added, reordered) for analysis, and the recommendation itself is never changed.

## Limitations

- **Approximate starting values:** the inverse mapping averages a component's settings, so multi-setting components reproduce the admin's defaults only approximately; the first trial of each run uses the defaults exactly.
- **Tiring rule:** it fires often on noisy data, partly because it compares movement times across trials of different difficulty; its thresholds are not yet tuned on real patients.
- **L2 learns slowly** with many independent sectors, and in simulation did worse than L1 for moderate and severe patients. Sharing evidence between neighbouring sectors (a hierarchical prior) is a likely improvement, not yet tested.
- **L2's level jumps:** the level shown to an L2 patient follows each chosen sector, so it moves more from trial to trial than L1's.
- **Balloon pop under L1:** the fixed rotation sets the balloon's height, overriding the spatial setting the engine adapts, so L1 does not change balloon height; L2's targets do.
- **The planner's need** uses the patient's measures as they are when it runs; plans already made are kept, so they reflect what was known at the time. The "next session" in the facts of an older session uses today's measures.
- **No admin control** for the maximum difficulty per game yet; the engine mode can be changed on the patient page.

## References

- Levitt H (1971). Transformed up-down methods in psychoacoustics. *J Acoust Soc Am* 49(2B):467–477.
- Kaernbach C (1991). Simple adaptive testing with the weighted up-down method. *Percept Psychophys* 49(3):227–229.
- Thompson WR (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. *Biometrika* 25(3/4):285–294.
- Russo D, Van Roy B, Kazerouni A, Osband I, Wen Z (2018). A tutorial on Thompson sampling. *Foundations and Trends in Machine Learning* 11(1):1–96.
- Ayer M, Brunk HD, Ewing GM, Reid WT, Silverman E (1955). An empirical distribution function for sampling with incomplete information. *Ann Math Stat* 26(4):641–647.

**Simulation study tool** (`server/app/engine/sim/`): drives simulated patients through the same code as the API (a test replays a simulated session through the API with identical decisions), with measures for challenge error, time in the 60–80% zone, convergence, compensation, workspace coverage and learning gain. See [simulation-results.md](simulation-results.md).
