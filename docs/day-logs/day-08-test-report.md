# Day 8 test report (hand games)

Date: 2026-11-10. Nothing in this report failed at the end of the review. **MANUAL** means the requirement still needs a person to check it, and it has not been confirmed yet.

## Automated results

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | 865 passed (67 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with a chunk size warning (1,254 kB, 367 kB gzipped) |
| `pytest` | 488 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **98%** of 2,826 statements; every module 89% or more except `scripts/seed_demo.py` (79%, unchanged) |
| `scripts/smoke_test.py` | 38 steps pass in-process under `pytest`; **not yet run against a live server** (see below) |

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/services/game_measures.py` (new) | 100% |
| `app/services/progress.py` | 99% |
| `app/schemas/game.py` | 99% |
| `scripts/seed_demo_data.py` | 99% |
| `scripts/smoke_test.py` | 98% |

## Day 8 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| Openness from personal refs, clamped, EMA 0.5, not ready without the hand | Vitest | PASS | Defaults 1.1 / 1.6; latest warm-up; glitched peak capped at 2.2 |
| Finger touch: threshold, hysteresis 0.1, one finger, no double touches from jitter | Vitest | PASS | Jitter around 0.3, slides, jumps, lost hand, broken distances |
| Keyboard openness (O) and touches (1–4); K switches all inputs | Vitest, code review | PASS / MANUAL | Key events tested with a stubbed `window`; the shared K switch by hand (checklist) |
| Non-spatial targets saved and returned as sent | pytest | PASS | 12 invalid shapes return 422; placed targets unchanged |
| Bloom phases, hold reset, time-outs, metrics, garden | Vitest | PASS | Open/close success and time-out; dip within hysteresis keeps the hold |
| Finger piano hit window, wrong finger, one touch one note, melodies, metrics | Vitest | PASS | Early, on time, late, overlapping windows; 200 seeds for melody rules |
| Hand-game metrics validated on the server | pytest | PASS | Notes add up; hits ≤ attempts; shares 0–1 |
| Plan defaults (four games, about 16 minutes; Fruit catch unticked) | Vitest | PASS | `defaultPlanRows` |
| Main and extra measures (web and server agree) | Vitest, pytest | PASS | `mainMeasure`/`extraMeasure` and `game_measures.py`; every game |
| Summary endpoint includes both games | pytest, smoke test | PASS | Score, success rate, `main_measure`, `extra_measure` |
| Admin hand-game charts and progress section | Vitest, code review | PASS / MANUAL | Data helpers tested; charts by hand |
| Demo data with improving hand games | pytest | PASS | Every trial re-validated; success and hit rate rise over sessions |
| Strings via `t()` | Code review, type check | PASS | Canvas labels via `t()`; English and Bangla files must have the same keys |

## Review findings (task 5)

| Check | Result | Notes |
| --- | --- | --- |
| Hand games read only from the input layer | PASS | `games/bloom` and `games/fingerPiano` import nothing from vision except the `Point` type; they read `context.hand` and `context.activation` |
| Personal warm-up references with safe defaults | **Fixed** | Defaults without a warm-up were already used. A glitched open-hand peak could make full openness impossible, and a warm-up touch distance was unbounded: now capped (2.2 palm lengths; 0.1–0.6) |
| One vision engine; no source reads the camera twice | PASS, **improved** | Every source subscribes to the single `visionEngine`. Grip, openness and touch each worked out the same hand measures per frame: now done once per frame (`handMeasuresCache.test.ts`) |
| Timings exclude paused time | PASS | Games run on game time; touch times are converted with `toGameTime`; vision timestamps are `performance.now()`; touches during a pause are dropped; a trial cut by a pause is played again |
| Audio started after a user gesture, closed when leaving | **Fixed** | Started from clicks already. It was never closed: `stopSession()` now closes it. A session resumed straight into a game had no click: the game screen now starts sound on the first press (`beep.test.ts`) |
| All strings via `t()` | PASS | No hard-coded text in today's screens; the Exercise Lab is development-only by design |

## Fixed in this review

| Problem | Found by | Fix |
| --- | --- | --- |
| Hand measured three times per frame | Code review | `affectedHandMeasures` caches per frame and side |
| Glitched warm-up peak could block Bloom | Code review | `MAX_OPEN_REF = 2.2` |
| Warm-up touch distance unbounded | Code review | Kept to 0.1–0.6 |
| Audio context never closed | Code review | `closeAudio()` in `stopSession()` |
| Silent game after resuming a session | Code review | Game screen calls `gameAudio.prepare()` on the first pointer or key press |
| Smoke test did not cover the hand games | Task | Bloom and Finger piano runs with unplaced targets, checked in the dashboard, summary, progress and admin session detail |

## Smoke test against a live server

Not run in this review. Start the server, then in a second terminal:

```powershell
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 38 `PASS` lines, including "Patient plays a bloom run with non-spatial targets" and "Patient plays a finger_piano run with non-spatial targets", and exit code 0. Or run `.\scripts\check.ps1` from the repository root, which starts its own temporary backend.

## Manual checklist

Use a good webcam position (see the patient guide) and a quiet room. For keyboard checks, use a development build (`npm run dev`) and press **K** on the game screen; the top bar shows **Keyboard**.

### Bloom, webcam

1. Start a session, do the warm-up including hand open-close, and choose only Bloom.
   - Expected: no fingertip cursor and no squeeze meter at the bottom right.
   - Beside the bud: an open-hand icon and a level bar with a white line.
2. Open the hand slowly.
   - Expected: the petals follow the hand. The bar turns yellow at the line, and the ring around the bud fills while you hold.
3. Hold until it blooms.
   - Expected: a soft sparkle (no flashing) and a gentle note. Then the fist icon, the message "Make a fist to collect the seed", and the bar now shows grip.
4. Make a fist.
   - Expected: the seed flies to the basket, and the flower is planted in the bottom row. "Flowers 1" in the top bar.
5. Open the hand past the line, then let it drop well below before the hold finishes.
   - Expected: the ring empties and the hold starts again.
6. **Weak opening:** open only a little (below the line) for 8 seconds.
   - Expected: the bud fades and droops quietly, with a calm message ("That's OK…" or similar). No red, no buzzer.
   - On the admin session page, the turn shows "Not finished" and "Ran out of time: Opening".
7. After a bloom, do not make a fist for 8 seconds.
   - Expected: a calm miss; the admin page shows "Closing".
8. Move the hand out of view for a second.
   - Expected: the game pauses. When the hand returns it resumes, and the flower starts again from a bud.
9. Finish all 15 flowers.
   - Expected: the results show score, successes, Flowers grown and Best openness.

### Bloom, keyboard

1. Press K, then hold **O**.
   - Expected: the petals open over about 0.3 s; let go and they close.
2. Hold O for about a second.
   - Expected: it blooms. Then hold **Space** to make a fist and collect the seed.
3. Do nothing for 8 seconds.
   - Expected: a calm miss.

### Finger piano, webcam

1. Choose only Finger piano.
   - Expected: four lanes (index, middle, ring, little) with names under the line, a hand diagram on the thumb side, and "Watch the tune" with the notes shown in a row for 2 seconds.
2. Touch the thumb to the lit finger as each note reaches the line.
   - Expected: a pleasant note and a coloured ring. "Notes" in the top bar counts up.
3. **Wrong fingers:** touch a different finger when a note arrives.
   - Expected: a quiet low sound and a grey ring. The note can still be played with the right finger before it passes.
   - A note touched only with wrong fingers counts as "Wrong finger" on the admin page; one not touched at all counts as "Missed".
4. Hold one touch through two notes.
   - Expected: at most the first note plays; touches only count when they start.
5. If the warm-up's thumb opposition used the **gentle** preset, check that only the index and middle lanes appear.
6. Finish all 12 melodies.
   - Expected: the results show Hit rate and Best finger.
   - Patient history shows per-finger bars; the admin session page shows "Hit rate by finger".

### Finger piano, keyboard

1. Press K, then press **1**, **2**, **3** and **4** as notes for the index, middle, ring and little finger arrive.
   - Expected: each plays its own note.
2. Press the wrong number.
   - Expected: the muted sound.
3. Hold 1 and press 2.
   - Expected: only one finger touches at a time.

### A session with all five games

1. On the plan, tick Fruit catch as well (all five), then reorder to put Bloom first.
   - Expected: the total shows five games and about 20 minutes.
2. Play all five games in order.
   - Expected: each results screen says "Next game", and the last says "Continue" to the cool-down.
3. Halfway through a game, refresh the page.
   - Expected: "Continue your session" returns to the same game. Sound starts again on your first click or key press.
4. Finish the cool-down.
   - Expected: the summary has five game cards, with flowers grown and best openness for Bloom, and hit rate and best finger for Finger piano.
5. As the admin, open the session.
   - Expected: five game cards, no reach map for the two hand games, and the openness chart with the dashed demand line.
   - The patient's Progress tab shows the Hand games section.
6. Leave the session with Exit, then start a new one.
   - Expected: no sound plays after leaving; sounds work again in the new session.
