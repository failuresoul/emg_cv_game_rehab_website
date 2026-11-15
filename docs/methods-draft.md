# Methods (draft)

> **Draft for the thesis or paper.** It describes the system as built. `[TODO]` marks where your input or a citation is needed. Each reference below is one we believe exists, as cited in the code and documents, but **you must check every reference** (authors, year, title, journal, pages, DOI) before submitting. Numbers come from `docs/results-summary.md`; pilot results are n = 1 and must be reported as such.

## 1. System overview

MuVi Rehab is a browser-based upper-limb rehabilitation system for people after stroke. Its components are:

- markerless webcam motion tracking;
- optional surface electromyography (EMG);
- nine therapeutic games with adaptive difficulty;
- a session planner;
- feedback reports written by a locally run language model under rule-based control.

The server runs FastAPI with an SQLite (or PostgreSQL) database; the client is React and TypeScript in the browser (see `docs/architecture.md`). All camera processing runs in the browser, and only numerical measures leave it. `[TODO: ethics statement, setting, intended users, and that it is not a medical device.]`

## 2. Sensing

### 2.1 Camera

MediaPipe Hand Landmarker and Pose Landmarker (Tasks API, version 1.2.0, WASM with the GPU delegate when available) run on 640 × 480 frames at up to 30 frames per second.

- **Pose:** 33 landmarks in image coordinates and in metric world coordinates.
- **Hand:** up to two hands of 21 landmarks each, also in both coordinate systems.
- **Visibility:** a landmark counts as visible above a visibility of 0.5.
- **Which hand is affected:** the affected hand is chosen by position: the detected hand whose wrist lies within 0.5 shoulder widths of the pose's wrist on the affected side. This avoids relying on handedness labels, which are unreliable with mirrored cameras. `[TODO: cite MediaPipe; Lugaresi et al., 2019, is the framework paper. Verify.]`

### 2.2 Muscle sensor

`[TODO: describe the hardware: ESP32 board, EMG front-end, electrodes, sites (forearm flexors or extensors), battery isolation.]`

- **Firmware:** it streams the envelope at 500 Hz over USB serial (Web Serial API), with a sample counter and status lines.
- **Smoothing:** the browser smooths the envelope.
- **Calibration** (relaxed baseline and maximal effort):
  - **Rest:** 10 s relaxed. It is accepted if the smoothed signal's SD is between 2 and 40 mV and the mean is below 800 mV. A flatter signal indicates an electrode off.
  - **Efforts:** three maximal efforts, with an extra one if they disagree.
- **During games:** activation is expressed as %MVC.
- **If the signal is lost:** the games fall back to the camera.
- **Testing:** real-hardware validation is planned (Day 21; `docs/emg-hardware-test.md`).

## 3. Calibration and the body frame

**The body frame:** all positions are expressed in a body frame.

- **Origin:** the affected shoulder.
- **Unit:** one shoulder width (SW), the median of the last 30 frames' shoulder distance.
- **Axes:** +x away from the body midline on the affected side and +y up. The axes stay level with the image, so trunk lean does not rotate "up".

**Reach calibration:** each session starts with it.

- **The task:** the patient moves the wrist outwards in eight directions (0°–315° in 45° steps) for up to 20 s of active time.
- **What it records:** each direction's furthest reach. A direction counts as reached at 0.6 SW.
- **The reach area:** the convex hull of these points (measure K1, in SW²). It also sets the games' target placement.

## 4. Warm-up and repetition counting

**The six exercises:**

- shoulder flexion;
- shoulder abduction;
- elbow flexion and extension;
- forward reach;
- hand opening and closing;
- thumb-to-finger opposition.

Each has 10 target repetitions (5 rounds for opposition) and lasts at most 90 s.

**The measures:**

- **Arm:** angles are computed from world landmarks when available, else from image landmarks scaled to pixels.
  - **Elevation:** the angle between the upper arm and the shoulder-to-hip line.
  - **Elbow:** the angle at the elbow.
  - **Forward reach:** the wrist's distance in front of the shoulder along the body's forward axis, divided by arm length.
- **Hand:** expressed in palm lengths (wrist to middle-finger knuckle).
  - **Opening:** the mean wrist-to-fingertip distance.
  - **Opposition:** the thumb-tip distance to each fingertip.

**Counting:**

- **Smoothing:** values are smoothed (one-euro filter) before counting.
- **The rep counter:**
  - **States:** rest, then moving, then target, then return.
  - **Thresholds:** a rest line and a target line, with hysteresis.
  - **Timing:** a repetition lasts 0.6–8 s.
  - **Partial repetitions:** when the movement passes 60% of the way.
- **The sequence counter (opposition):** counts touches in finger order.

**Targets:**

- **Standard preset:**
  - shoulder flexion 30°/90°;
  - abduction 30°/80°;
  - elbow 140°/70°;
  - forward reach 0.45/0.80;
  - hand opening 1.2/1.6;
  - opposition touch 0.25 and release 0.40 palm lengths.
