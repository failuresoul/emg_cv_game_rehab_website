import { describe, expect, it } from "vitest";

import { type HoldEvent, HoldMachine, type HoldSettings, OUTCOME_MS } from "./holdMachine";

const STEP = 1000 / 60;
/** The band is 0.35–0.65. */
const SETTINGS: HoldSettings = {
  bandCenter: 0.5,
  bandWidth: 0.3,
  holdMs: 3000,
  timeLimitMs: 15000,
  relaxBelow: 0.15,
  relaxWithinMs: 3000,
  restMs: 2000,
};

function create(settings: HoldSettings = SETTINGS) {
  const machine = new HoldMachine(settings, 0);
  const events: HoldEvent[] = [];
  let now = 0;
  return {
    machine,
    events,
    /** Feeds the level until `until`. */
    run(until: number, level: (t: number) => number) {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        events.push(...machine.update(now, level(now)));
      }
    },
    get now() {
      return now;
    },
  };
}

describe("HoldMachine", () => {
  it("runs the hold timer only inside the band, pausing rather than restarting", () => {
    const sim = create();
    sim.run(1000, () => 0.5);
    expect(sim.machine.tally.inBandMs).toBeCloseTo(1000, -1);
    expect(sim.machine.holdProgress).toBeCloseTo(1 / 3, 1);

    // Out of the band, below and above: the timer stands still.
    sim.run(2000, () => 0.2);
    sim.run(2500, () => 0.8);
    expect(sim.machine.tally.inBandMs).toBeCloseTo(1000, -1);
    expect(sim.machine.inBand).toBe(false);

    // Back in: it carries on from where it was.
    sim.run(3500, () => 0.4);
    expect(sim.machine.tally.inBandMs).toBeCloseTo(2000, -2);
    expect(sim.machine.phase).toBe("HOLD");
    sim.run(4600, () => 0.6);
    expect(sim.machine.phase).toBe("RELAX");
    expect(sim.machine.moments.holdDone).toBeCloseTo(4500, -2);
    expect(sim.machine.tally.longestRunMs).toBeCloseTo(2000, -2);
  });

  it("counts the band's edges as inside", () => {
    const sim = create();
    sim.run(500, () => 0.35);
    sim.run(1000, () => 0.65);
    expect(sim.machine.tally.inBandMs).toBeCloseTo(1000, -1);
  });

  it("succeeds when the hand relaxes in time after the hold", () => {
    const sim = create();
    sim.run(600, () => 0.1);
    sim.run(3700, () => 0.5);
    expect(sim.machine.phase).toBe("RELAX");
    const holdDone = sim.machine.moments.holdDone as number;
    sim.run(holdDone + 800, () => 0.3);
    sim.run(holdDone + 1000, () => 0.05);
    expect(sim.machine.outcome).toBe("success");
    expect(sim.machine.failedPhase).toBeNull();
    expect(sim.machine.phase).toBe("SUCCESS");
    expect((sim.machine.moments.relaxed as number) - holdDone).toBeCloseTo(800, -2);
    expect(sim.machine.moments.firstInBand).toBeCloseTo(600, -2);
    expect(sim.events).toContainEqual({ type: "outcome", outcome: "success", failedPhase: null });
  });

  it("misses in the relax phase when the hand does not relax in time", () => {
    const sim = create();
    sim.run(3100, () => 0.5);
    expect(sim.machine.phase).toBe("RELAX");
    const holdDone = sim.machine.moments.holdDone as number;
    sim.run(holdDone + 3100, () => 0.3);
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.machine.failedPhase).toBe("relax");
    expect(sim.machine.moments.end).toBeCloseTo(holdDone + 3000, -2);
    expect(sim.machine.moments.relaxed).toBeNull();
  });

  it("misses in the hold phase at the time limit", () => {
    const sim = create({ ...SETTINGS, timeLimitMs: 10000, holdMs: 6000 });
    // Inside only half the time: 5 s of 10 s, not enough for a 6 s hold.
    sim.run(10100, (t) => (Math.floor(t / 1000) % 2 === 0 ? 0.5 : 0.1));
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.machine.failedPhase).toBe("hold");
    expect(sim.machine.moments.holdDone).toBeNull();
  });

  it("counts each time the level goes above the band once, with the largest overshoot", () => {
    const sim = create();
    sim.run(500, () => 0.5);
    // Jitter across the top counts once: it never falls 0.03 below the top.
    sim.run(1000, (t) => (Math.floor(t / STEP) % 2 === 0 ? 0.67 : 0.64));
    sim.run(1200, () => 0.5);
    sim.run(1500, () => 0.8);
    sim.run(1700, () => 0.5);
    sim.run(1900, () => 0.72);
    expect(sim.machine.tally.overshootCount).toBe(3);
    expect(sim.machine.tally.maxOvershoot).toBeCloseTo(0.15);
    expect(sim.events.filter((event) => event.type === "overshoot")).toHaveLength(3);
  });

  it("sums the time in the band against the active time", () => {
    const sim = create({ ...SETTINGS, timeLimitMs: 4000, holdMs: 8000 });
    sim.run(4100, (t) => (t <= 1000 ? 0.1 : 0.5));
    expect(sim.machine.tally.activeMs).toBeCloseTo(4000, -2);
    expect(sim.machine.tally.inBandMs).toBeCloseTo(3000, -2);
  });

  it("shows the outcome, rests and then finishes", () => {
    const sim = create();
    sim.run(3100, () => 0.5);
    sim.run(3200, () => 0);
    const end = sim.machine.moments.end as number;
    expect(sim.machine.outcomeProgress(end + OUTCOME_MS / 2)).toBeCloseTo(0.5);
    sim.run(end + OUTCOME_MS + 50, () => 0);
    expect(sim.machine.phase).toBe("REST");
    sim.run(end + OUTCOME_MS + SETTINGS.restMs + 50, () => 0);
    expect(sim.machine.phase).toBe("DONE");
    expect(sim.machine.isLive).toBe(false);
  });
});
