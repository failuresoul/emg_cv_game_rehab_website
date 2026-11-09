import { describe, expect, it } from "vitest";

import { FixedTimestep, MAX_FRAME_MS, STEP_MS } from "./fixedTimestep";

function run(timestep: FixedTimestep, frames: number[]) {
  const calls: { dt: number; now: number }[] = [];
  const steps = frames.map((frame) =>
    timestep.advance(frame, (dt, now) => calls.push({ dt, now })),
  );
  return { calls, steps };
}

describe("FixedTimestep", () => {
  it("runs one 60 Hz update per frame on a 60 Hz screen", () => {
    const { calls, steps } = run(new FixedTimestep(), Array(60).fill(STEP_MS));
    expect(steps.every((count) => count === 1)).toBe(true);
    expect(calls).toHaveLength(60);
    expect(calls.every((call) => call.dt === STEP_MS)).toBe(true);
  });

  it("runs about one update every other frame on a 120 Hz screen", () => {
    const { calls, steps } = run(new FixedTimestep(), Array(120).fill(1000 / 120));
    expect(calls).toHaveLength(60);
    expect(steps.filter((count) => count === 0)).toHaveLength(60);
  });

  it("catches up with several updates after a slow frame", () => {
    const { steps } = run(new FixedTimestep(), [STEP_MS * 3]);
    expect(steps).toEqual([3]);
  });

  it("carries leftover time into the next frame", () => {
    const timestep = new FixedTimestep();
    expect(timestep.advance(STEP_MS * 1.5, () => {})).toBe(1);
    expect(timestep.alpha).toBeCloseTo(0.5);
    expect(timestep.advance(STEP_MS * 0.5, () => {})).toBe(1);
    expect(timestep.alpha).toBeCloseTo(0);
  });

  it("advances game time from its start by whole steps", () => {
    const timestep = new FixedTimestep(1000);
    const { calls } = run(timestep, [STEP_MS * 2]);
    expect(calls.map((call) => call.now)).toEqual([1000 + STEP_MS, 1000 + 2 * STEP_MS]);
    expect(timestep.now).toBeCloseTo(1000 + 2 * STEP_MS);
  });

  it("limits catching up after a long stall", () => {
    const { steps } = run(new FixedTimestep(), [5000]);
    expect(steps[0]).toBe(Math.round(MAX_FRAME_MS / STEP_MS));
  });

  it("ignores frames of no time or negative time", () => {
    const { steps } = run(new FixedTimestep(), [0, -16, Number.NaN]);
    expect(steps).toEqual([0, 0, 0]);
  });

  it("forgets leftover time on resetAccumulator", () => {
    const timestep = new FixedTimestep();
    timestep.advance(STEP_MS * 0.9, () => {});
    timestep.resetAccumulator();
    expect(timestep.advance(STEP_MS * 0.5, () => {})).toBe(0);
  });

  it("rejects a step of no time", () => {
    expect(() => new FixedTimestep(0, 0)).toThrow(RangeError);
  });
});