- **Other presets:** a gentle preset, and personal targets from the patient's history. Repeatability visits use the standard preset only.
- **Compensation:** trunk lean and shoulder hiking are detected against a baseline and reported per repetition.

## 5. Games

Nine games cover reaching, shoulder movement, elbow movement, hand opening, finger individuation, grip, smoothness and functional transport:

| Game              | Movement trained                        |
| ----------------- | --------------------------------------- |
| Reach and squeeze | Reaching, then grip activation          |
| Balloon pop       | Reaching                                |
| Fruit catch       | Reaching                                |
| Pick and place    | Functional transport                    |
| Path trace        | Movement smoothness                     |
| Paint the wall    | Elbow flexion and extension             |
| Bloom             | Hand opening and closing                |
| Finger piano      | Finger individuation (thumb opposition) |
| Grip and hold     | Grip force, holding a band              |

Each game logs every trial: outcome, timings, the trajectory (at most 2,000 points), compensation, and EMG where used. The engine sets each trial's settings.

## 6. Adaptive difficulty

**Difficulty components:** each game's settings map to difficulty components d ∈ [0, 1], for example spatial, precision, speed and activation. These are converted into each setting within its bounds.

- **L0** keeps fixed settings.
- **L1** is a transformed up-down staircase per component: two successes in a row make one component harder (+0.06), and one failure makes the component the failure points to easier (−0.08). Levitt's 2-down-1-up rule converges near 70.7% success; with the unequal steps (the weighted up-down idea), a simulated patient settles near 75%.
- **L2** keeps Beta beliefs about the chance of success per direction sector and difficulty level. It chooses the next trial by Thompson sampling, aimed at a target success p* = 0.70.
  - **Per-part aim:** with k jointly required parts, each part aims at p*^(1/k).
  - **Coverage bonus:** a small bonus, weighted by the posterior mean, favours sectors not chosen recently.
  - **Monotonicity:** beliefs are kept monotone in difficulty by isotonic regression (pool-adjacent violators).
  - **Between sessions:** the beliefs forget 30% towards the prior.
  - **Priors:** set from the calibration and the warm-up.

**References** for this section: Levitt 1971; Kaernbach 1991; Thompson 1933; Russo et al. 2018; Ayer et al. 1955.

## 7. Safety layer

The safety layer runs after every engine decision, and the engine cannot override it. Its rules apply in this order:

