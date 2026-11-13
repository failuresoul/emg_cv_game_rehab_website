import { describe, expect, it } from "vitest";

import {
  batteryOk,
  canCalibrate,
  canLeaveSafety,
  type FlowAction,
  flowReducer,
  type FlowState,
  INITIAL_FLOW,
  qualityOf,
  readinessRecord,
} from "./emgFlow";
import type { CheckResult } from "./readiness";

const PAUSE = 30_000;
const READY_CHECKS: CheckResult[] = [
  {
    id: "rate",
    pass: true,
    value: "500/s",
    labelKey: "emgCheck.rate",
    hintKey: "emgCheck.rate.hint",
  },
];
const GOOD_SQUEEZE = { pass: true, peakMv: 1500, ratio: 7, onset: true };

function run(actions: FlowAction[], from: FlowState = INITIAL_FLOW): FlowState {
  return actions.reduce(flowReducer, from);
}

const throughSafety: FlowAction[] = [
  { type: "chooseSite", site: "flexors" },
  { type: "answerSafety", key: "chargerUnplugged", value: true },
  { type: "answerSafety", key: "batteriesFresh", value: true },
  { type: "answerSafety", key: "electrodesOn", value: true },
  { type: "continueToCheck" },
];
const throughCheck: FlowAction[] = [
  ...throughSafety,
  { type: "connected", source: "serial" },
  { type: "squeezeTested", result: GOOD_SQUEEZE },
  { type: "ready", readiness: READY_CHECKS },
];
const goodRest: FlowAction[] = [
  { type: "startRest", now: 0 },
  { type: "restDone", result: { mean: 200, sd: 10, problem: null } },
];

function attempt(peakMv: number, now: number, saturated = false): FlowAction[] {
  return [
    { type: "startAttempt", now },
    { type: "countdownDone", now: now + 3000 },
    {
      type: "attemptDone",
      result: { peakMv, saturated },
      trace: [1, 2, 3],
      now: now + 6000,
      pauseMs: PAUSE,
    },
  ];
}

describe("stage A: safety and placement", () => {
  it("needs a site and all three answers for a real sensor", () => {
    expect(canLeaveSafety(INITIAL_FLOW)).toBe(false);
    const partial = run(throughSafety.slice(0, 3));
    expect(canLeaveSafety(partial)).toBe(false);
    expect(run([{ type: "continueToCheck" }], partial).stage).toBe("safety");
    const done = run(throughSafety);
    expect(done.stage).toBe("check");
    expect(batteryOk(done)).toBe(true);
  });

  it("lets the simulated sensor go on with only a site", () => {
    expect(run([{ type: "continueToCheck", simulated: true }]).stage).toBe("safety"); // no site
    const state = run([
      { type: "chooseSite", site: "extensors" },
      { type: "continueToCheck", simulated: true },
    ]);
    expect(state.stage).toBe("check");
    expect(state.source).toBe("simulated");
    expect(batteryOk(state)).toBe(false);
  });
});

describe("stage B: the sensor check", () => {
  it("goes to calibration only after the squeeze passed", () => {
    const noSqueeze = run([...throughSafety, { type: "ready", readiness: READY_CHECKS }]);
    expect(noSqueeze.stage).toBe("check");
    expect(canCalibrate(noSqueeze)).toBe(false);
    const failed = run([
      ...throughSafety,
      { type: "squeezeTested", result: { ...GOOD_SQUEEZE, pass: false } },
      { type: "ready", readiness: READY_CHECKS },
    ]);
    expect(failed.stage).toBe("check");
    const ready = run(throughCheck);
    expect(ready.stage).toBe("calibrate");
    expect(ready.readiness).toEqual(READY_CHECKS);
    expect(ready.source).toBe("serial");
  });

  it("keeps a passed squeeze when a later try fails", () => {
    const state = run([
      ...throughSafety,
      { type: "squeezeTested", result: GOOD_SQUEEZE },
      { type: "squeezeTested", result: { ...GOOD_SQUEEZE, pass: false } },
    ]);
    expect(state.squeeze?.pass).toBe(true);
  });
});

