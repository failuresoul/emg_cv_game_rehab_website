import { describe, expect, it } from "vitest";

import {
  LEAVE_MARGIN,
  OUTCOME_MS,
  ReachTrialMachine,
  type TrialEvent,
  type TrialSettings,
} from "./trialMachine";

const SETTINGS: TrialSettings = {
  dwellMs: 500,
  reachTimeLimitMs: 8000,
  activationDemand: 0.5,
  activationHoldMs: 200,
  activationWindowMs: 3000,
  restMs: 1500,
};
const STEP = 1000 / 60;
const OUTSIDE = 3;
const INSIDE = 0.5;

/**
 * Simulated input: `input(t)` gives the fingertip's distance ratio and the activation level at
 * each 60 Hz step from `from` to `to`. Returns every event.
 */
function run(
  machine: ReachTrialMachine,
  from: number,
  to: number,
  input: (t: number) => { distance?: number | null; level?: number },
): TrialEvent[] {
  const events: TrialEvent[] = [];
  for (let step = 0; from + step * STEP <= to + 1e-9; step++) {
    const t = from + step * STEP;
    const { distance = OUTSIDE, level = 0 } = input(t);
    events.push(...machine.update({ nowMs: t, distanceRatio: distance, level }));
  }
  return events;
}

/** Within one 60 Hz step after the expected moment. */
function expectAround(value: number | null, expected: number, steps = 1) {
  expect(value).not.toBeNull();
  expect(value as number).toBeGreaterThanOrEqual(expected - 1e-6);
  expect(value as number).toBeLessThanOrEqual(expected + steps * STEP + 1e-6);
}

const phases = (events: TrialEvent[]) =>
  events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));

describe("ReachTrialMachine", () => {
  it("starts in SPAWN and moves to REACH on its first update", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    expect(machine.phase).toBe("SPAWN");
    expect(phases(machine.update({ nowMs: 0, distanceRatio: OUTSIDE, level: 0 }))).toEqual([
      "REACH",
    ]);
  });

  it("succeeds after entering, dwelling and squeezing", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    // Enter at 1000 ms, then squeeze from 1700 ms.
    const events = run(machine, 0, 2200, (t) => ({
      distance: t >= 1000 ? INSIDE : OUTSIDE,
      level: t >= 1700 ? 0.8 : 0,
    }));
    expect(phases(events)).toEqual(["REACH", "DWELL", "ACTIVATE", "OUTCOME"]);
    expect(machine.outcome).toBe("success");
    const { enter, dwellDone, activationStart, activationDone, end } = machine.moments;
    expectAround(enter, 1000);
    expectAround(dwellDone, 1500);
    expectAround(activationStart, 1700, 2);
    expectAround(activationDone, 1900, 2);
    expect(end).toBeGreaterThanOrEqual(activationDone as number);
    expectAround(machine.activation?.latencyMs ?? null, 200 - STEP, 2);
    expect(machine.activation?.peakLevel).toBe(0.8);
  });

  it("lets the hand go anywhere while squeezing", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 2500, (t) => ({
      distance: t < 1000 ? OUTSIDE : t < 1600 ? INSIDE : null, // Hand lost after the dwell.
      level: t >= 1700 ? 1 : 0,
    }));
    expect(machine.outcome).toBe("success");
  });

  it("empties the ring and goes back to REACH on leaving during the dwell", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    const events = run(machine, 0, 1800, (t) => ({
      distance: t >= 1000 && t < 1300 ? INSIDE : OUTSIDE,
    }));
    expect(events.filter((event) => event.type === "left")).toHaveLength(1);
    expect(machine.phase).toBe("REACH");
    expect(machine.dwellProgress).toBe(0);
    // The first entry is kept as the enter time.
    expectAround(machine.moments.enter, 1000);
    expect(machine.moments.dwellDone).toBeNull();
  });

  it("needs a full dwell again after coming back", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 2200, (t) => ({
      distance: (t >= 1000 && t < 1300) || t >= 1600 ? INSIDE : OUTSIDE,
    }));
    expect(machine.phase).toBe("ACTIVATE");
    expectAround(machine.moments.dwellDone, 2100);
  });

  it("fills the dwell ring as time passes inside", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 1250, (t) => ({ distance: t >= 1000 ? INSIDE : OUTSIDE }));
    expect(machine.dwellProgress).toBeCloseTo(0.5, 1);
  });

  it("ignores jitter just past the edge while dwelling", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 1600, (t) => ({
      distance: t < 1000 ? OUTSIDE : t % 100 < 50 ? 1 + LEAVE_MARGIN / 2 : 0.9,
    }));
    expect(machine.phase).toBe("ACTIVATE");
  });

  it("fails the reach at the time limit if never entered", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 7990, () => ({}));
    expect(machine.phase).toBe("REACH");
    run(machine, 8000, 8000, () => ({}));
    expect(machine.outcome).toBe("reach_fail");
    expect(machine.moments.end).toBe(8000);
  });

  it("lets a dwell under way finish after the time limit", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 8400, (t) => ({ distance: t >= 7800 ? INSIDE : OUTSIDE }));
    expect(machine.phase).toBe("ACTIVATE");
  });

  it("fails the reach on leaving the target after the time limit", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 8200, (t) => ({ distance: t >= 7800 && t < 8100 ? INSIDE : OUTSIDE }));
    expect(machine.outcome).toBe("reach_fail");
  });

  it("fails the activation if the squeeze is too weak for the whole window", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 5000, (t) => ({
      distance: t >= 1000 ? INSIDE : OUTSIDE,
      level: t >= 1500 ? 0.4 : 0,
    }));
    expect(machine.outcome).toBe("activation_fail");
    // The window opened at the dwell's end (about 1500 ms) and lasted 3000 ms.
    expectAround(machine.moments.end, 4500, 3);
    expect(machine.activation?.peakLevel).toBe(0.4);
    expect(machine.moments.activationStart).toBeNull();
  });

  it("fails the activation if the squeeze is not held long enough", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 5000, (t) => ({
      distance: t >= 1000 ? INSIDE : OUTSIDE,
      // Squeezes of 100 ms, shorter than the 200 ms hold.
      level: t >= 1500 && t % 400 < 100 ? 1 : 0,
    }));
    expect(machine.outcome).toBe("activation_fail");
  });

  it("shows the outcome, rests, then finishes", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    run(machine, 0, 8000, () => ({}));
    const end = machine.moments.end as number;
    expect(machine.phase).toBe("OUTCOME");
    const events = run(
      machine,
      end + STEP,
      end + OUTCOME_MS + SETTINGS.restMs + 2 * STEP,
      () => ({}),
    );
    expect(phases(events)).toEqual(["REST", "DONE"]);
    expect(machine.isLive).toBe(false);
  });

  it("reports entering once per entry", () => {
    const machine = new ReachTrialMachine(SETTINGS, 0);
    const events = run(machine, 0, 2000, (t) => ({
      distance: (t >= 500 && t < 700) || t >= 1000 ? INSIDE : OUTSIDE,
    }));
    expect(events.filter((event) => event.type === "entered")).toHaveLength(2);
  });
});
