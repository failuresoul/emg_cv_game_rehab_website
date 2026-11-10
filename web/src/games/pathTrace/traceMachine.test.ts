import { describe, expect, it } from "vitest";

import {
  OUTCOME_MS,
  START_RADIUS_SW,
  START_TIMEOUT_MS,
  type TraceEvent,
  TraceMachine,
  type TraceSettings,
} from "./traceMachine";

const STEP = 1000 / 60;
const SETTINGS: TraceSettings = {
  pathLengthSw: 1,
  guideSpeedSwS: 0.25,
  startHoldMs: 500,
  restMs: 2000,
};

function create(settings: TraceSettings = SETTINGS) {
  const machine = new TraceMachine(settings, 0);
  const events: TraceEvent[] = [];
  let now = 0;
  let distanceAt: (t: number) => number | null = () => 1;
  return {
    machine,
    events,
    cursor(next: (t: number) => number | null) {
      distanceAt = next;
    },
    runUntil(until: number) {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        events.push(...machine.update({ nowMs: now, distanceToStartSw: distanceAt(now) }));
      }
    },
    get now() {
      return now;
    },
  };
}

const inside = () => START_RADIUS_SW * 0.5;
const outside = () => START_RADIUS_SW * 3;

describe("start circle", () => {
  it("starts the guide once the fingertip has held still in the circle for 500 ms", () => {
    const sim = create();
    sim.cursor((t) => (t >= 1000 ? inside() : outside()));
    sim.runUntil(1400);
    expect(sim.machine.phase).toBe("START");
    expect(sim.machine.holdProgress).toBeGreaterThan(0.7);
    sim.runUntil(1520);
    expect(sim.machine.phase).toBe("TRACE");
    expect(sim.machine.moments.startEnter).toBeCloseTo(1000, -2);
    expect(
      (sim.machine.moments.traceStart as number) - (sim.machine.moments.startEnter as number),
    ).toBeCloseTo(500, -2);
  });

  it("starts the hold again when the fingertip leaves the circle", () => {
    const sim = create();
    sim.cursor((t) => (t >= 1000 && (t < 1300 || t >= 1500) ? inside() : outside()));
    sim.runUntil(1400);
    expect(sim.machine.holdProgress).toBe(0);
    expect(sim.events.map((event) => event.type)).toContain("left");
    sim.runUntil(1950);
    expect(sim.machine.phase).toBe("START");
    sim.runUntil(2050);
    expect(sim.machine.phase).toBe("TRACE");
  });

  it("keeps the hold through jitter just past the circle's edge", () => {
    const sim = create();
    sim.cursor((t) => (t < 1000 ? outside() : t < 1200 ? inside() : START_RADIUS_SW * 1.15));
    sim.runUntil(1550);
    expect(sim.machine.phase).toBe("TRACE");
  });

  it("does not count a lost hand as inside", () => {
    const sim = create();
    sim.cursor(() => null);
    sim.runUntil(3000);
    expect(sim.machine.holdProgress).toBe(0);
    expect(sim.machine.moments.startEnter).toBeNull();
  });

  it("ends calmly if the circle is not held within 15 seconds", () => {
    const sim = create();
    sim.cursor(outside);
    sim.runUntil(START_TIMEOUT_MS - 50);
    expect(sim.machine.phase).toBe("START");
    sim.runUntil(START_TIMEOUT_MS + 50);
    expect(sim.machine.phase).toBe("OUTCOME");
    expect(sim.machine.startTimedOut).toBe(true);
    expect(sim.events.map((event) => event.type)).toContain("startTimeout");
    expect(sim.machine.moments.traceStart).toBeNull();
  });
});

describe("guide", () => {
  function tracing() {
    const sim = create();
    sim.cursor(inside);
    sim.runUntil(600);
    expect(sim.machine.phase).toBe("TRACE");
    return { sim, start: sim.machine.moments.traceStart as number };
  }

  it("moves along the path at the guide speed", () => {
    const { sim, start } = tracing();
    expect(sim.machine.guideDistance(start)).toBe(0);
    expect(sim.machine.guideDistance(start + 1000)).toBeCloseTo(0.25);
    expect(sim.machine.guideDistance(start + 2000)).toBeCloseTo(0.5);
    // Never past the end, or before the start.
    expect(sim.machine.guideDistance(start + 60_000)).toBe(1);
    expect(sim.machine.guideDistance(start - 500)).toBe(0);
    expect(sim.machine.traceDurationMs).toBeCloseTo(4000);
  });

  it("finishes the trace when the guide reaches the end, then rests", () => {
    const { sim, start } = tracing();
    sim.runUntil(start + 3950);
    expect(sim.machine.phase).toBe("TRACE");
    sim.runUntil(start + 4050);
    expect(sim.machine.phase).toBe("OUTCOME");
    expect(sim.machine.isLive).toBe(false);
    expect(sim.events.map((event) => event.type)).toContain("traceDone");
    expect(sim.machine.moments.traceEnd).toBeCloseTo(start + 4000, -2);

    const end = sim.machine.moments.end as number;
    sim.runUntil(end + OUTCOME_MS + STEP);
    expect(sim.machine.phase).toBe("REST");
    sim.runUntil(end + OUTCOME_MS + SETTINGS.restMs + 2 * STEP);
    expect(sim.machine.phase).toBe("DONE");
  });

  it("is twice as quick at twice the speed", () => {
    const sim = create({ ...SETTINGS, guideSpeedSwS: 0.5 });
    expect(sim.machine.traceDurationMs).toBeCloseTo(2000);
  });
});
