# Day 3 test report

Date: 2026-11-01. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 255 passed |
| `npm run lint` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (928 kB) |
| `pytest` | 166 passed, 1 warning (`httpx` deprecation); no backend code changed today |
| Throwaway browser scripts in real Chrome | Warm-up and Exercise Lab flows all passed |

**What the browser scripts could not check:** they used simulated arm positions in place of MediaPipe's detection. They prove the page logic, not real tracking or counting accuracy. They also cannot hear sound.

## Joint angles

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| World landmarks exposed by the engine | Code review, build | PASS | New `poseWorld` field; existing code unaffected |
| Vector helpers | Vitest | PASS | |
| Arm hanging, sideways, forward and up | Vitest | PASS | Synthetic landmarks, both sides |
| Elbow straight and at a right angle | Vitest | PASS | |
| Mirrored poses give the same values | Vitest | PASS | Five arm positions |
| Angles use the affected side from the profile | Code review | PASS | `useJointAngles` reads `patient_profile.affected_side`; the lab uses its own selector, for testing |
| Hip fallback | Vitest | PASS | Uses the affected side's hip, and 0.5 visibility still counts as visible |
| 2D fallback with aspect ratio | Vitest | PASS | The plane is null without depth |
| Null when a required landmark is not visible | Vitest | PASS | Includes NaN visibility and short landmark lists |
| NaN landmark positions give null, not NaN | Vitest | PASS | Added in this review |
| Median filter removes a spike | Vitest | PASS | |
| NaN cannot poison the filter | Vitest | PASS | **Bug fixed in this review** |
| Accuracy on a real person | Manual | MANUAL | Plane is the main risk |

## Counting

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| 10 clean or noisy cycles give 10 reps | Vitest | PASS | |
| Noise around a threshold does not double-count | Vitest | PASS | Both lines and both directions |
| Partial movements counted separately | Vitest | PASS | |
| Too-fast cycles ignored | Vitest | PASS | |
| Too-slow movements reset, with feedback | Vitest | PASS | |
| "Down" direction for the elbow | Vitest | PASS | |
| Counting uses filtered values | Vitest, code review | PASS | |
| Results keep raw peaks too | Vitest, code review | PASS | **Missing until this review**; added `rawPeakValue` and `bestRawPeak` |
| Tracking loss never creates or completes a rep | Vitest, browser script | PASS | Includes a rep starting during a pause, and resuming with the arm raised |
| Swapped or equal thresholds are rejected | Vitest | PASS | **Bug fixed in this review** |
| NaN and infinite angles ignored | Vitest | PASS | **Bug fixed in this review**: NaN could start a movement |
| Counts match a real person within 1 | [Accuracy test](day-03-accuracy.md) | MANUAL | Two people, three exercises |

## Exercise runner

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Exercise definitions and presets | Vitest | PASS | |
| States from intro to done | Vitest | PASS | |
| Ends at 10 reps and at the time limit | Vitest | PASS | Paused time does not use up the limit |
| Pauses after 500 ms of lost tracking | Vitest, browser script | PASS | |
| Resumes 1 second after tracking returns | Vitest, browser script | PASS | The wait restarts if tracking drops again |
| Results have correct peaks and durations | Vitest | PASS | |
| Null and NaN angles count as lost tracking | Vitest | PASS | **Bug fixed in this review** for NaN |

## Warm-up page

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Overview, instructions, demo and countdown | Browser script, screenshots | PASS | |
| Counter, ring, gauge, feedback line | Browser script, screenshots | PASS | Counter measured at 81 px |
| Pause, and skip with confirmation | Browser script | PASS | |
| Tracking-loss overlay | Browser script, screenshots | PASS | |
| "Make it easier" recorded in the result | Browser script | PASS | The change was run in a browser; the preset in the result is shown by Vitest |
| Summaries and Continue to the plan page | Browser script, screenshots | PASS | |
| Results kept in `SessionContext` | Browser script | PASS | Lost on refresh, as planned until Day 4 |
| Fits 1280×720 and 1920×1080 | Browser script, screenshots | PASS | No page scrolling on the active screen |
| Camera stops when leaving the warm-up | Code review, browser script | PASS | The engine reports idle on the complete screen; leaving unmounts `useVision` |
| Webcam light turns off | Manual | MANUAL | Needs a real camera |
| Tick, chime and countdown beeps | Manual | MANUAL | Requires listening |
| Voice instructions and mute | Manual | MANUAL | Requires listening |
| Bangla text on the warm-up | Manual | MANUAL | Text exists for every key; quality needs a native speaker |

## Exercise Lab

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Not in the production build | Fresh build, search of `dist/` | PASS | No lab file or lab text found |
| Shows Page not found in production | Manual | MANUAL | `npm run preview` |
| Never calls the server | Code search, browser script | PASS | No `/api` requests with no server running; if a login token is stored, the app's own login check still calls `/api/auth/me` |
| No login needed | Browser script | PASS | |
| Live values, thresholds, state, counts, log | Vitest, browser script | PASS | |
| Live chart with low and high lines | Browser script, screenshot | PASS | |
| Manual count and difference | Vitest, browser script | PASS | |
| Record and download CSV | Vitest, browser script | PASS | Checked the file's contents |
| Reset | Vitest, browser script | PASS | |

## Static review

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| No video or images leave the browser | Code search | PASS | No image exports, recording, uploads or sockets; today's new code makes no API writes; `getImageData` is only the local brightness sample |
| All strings through `t()` | Code search | PASS | No hard-coded text outside the lab; 337 keys, none unused; TypeScript requires every key in Bangla |
| `server/app/feedback/` unchanged | `git status` | PASS | |

## Bugs found and fixed today

| Bug | How found | Fix |
| --- | --- | --- |
| Results held only filtered peaks | Review, then failing tests | Reps and results now also keep raw peaks |
| A single NaN made the filter's average NaN from then on | Review, then a failing test | Non-numbers count as a gap |
| A NaN angle could start a movement in the counter | Review, then a failing test | Non-numbers are ignored |
| NaN counted as tracking being present in the runner | Review, then a failing test | Non-numbers count as no measure |
| Swapped thresholds were silently accepted | Review, then a failing test | The counter rejects them |
| One frame jumping past the target gave a partial rep | A new test | The starting frame is now checked against the target |
| The lab's state label overlapped the full-rep count | Screenshot | Layout changed |
| The gauge's value collided with its needle | Screenshot | The value has a background outline |
