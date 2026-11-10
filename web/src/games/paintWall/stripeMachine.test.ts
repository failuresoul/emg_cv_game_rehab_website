import { describe, expect, it } from "vitest";

import { OUTCOME_MS, type StripeEvent, StripeMachine, type StripeSettings } from "./stripeMachine";
import { BOTTOM_HEIGHT, type Sweep, SweepDetector } from "./sweepDetector";

const STEP = 1000 / 60;
const SETTINGS: StripeSettings = {
  targetHeight: 0.75,
  sweepsNeeded: 3,
  timeLimitMs: 30000,
  restMs: 2000,
};

/** Up to `peak` and back down over `ms` as a smooth hump, starting at `start`. */
const hump = (start: number, ms: number, peak: number) => (t: number) => {
  const share = (t - start) / ms;
  return share <= 0 || share >= 1 ? 0 : peak * Math.sin(Math.PI * share);
};

function detect(heights: (t: number) => number | null, until: number, target = 0.75): Sweep[] {
  const detector = new SweepDetector(target);
  const found: Sweep[] = [];
  for (let t = STEP; t <= until; t += STEP) {
    const sweep = detector.update(heights(t), t);
    if (sweep) found.push(sweep);
  }
  return found;
}

describe("SweepDetector", () => {
  it("counts a sweep to the target and back as full, with its duration", () => {
    const [sweep, ...rest] = detect(hump(500, 2000, 0.9), 3000);
    expect(rest).toEqual([]);
    expect(sweep.kind).toBe("full");
    expect(sweep.peakHeight).toBeCloseTo(0.9, 2);
    // It leaves the bottom soon after 500 ms and is back a little before 2500 ms.
    expect(sweep.durationMs).toBeGreaterThan(1600);
    expect(sweep.durationMs).toBeLessThan(2000);
  });

  it("counts a sweep that does not reach the target as partial", () => {
    expect(detect(hump(500, 2000, 0.5), 3000).map((sweep) => sweep.kind)).toEqual(["partial"]);
  });

  it("ignores jitter near the bottom", () => {
    expect(detect((t) => 0.12 + 0.1 * Math.sin(t / 37), 5000)).toEqual([]);
  });

  it("does not split a sweep that wobbles near the top", () => {
    const wobbly = (t: number) => {
      const base = hump(500, 3000, 0.85)(t);
      return base > 0.5 ? base + 0.08 * Math.sin(t / 40) : base;
    };
    expect(detect(wobbly, 4000).map((sweep) => sweep.kind)).toEqual(["full"]);
  });

  it("waits while the arm is out of sight", () => {
    const lost = (t: number) => (t > 1000 && t < 1500 ? null : hump(500, 2000, 0.9)(t));
    expect(detect(lost, 3000)).toHaveLength(1);
    const detector = new SweepDetector(0.75);
    expect(detector.update(BOTTOM_HEIGHT, 100)).toBeNull();
  });
});

function create(settings: StripeSettings = SETTINGS) {
  const stripe = new StripeMachine(settings, 0);
  const events: StripeEvent[] = [];
  let now = 0;
  return {
    stripe,
    events,
    run(
      until: number,
      height: (t: number) => number | null,
      elevation: (t: number) => number | null = () => 20,
    ) {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        events.push(
          ...stripe.update({ nowMs: now, height: height(now), armElevationDeg: elevation(now) }),
        );
      }
    },
  };
}

/** `count` sweeps of 2 s each, 2.2 s apart from 500 ms, each up to `peak`. */
const sweeps = (count: number, peak: number) => (t: number) => {
  const index = Math.floor((t - 500) / 2200);
  if (t < 500 || index >= count) return 0;
  return hump(500 + index * 2200, 2000, peak)(t);
};

describe("StripeMachine", () => {
  it("finishes the stripe after the sweeps needed, with a full coat for each", () => {
    const sim = create();
    sim.run(8000, sweeps(3, 0.9));
    expect(sim.stripe.outcome).toBe("success");
    expect(sim.stripe.isLive).toBe(false);
    expect(sim.stripe.fullSweeps).toBe(3);
    expect(sim.stripe.coats).toEqual([
      { height: 0.75, strength: 1 },
      { height: 0.75, strength: 1 },
      { height: 0.75, strength: 1 },
    ]);
    expect(sim.events).toContainEqual({ type: "outcome", outcome: "success" });
  });

  it("paints a lighter coat for a partial sweep, up to the height reached", () => {
    const sim = create();
    sim.run(3000, sweeps(1, 0.5));
    expect(sim.stripe.partialSweeps).toBe(1);
    expect(sim.stripe.coats).toHaveLength(1);
    expect(sim.stripe.coats[0].strength).toBe(0.5);
    expect(sim.stripe.coats[0].height).toBeCloseTo(0.5, 2);
    expect(sim.stripe.phase).toBe("PAINT");
  });

  it("ends as a miss at the time limit, keeping the paint", () => {
    const sim = create({ ...SETTINGS, timeLimitMs: 6000 });
    sim.run(7000, sweeps(2, 0.9));
    expect(sim.stripe.outcome).toBe("miss");
    expect(sim.stripe.fullSweeps).toBe(2);
    expect(sim.stripe.coats).toHaveLength(2);
    expect(sim.stripe.endMs).toBeCloseTo(6000, -2);
  });

  it("rests after the outcome and then finishes", () => {
    const sim = create();
    sim.run(8000, sweeps(3, 0.9));
    const end = sim.stripe.endMs as number;
    sim.run(end + OUTCOME_MS + SETTINGS.restMs + 100, () => 0);
    expect(sim.stripe.phase).toBe("DONE");
  });

  it("flags the upper arm moving more than 20° during a sweep, once per sweep", () => {
    const sim = create();
    // The arm starts at 20° and is raised to 50° once the sweeps have begun.
    sim.run(5000, sweeps(2, 0.9), (t) => (t > 900 ? 50 : 20));
    expect(sim.stripe.upperArmFlagged).toBe(true);
    expect(sim.stripe.upperArmMotionDeg).toBeCloseTo(30);
    expect(sim.events.filter((event) => event.type === "upperArmMoved")).toHaveLength(2);
  });

  it("does not flag a small drift during sweeps, or a move between them", () => {
    const sim = create();
    sim.run(5000, sweeps(1, 0.9), (t) => (t > 3000 ? 70 : 20 + (t / 1000) * 3));
    expect(sim.stripe.upperArmFlagged).toBe(false);
    expect(sim.stripe.upperArmMotionDeg as number).toBeLessThan(20);
  });
});
