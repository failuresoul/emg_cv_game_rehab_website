# Day 2 test report

Date: 2026-11-01. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `pytest` | 166 passed, 1 warning (`httpx` deprecation) |
| Backend coverage of `app/` | 98% (15 of 756 statements not covered) |
| `npm test` (Vitest) | 82 passed |
| `npm run lint` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (832 kB) |
| Throwaway browser scripts in real Chrome | Calibration flow, dashboards and refetch all passed |

The uncovered backend lines are rare race and error paths: losing a duplicate-calibration or patient-code race, an unexpected duplicate email on update, a patient with no profile, and the production database session.

**What the browser scripts could not check:** they used simulated body positions in place of MediaPipe's detection. They prove the page logic, not real tracking accuracy.

## Backend

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Start a session, or resume one under 2 hours old | pytest | PASS | Includes a session at 119 minutes |
| Abort active sessions 2 hours old or more | pytest | PASS | `ended_at` stays empty |
| Current session, or 404 | pytest | PASS | Also aborts expired sessions |
| End with `completed` or `aborted` | pytest | PASS | `active`, `paused` and a missing status give 422; a second end gives 409 |
| Calibration: 7 radii rejected | pytest | PASS | Also 9 radii |
| Calibration: radius 0.1 rejected | pytest | PASS | Also 0.19 |
| Calibration: radius 3.5 rejected | pytest | PASS | Also 3.01; 0.2 and 3.0 are accepted |
| Calibration: hull of 2 points rejected | pytest | PASS | |
| Calibration: other invalid input rejected | pytest | PASS | Wrong angles, 7 points, NaN, side not matching the profile |
| Duplicate calibration gives 409 | pytest | PASS | Only one row is stored |
| Latest calibration, or 404 | pytest | PASS | |
| Patient's own sessions, newest first, with hull area | pytest | PASS | |
| Session ownership | pytest | PASS | Another patient gets 404 on end, calibration, device info and session detail, and sees nothing in lists |
| Roles on session routes | pytest | PASS | Admin gets 403, no token gets 401 |
| Admin lists sessions and calibrations | pytest | PASS | Unknown patient gets 404, patient gets 403 |
| Dashboard's last session and latest calibration | pytest | PASS | Null until they exist |
| Real sessions-today count | pytest, browser script | PASS | Counts from midnight UTC |
| New tables work with an existing database | Run on a copy of the database | PASS | |

## Tracking and geometry

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Convex hull and area of known shapes | Vitest | PASS | Square, triangle, circle points, a line, duplicates |
| Body frame round trip | Vitest | PASS | Both affected sides |
| Mirror symmetry for left and right | Vitest | PASS | All 8 directions at 1.3 SW |
| Outward is +x, up is +y | Vitest | PASS | Also with a webcam that mirrors its image |
| Median shoulder width ignores outliers | Vitest | PASS | |
| One Euro has less jitter than its input | Vitest | PASS | Still point and slow movement |
| Hand marked lost after 500 ms | Vitest | PASS | |
| Tracking accurate on a real person | Manual | MANUAL | Use the debug overlay on `/session/setup` |

## Calibration

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Largest projection of the raw fingertip | Vitest, browser script | PASS | Radii came out at the simulated 1.20 SW |
| Hand lost over 500 ms pauses and repeats | Vitest, browser script | PASS | Simulated |
| Trunk over 0.15 SW asks to sit back and repeats | Vitest, browser script | PASS | Simulated |
| Accepted and flagged after 2 repeats | Vitest | PASS | Not run in a browser |
| Arrow correct in the mirrored view | Browser script, screenshots | PASS | Left and right, first direction only; manual check covers all 8 |
| Countdown beeps | Manual | MANUAL | Requires listening |
| Redo one direction | Browser script | PASS | |
| Save goes to warm-up, with device info | Browser script | PASS | |
| Reach map with dashed outline and comparison | Browser script, screenshots | PASS | |
| Larger, smaller and similar at the 10% limit | Vitest | PASS | |
| Refresh keeps the session and skips a saved calibration | Browser script | PASS | |
| Full calibration by a real person | Manual | MANUAL | The main remaining check |
| The 0.15 SW limit suits normal reaching | Manual | MANUAL | May need adjusting |

## Session flow and dashboards

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Start session calls the API, then opens setup | Browser script | PASS | |
| Exit: cancel keeps the session | Browser script | PASS | |
| Exit: confirm aborts it and starts no new one | Browser script | PASS | |
| Patient home reach map and last session date | Browser script, screenshots | PASS | |
| History list and detail pages | Browser script, screenshots | PASS | |
| Another patient cannot open a session | pytest, browser script | PASS | |
| Admin Sessions tab | Browser script | PASS | |
| Admin Progress tab: map, radii table, chart | Browser script, screenshots | PASS | |
| Layout at 1280 px and 768 px | Browser script, screenshots | PASS | Admin Progress tab only |
| Bangla on the new pages | Browser script | PASS | History page checked; translation quality is MANUAL |

## Static review

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Body frame uses the side from the profile | Code review | PASS | `useTracking` passes `patient_profile.affected_side` to `Tracker`; saving uses the same source |
| Saved data uses raw positions | Code review | PASS | `calibration.ts` reads only `fingertipRawSw`; nothing outside `tracking.ts` reads `fingertipSmoothSw` yet |
| Camera stops when leaving calibration | Code review, browser script | PASS | Unmounting calls `visionEngine.stop()`; the engine reports idle on the result screen |
| Webcam light turns off | Manual | MANUAL | Needs a real camera |
| No video or images sent to the server | Code search | PASS | No image exports, recording, uploads or sockets; `getImageData` is only the local brightness sample; every API write sends JSON or a login form |
| All strings through `t()` | Code search | PASS | No hard-coded JSX text or text attributes found; 278 keys, none unused; TypeScript requires every key in Bangla |
| `server/app/feedback/` unchanged | `git status` | PASS | |
| Smoke test logic | pytest, against the app in memory | PASS | All 12 steps, plus the failure path |
| Smoke test against a real running server | Manual | MANUAL | Run on request: `python scripts/smoke_test.py` |

## Bugs found and fixed today

| Bug | How found | Fix |
| --- | --- | --- |
| `NaN` in any request crashed the server with a 500, and rejected passwords were echoed back in 422 responses | A new pytest test | Validation errors no longer repeat the input |
| A failed background refresh replaced a session page with an error, losing a calibration in progress | Code review, then reproduced in Chrome | Only a failed first load now shows the error page |
| A late camera frame could record a direction twice | Code review | A guard ignores frames after a direction finishes |
| Reading a ref during render | ESLint | Device information is captured when measuring finishes |
| Chart's newest point was cut off; the map's labels were too small at 1280 px | Screenshots | Chart margins and layout changed |
