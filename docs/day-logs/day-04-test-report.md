# Day 4 test report

Date: 2026-11-09. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 416 passed |
| `npm run lint` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,029 kB) |
| `npx prettier --check src` | No problems |
| `pytest` | 229 passed, 1 warning (`httpx` deprecation) |
| `pytest` with coverage | **Not run.** `pytest-cov` is not in the agreed stack; waiting for approval to add it |
| `scripts/smoke_test.py` | Its 17 steps pass in-process under `pytest`; not yet run against a live server |

## Server

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Save, read and replace warm-up results | pytest | PASS | Saving again replaces that exercise only |
| Validation: counts, times, rates, units, thresholds | pytest | PASS | 20 invalid cases, NaN, unknown fields, duplicates in one body |
| Unknown exercise rejected | pytest | PASS | 422 |
| Patients see only their own sessions | pytest | PASS | Another patient's session is 404 |
| Admin routes require admin | pytest | PASS | 403 for a patient, 401 without a token |
| History: newest first, limit, no skipped | pytest | PASS | |
| Admin history per exercise, oldest first | pytest | PASS | With goal, thresholds and personalisation |
| Goal reached at 90% of target reps | pytest | PASS | Same rule as the web app's `goalReached` |
| Summaries on session lists, detail and dashboard | pytest | PASS | `last_warmup` skips sessions without a warm-up |
| Smoke test covers the warm-up | pytest | PASS | Six results, history, dashboard, admin history; a failing step stops the run |

## Measures and counting

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Affected hand chosen by position, not handedness | Vitest, code review | PASS | Nearest wrist to the affected pose wrist, within 0.5 SW; null if the wrist or a shoulder is hidden |
| Hand opening and thumb distances in palm lengths | Vitest | PASS | World landmarks, and image pixels with aspect correction |
| Forward reach | Vitest | PASS | About 0 arm down or sideways, 1 straight forward; median arm length of 30 frames |
| Sequence counter: order, jitter, 6-second timeout, pause | Vitest | PASS | |
| Ratio exercises count with a small hysteresis | Vitest | PASS | |
| Real counting accuracy for the new exercises | [Accuracy test](day-04-accuracy.md) | MANUAL | |

## Compensation

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Thresholds only from `compensationConfig.ts` | Code search, Vitest | PASS | A test gives the monitor a different config and it follows it |
| 300 ms sustain; a 200 ms spike is ignored | Vitest | PASS | |
| Compensated reps counted but flagged | Vitest | PASS | Rate is compensated reps over all recorded reps |
| Hand exercises check trunk displacement only | Vitest | PASS | |
| Cues at most every 5 seconds | Vitest | PASS | |
| Real detection with people | [Accuracy test](day-04-accuracy.md) | MANUAL | |

## Personalisation

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Raise, lower and keep rules | Vitest | PASS | |
| Never past the ceilings or below the floor | Vitest | PASS | **Added in this review:** a sweep over every exercise and 1,260 histories each |
| Gap between low and high kept | Vitest | PASS | Included in the sweep |
| Every decision has a reason | Vitest | PASS | A limit that holds the target back is reported as the reason |
| Decisions match the rule with real sessions | [Accuracy test](day-04-accuracy.md) | MANUAL | |

## Saving and privacy

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Saved results use unfiltered peaks | Vitest, code review | PASS | `best_peak` and each rep's `peak` come from raw values |
| Save on summary, 3 retries with backoff, then "Try again" | Vitest (delays), code review | PASS | 1, 2 and 4 seconds |
| A failed save does not lose data while the page is open | Code review | PASS | Results stay in `SessionContext`; each save sends every result so far, which the server replaces per exercise |
| Failed save shown calmly | Manual | MANUAL | Step 9 of the checklist |
| All strings via `t()` | Code search | PASS | Except the development-only Exercise Lab, on purpose |
| No video or images leave the browser | Code search | PASS | `getImageData` only measures brightness locally; the only `Blob` is the lab's local CSV download |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| The goal and compensation-colour thresholds were written in two places | Code review | `goals.ts` now uses the rule constants exported by `personalise.ts` |