describe("stage C: calibration", () => {
  it("rests, then takes three efforts with pauses, then shows the summary", () => {
    let state = run([...throughCheck, ...goodRest]);
    expect(state.rest).toEqual({ mean: 200, sd: 10, problem: null });
    expect(state.phase).toEqual({ kind: "attemptReady" });
    state = run(attempt(1500, 10_000), state);
    expect(state.phase).toEqual({ kind: "pause", until: 16_000 + PAUSE });
    state = run(
      [
        { type: "pauseDone" },
        ...attempt(1600, 50_000),
        { type: "pauseDone" },
        ...attempt(1550, 90_000),
      ],
      state,
    );
    expect(state.stage).toBe("summary");
    expect(state.phase).toEqual({ kind: "done" });
    expect(state.mvc?.mvc).toBeCloseTo(1550);
    expect(state.attempts.map((item) => item.peakMv)).toEqual([1500, 1600, 1550]);
    expect(qualityOf(state, 0.1)).toMatchObject({
      saturation: false, gaps_pct: 0.1, attempts_spread: 0.063, consistent: true, extra_attempt: false,
    }); // prettier-ignore
  });

  it("repeats the rest when it fails", () => {
    const state = run([
      ...throughCheck,
      { type: "startRest", now: 0 },
      { type: "restDone", result: { mean: 150, sd: 0.5, problem: "electrodeOff" } },
    ]);
    expect(state.phase).toEqual({ kind: "restFailed", problem: "electrodeOff" });
    expect(state.rest).toBeNull();
    expect(run([{ type: "startRest", now: 20_000 }], state).phase).toEqual({
      kind: "rest",
      startedAt: 20_000,
    });
    // Efforts cannot start without a rest level.
    expect(run([{ type: "startAttempt", now: 1 }], state).phase.kind).toBe("restFailed");
  });

  it("repeats a saturated attempt without counting it", () => {
    let state = run([...throughCheck, ...goodRest, ...attempt(2900, 10_000, true)]);
    expect(state.phase).toEqual({ kind: "attemptSaturated" });
    expect(state.attempts).toHaveLength(0);
    state = run(attempt(1500, 20_000), state);
    expect(state.attempts).toHaveLength(1);
    expect(state.saturatedAttempts).toBe(1);
    expect(qualityOf(state, 0).saturation).toBe(true);
  });

  it("adds one extra attempt when the three differ by more than 15%", () => {
    let state = run([...throughCheck, ...goodRest]);
    for (const [index, peak] of [1000, 1600, 1550].entries()) {
      state = run([...attempt(peak, index * 50_000), { type: "pauseDone" }], state);
    }
    expect(state.stage).toBe("calibrate");
    expect(state.extraUsed).toBe(true);
    state = run(attempt(1580, 200_000), state);
    expect(state.stage).toBe("summary");
    expect(state.mvc?.used.sort()).toEqual([1550, 1580, 1600]);
    expect(qualityOf(state, 0).extra_attempt).toBe(true);
  });

  it("stops when the effort is under 3 x rest, and can be redone", () => {
    let state = run([...throughCheck, ...goodRest]);
    for (const [index, peak] of [500, 520, 510].entries()) {
      state = run([...attempt(peak, index * 50_000), { type: "pauseDone" }], state);
    }
    expect(state.phase).toEqual({ kind: "weak" });
    expect(state.stage).toBe("calibrate");
    state = run([{ type: "redoCalibration" }], state);
    expect(state.phase).toEqual({ kind: "restReady" });
    expect(state.attempts).toEqual([]);
    expect(state.rest).toBeNull();
  });

  it("ignores actions out of order", () => {
    const state = run(throughCheck);
    expect(run([{ type: "countdownDone", now: 1 }], state)).toBe(state);
    expect(run([{ type: "pauseDone" }], state)).toBe(state);
    expect(run([{ type: "restDone", result: { mean: 1, sd: 1, problem: null } }], state)).toBe(
      state,
    );
  });
});

describe("going back", () => {
  it("steps back a stage at a time", () => {
    const check = run(throughSafety);
    expect(run([{ type: "back" }], check).stage).toBe("safety");
    const calibrate = run(throughCheck);
    const backToCheck = run([{ type: "back" }], calibrate);
    expect(backToCheck.stage).toBe("check");
    expect(backToCheck.readiness).toBeNull();
    expect(backToCheck.squeeze).toBeNull();
  });
});

describe("what is stored", () => {
  it("records every check with its value", () => {
    expect(readinessRecord(READY_CHECKS)).toEqual({ rate: { pass: true, value: "500/s" } });
    expect(readinessRecord(null)).toEqual({});
  });
});
