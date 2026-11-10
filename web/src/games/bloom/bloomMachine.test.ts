import { describe, expect, it } from "vitest";

import {
  BLOOM_MS,
  type BloomEvent,
  BloomMachine,
  type BloomSettings,
  MISS_MS,
  SEED_FLIGHT_MS,
} from "./bloomMachine";

const STEP = 1000 / 60;
const SETTINGS: BloomSettings = {
  openDemand: 0.7,
  openHoldMs: 800,
  closeDemand: 0.6,
  closeHoldMs: 300,
  phaseTimeLimitMs: 8000,
  restMs: 1500,
};

interface Levels {
  openness: (t: number) => number;
  grip: (t: number) => number;
}

function create(levels: Levels, settings: BloomSettings = SETTINGS) {
  const machine = new BloomMachine(settings, 0);
  const events: BloomEvent[] = [];
  let now = 0;
  let current = levels;
  return {
    machine,
    events,
    set(next: Levels) {
      current = next;
    },
    runUntil(until: number) {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        events.push(
          ...machine.update({
            nowMs: now,
            openness: current.openness(now),
            grip: current.grip(now),
          }),
        );
      }
    },
    phases: () =>
      events.flatMap((event) => (event.type === "phase" ? [event.phase] : [])) as string[],
  };
}

const after = (from: number, level: number) => (t: number) => (t >= from ? level : 0);

describe("BloomMachine", () => {
  it("blooms once the hand stays open enough for the hold time", () => {
    const sim = create({ openness: after(1000, 0.9), grip: () => 0 });
    sim.runUntil(1700);
    expect(sim.machine.phase).toBe("OPEN");
    expect(sim.machine.holdProgress).toBeGreaterThan(0.8);

    sim.runUntil(1900);
    expect(sim.machine.phase).toBe("BLOOMED");
    expect(sim.events.some((event) => event.type === "bloomed")).toBe(true);
    expect(sim.machine.moments.openOnset).toBeCloseTo(1000, -2);
    expect(
      (sim.machine.moments.bloomed as number) - (sim.machine.moments.openOnset as number),
    ).toBeCloseTo(800, -1);
    expect(sim.machine.isLive).toBe(true);
    expect(sim.machine.outcome).toBeNull();
  });

  it("misses calmly when the hand does not open enough in time", () => {
    const sim = create({ openness: () => 0.5, grip: () => 0 });
    sim.runUntil(7900);
    expect(sim.machine.phase).toBe("OPEN");
    sim.runUntil(8100);
    expect(sim.machine.phase).toBe("MISSED");
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.machine.failedPhase).toBe("open");
    expect(sim.machine.isLive).toBe(false);
    expect(sim.events).toContainEqual({ type: "outcome", outcome: "miss", failedPhase: "open" });

    sim.runUntil(8100 + MISS_MS);
    expect(sim.machine.phase).toBe("REST");
    sim.runUntil(8100 + MISS_MS + SETTINGS.restMs);
    expect(sim.machine.phase).toBe("DONE");
    expect(sim.machine.moments.closeStart).toBeNull();
  });

  it("starts the hold again when openness drops below the demand", () => {
    const openness = (t: number) => (t >= 1000 && (t < 1500 || t >= 1700) ? 0.9 : 0.3);
    const sim = create({ openness, grip: () => 0 });
    sim.runUntil(1490);
    expect(sim.machine.holdProgress).toBeGreaterThan(0.5);
    sim.runUntil(1600);
    expect(sim.machine.holdProgress).toBe(0);

    // The first hold would have finished at 1800; the new one only finishes at 2500.
    sim.runUntil(2400);
    expect(sim.machine.phase).toBe("OPEN");
    sim.runUntil(2600);
    expect(sim.machine.phase).toBe("BLOOMED");
    expect(sim.machine.moments.openOnset).toBeCloseTo(1700, -2);
  });

  it("keeps the hold through a dip smaller than the hysteresis", () => {
    const openness = (t: number) => (t < 1000 ? 0 : t >= 1300 && t < 1400 ? 0.67 : 0.75);
    const sim = create({ openness, grip: () => 0 });
    sim.runUntil(1900);
    expect(sim.machine.phase).toBe("BLOOMED");
  });

  it("collects the seed when the grip reaches the demand for 300 ms", () => {
    const sim = create({ openness: after(0, 0.9), grip: () => 0 });
    sim.runUntil(900);
    expect(sim.machine.phase).toBe("BLOOMED");
    const closeStartsAt = (sim.machine.moments.bloomed as number) + BLOOM_MS;
    sim.runUntil(closeStartsAt + STEP);
    expect(sim.machine.phase).toBe("CLOSE");
    // The frame after the bloom's display time.
    const closeStart = sim.machine.moments.closeStart as number;
    expect(closeStart).toBeGreaterThanOrEqual(closeStartsAt);
    expect(closeStart).toBeLessThanOrEqual(closeStartsAt + 2 * STEP);

    sim.set({ openness: () => 0, grip: after(closeStartsAt + 500, 0.8) });
    sim.runUntil(closeStartsAt + 750);
    expect(sim.machine.phase).toBe("CLOSE");
    sim.runUntil(closeStartsAt + 850);
    expect(sim.machine.phase).toBe("COLLECTED");
    expect(sim.machine.outcome).toBe("success");
    expect(sim.machine.failedPhase).toBeNull();
    expect(sim.machine.peakGrip).toBeCloseTo(0.8);
    const { closeOnset, closeDone } = sim.machine.moments;
    expect((closeOnset as number) - closeStart).toBeCloseTo(500, -2);
    expect((closeDone as number) - (closeOnset as number)).toBeCloseTo(300, -1);

    sim.runUntil(closeStartsAt + 850 + SEED_FLIGHT_MS + SETTINGS.restMs + 2 * STEP);
    expect(sim.phases()).toEqual(["BLOOMED", "CLOSE", "COLLECTED", "REST", "DONE"]);
  });

  it("misses in the closing phase when there is no fist in time", () => {
    const sim = create({ openness: after(0, 0.9), grip: () => 0.4 });
    sim.runUntil(900 + BLOOM_MS + 8000 + 2 * STEP);
    expect(sim.machine.phase).toBe("MISSED");
    expect(sim.machine.failedPhase).toBe("close");
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.machine.peakGrip).toBeCloseTo(0.4);
    expect(sim.machine.moments.closeOnset).toBeNull();
  });

  it("records openness only while opening", () => {
    const sim = create({ openness: after(0, 0.9), grip: () => 0 });
    sim.runUntil(3000);
    const samples = sim.machine.opennessSamples;
    expect(samples.length).toBeGreaterThan(40);
    // The last reading is the frame that completed the hold.
    expect(samples.at(-1)?.t).toBeLessThanOrEqual((sim.machine.moments.bloomed as number) + STEP);
  });
});
