import { describe, expect, it } from "vitest";

import {
  type BalloonEvent,
  BalloonMachine,
  type BalloonSettings,
  FLOAT_AWAY_MS,
  POP_MS,
} from "./balloonMachine";

const TOUCH: BalloonSettings = {
  riseMs: 2500,
  hoverMs: 7000,
  popMode: "touch",
  activationDemand: 0.5,
  activationHoldMs: 200,
  activationWindowMs: 3000,
  restMs: 1200,
};
const SQUEEZE: BalloonSettings = { ...TOUCH, popMode: "touch_squeeze" };
const STEP = 1000 / 60;
const OUTSIDE = 3;
const INSIDE = 0.5;

function run(
  machine: BalloonMachine,
  from: number,
  to: number,
  input: (t: number) => { distance?: number | null; level?: number },
): BalloonEvent[] {
  const events: BalloonEvent[] = [];
  for (let step = 0; from + step * STEP <= to + 1e-9; step++) {
    const t = from + step * STEP;
    const { distance = OUTSIDE, level = 0 } = input(t);
    events.push(...machine.update({ nowMs: t, distanceRatio: distance, level }));
  }
  return events;
}

const phases = (events: BalloonEvent[]) =>
  events.flatMap((event) => (event.type === "phase" ? [event.phase] : []));

describe("BalloonMachine timing", () => {
  it("rises for riseMs, then waits", () => {
    const machine = new BalloonMachine(TOUCH, 1000);
    run(machine, 1000, 3490, () => ({}));
    expect(machine.phase).toBe("RISE");
    expect(machine.riseProgress(2250)).toBeCloseTo(0.5);
    run(machine, 3500, 3500, () => ({}));
    expect(machine.phase).toBe("HOVER");
    expect(machine.moments.arrived).toBe(3500);
    expect(machine.waitedMs(4500)).toBe(1000);
  });

  it("cannot be popped while it is still rising", () => {
    const machine = new BalloonMachine(TOUCH, 0);
    run(machine, 0, 2400, () => ({ distance: INSIDE }));
    expect(machine.outcome).toBeNull();
    expect(machine.moments.touch).toBeNull();
  });

  it("floats away after waiting hoverMs, then rests and finishes", () => {
    const machine = new BalloonMachine(TOUCH, 0);
    run(machine, 0, 9490, () => ({}));
    expect(machine.phase).toBe("HOVER");
    const events = run(machine, 9500, 9500, () => ({}));
    expect(machine.outcome).toBe("miss");
    expect(machine.moments.end).toBe(9500);
    expect(phases(events)).toEqual(["FLOAT_AWAY"]);
    expect(machine.floatProgress(9500 + FLOAT_AWAY_MS / 2)).toBeCloseTo(0.5);

    const rest = run(
      machine,
      9500 + STEP,
      9500 + FLOAT_AWAY_MS + TOUCH.restMs + 2 * STEP,
      () => ({}),
    );
    expect(phases(rest)).toEqual(["REST", "DONE"]);
    expect(machine.isLive).toBe(false);
  });
});

describe("BalloonMachine popping", () => {
  it("pops on touch once it has arrived", () => {
    const machine = new BalloonMachine(TOUCH, 0);
    const events = run(machine, 0, 3300, (t) => ({ distance: t >= 3000 ? INSIDE : OUTSIDE }));
    expect(machine.outcome).toBe("success");
    expect(machine.moments.touch).toBeCloseTo(3000, -2);
    expect(machine.moments.pop).toBe(machine.moments.touch);
    expect(events.filter((event) => event.type === "touched")).toHaveLength(1);
    expect(phases(events)).toEqual(["RISE", "HOVER", "POPPED"]);
  });

  it("pops at once if the hand is already waiting where the balloon arrives", () => {
    const machine = new BalloonMachine(TOUCH, 0);
    run(machine, 0, 2600, () => ({ distance: INSIDE }));
    expect(machine.outcome).toBe("success");
    expect(machine.moments.pop).toBeCloseTo(2500, -2);
  });

  it("rests after the pop animation, then finishes", () => {
    const machine = new BalloonMachine(TOUCH, 0);
    run(machine, 0, 3000, (t) => ({ distance: t >= 3000 ? INSIDE : OUTSIDE }));
    const pop = machine.moments.pop as number;
    const events = run(machine, pop + STEP, pop + POP_MS + TOUCH.restMs + 2 * STEP, () => ({}));
    expect(phases(events)).toEqual(["REST", "DONE"]);
  });

  it("needs a squeeze after the touch in touch_squeeze mode", () => {
    const machine = new BalloonMachine(SQUEEZE, 0);
    run(machine, 0, 3200, (t) => ({ distance: t >= 3000 ? INSIDE : OUTSIDE }));
    expect(machine.phase).toBe("SQUEEZE");
    expect(machine.outcome).toBeNull();

    // The hand may leave the balloon while squeezing.
    run(machine, 3200, 4000, (t) => ({ distance: OUTSIDE, level: t >= 3500 ? 1 : 0 }));
    expect(machine.outcome).toBe("success");
    expect(machine.moments.activationStart).toBeCloseTo(3500, -2);
    expect(machine.moments.activationDone).toBeCloseTo(3700, -2);
    expect(machine.activation?.latencyMs).toBeGreaterThan(0);
  });

  it("lets the patient touch again after a squeeze that falls short", () => {
    const machine = new BalloonMachine(SQUEEZE, 0);
    // Touch at 3000, a weak squeeze, then the 3-second window ends.
    run(machine, 0, 6100, (t) => ({
      distance: t >= 3000 && t < 3100 ? INSIDE : OUTSIDE,
      level: 0.3,
    }));
    expect(machine.phase).toBe("HOVER");
    expect(machine.outcome).toBeNull();

    run(machine, 6100, 7000, (t) => ({
      distance: t >= 6500 ? INSIDE : OUTSIDE,
      level: t >= 6600 ? 1 : 0,
    }));
    expect(machine.outcome).toBe("success");
    // The first touch is kept as the reach's end.
    expect(machine.moments.touch).toBeCloseTo(3000, -2);
  });

  it("floats away when a squeeze falls short after the waiting time", () => {
    const machine = new BalloonMachine(SQUEEZE, 0);
    run(machine, 0, 13000, (t) => ({ distance: t >= 8000 ? INSIDE : OUTSIDE, level: 0.2 }));
    expect(machine.outcome).toBe("miss");
    // The squeeze that began at 8000 ran its 3 s past the 9500 ms end of waiting.
    expect(machine.moments.end).toBeGreaterThanOrEqual(11000);
  });
});