1. **Hard bounds:** every d is kept within [0, the therapist's maximum].
2. **Compensation:** after compensation in 2 of the last 3 trials, the spatial components may not get harder.
3. **Repeated failure:** after 3 failures in a row, every component is eased by 0.15.
4. **Tiring:** the last 5 trials are compared with the first 5. A fall in success of 0.4, a rise in movement time over 30%, or a fall in activation peak over 20% eases every component by 0.1 and suggests a rest.
5. **Session time:** cues to finish soon after 25 minutes of active play, and to finish after 35.

The therapist's programme also caps each game's highest level.

## 8. Session planner

Each session, the planner chooses and orders 2–6 games, within the programme's limits.

- **Need:** each game's movement measures against the patient's baseline (worse, no detectable change, improved).
- **Other factors:** recency, enjoyment, and lighter days after high fatigue, pain or "too hard".
- **Reasons:** every chosen game gets a plain-language reason.
- **In a study:** a study session plays the study's locked games instead.

## 9. Feedback reports

**Principle:** "the code calculates, the rules decide, the model only writes".

**Facts:** for each session, the server computes a facts JSON:

- the session's measures with their change against the baseline in MDC units;
- the games and the questionnaire;
- a patient code (no name).

**Rules:** rules choose up to three suggestions from a fixed catalogue of 13 types, and detect red flags such as pain or new symptoms.

**The model:**

- **Which model:** a local model (Ollama; default `qwen3.5:4b`, temperature 0.2) writes a JSON report constrained by a JSON schema, in English or Bangla.
- **Validation:** a validator checks the answer.
  - **Facts:** every number must match the facts, and a direction word ("improved", "worse") must agree with the measure's MDC status.
  - **Language and length:** banned medical words, the script of the language, and word limits.
  - **Retries:** up to 2 retries with the errors listed.
- **Fallback:** if all attempts fail, a deterministic template report is used.
- **Safety notices:** fixed safety notices are added by the code, never by the model.

## 10. Measures and MDC

**The catalogue:** the metric catalogue (`shared/metrics-catalog.json`; listed in `docs/data-dictionary.md`) defines each measure's unit and whether higher, lower or closer to zero is better. It covers:

- kinematic measures, such as reach area, reaction and movement time, path efficiency, SPARC, peak speed and speed peaks;
- ranges of motion;
- hand measures;
- engagement;
- EMG measures;
- patient-reported pain, fatigue and enjoyment.

**Smoothness:** SPARC is the spectral arc length of the speed profile (Balasubramanian et al., 2015).

**Judging a change:**

- **The baseline:** the mean of a patient's first two sessions with the measure.
- **The comparison:** from the third session on, the latest value's change is expressed in MDC units. It is improved at +1 MDC or more and worse at −1 or less.
- **The MDC:** measured from repeatability visits (section 11.3), or provisional placeholders until then.

## 11. Validation protocol (pilot, n = 1)

The full protocol is in `docs/validation.md`. In brief, one healthy participant, seated, with one webcam:

1. **Latency:** the end-to-end latency comes from slow-motion video of a wrist crossing a line and an on-screen square changing colour. The software stage timings are logged per frame.
2. **Joint angles:** the elbow, shoulder flexion and shoulder abduction angles from MediaPipe (3D and 2D, averaged over 2 s) are compared with a phone clinometer.
   - **Statistics:** RMSE and Bland–Altman bias with 95% limits of agreement (Bland and Altman, 1986).
   - `[TODO: name the clinometer app and its stated accuracy.]`
3. **Repeatability:**
   - **The visits:** three visits on different days. Each is the camera check, calibration and the six warm-up exercises with the standard targets.
   - **Statistics:** within-subject SD (SEM), MDC95 = 1.96 × √2 × SEM, and CV% (Weir, 2005).
   - **ICC(2,1):** (Shrout and Fleiss, 1979; McGraw and Wong, 1996) is reported only with three or more participants.
4. **Repetition counting:** guided recordings with scripted repetition counts are played through the same counters as the app.

## 12. Simulation study

**The simulated patients:**

- **Success:** they succeed per component with probability 1 / (1 + e^(−k(ability − demand))).
- **Fatigue:** within-session fatigue reduces ability.
- **Learning:** abilities rise between sessions.

**Same code as the app:** the simulator runs the server's actual engines and safety layer.

**Design:**

- **Patients:** 20 simulated patients per profile (mild, moderate, severe) and engine.
- **Reach and squeeze:** 10 sessions of 40 trials each.
- **Bloom:** 20 patients.

**Measures:**

- rolling success;
- challenge error from the 0.7 target;
- time in the 60–80% zone;
- trials to converge;
- compensation;
- workspace coverage;
- learning gain.

**Statistics:** compared per profile with Kruskal–Wallis and pairwise Mann–Whitney tests with Holm correction, and rank-biserial effect sizes (`docs/simulation-results.md`).

## 13. LLM evaluation

**Automatic metrics** (`analysis/llm/`, `docs/llm-evaluation.md`) on a fixed test set of session facts:

- validity at the first attempt;
- numeric faithfulness;
- direction errors;
- banned words;
- template rate;
- latency.

**Blind human comparison:** reports from the model and the template are rated on accuracy, safety, helpfulness, clarity and tone (1–5) by raters who do not know the source.

`[TODO: raters, number of sessions, agreement statistic.]` Results are PENDING.

## 14. Statistics and software

**Software:** analyses use Python (`analysis/validation/stats.py`, with worked-example tests), and figures use a colour-blind-safe palette (Okabe–Ito). `[TODO: Python and library versions; significance level.]`

**Reporting rule:** all pilot results are n = 1 and descriptive.

## References (verify each before use)

- Ayer M, Brunk HD, Ewing GM, Reid WT, Silverman E (1955). An empirical distribution function for sampling with incomplete information. _Annals of Mathematical Statistics_ 26(4):641–647.
- Balasubramanian S, Melendez-Calderon A, Roby-Brami A, Burdet E (2015). On the analysis of movement smoothness. _Journal of NeuroEngineering and Rehabilitation_ 12:112.
- Bland JM, Altman DG (1986). Statistical methods for assessing agreement between two methods of clinical measurement. _Lancet_ 1(8476):307–310.
- Kaernbach C (1991). Simple adaptive testing with the weighted up-down method. _Perception & Psychophysics_ 49(3):227–229.
- Levitt H (1971). Transformed up-down methods in psychoacoustics. _Journal of the Acoustical Society of America_ 49(2B):467–477.
- Lugaresi C, et al. (2019). MediaPipe: a framework for building perception pipelines. arXiv:1906.08172.
- McGraw KO, Wong SP (1996). Forming inferences about some intraclass correlation coefficients. _Psychological Methods_ 1(1):30–46.
- Russo D, Van Roy B, Kazerouni A, Osband I, Wen Z (2018). A tutorial on Thompson sampling. _Foundations and Trends in Machine Learning_ 11(1):1–96.
- Shrout PE, Fleiss JL (1979). Intraclass correlations: uses in assessing rater reliability. _Psychological Bulletin_ 86(2):420–428.
- Thompson WR (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. _Biometrika_ 25(3/4):285–294.
- Weir JP (2005). Quantifying test-retest reliability using the intraclass correlation coefficient and the SEM. _Journal of Strength and Conditioning Research_ 19(1):231–240.
- `[TODO: Okabe and Ito colour palette; one-euro filter (Casiez et al., 2012); stroke rehabilitation and gamification background.]`
