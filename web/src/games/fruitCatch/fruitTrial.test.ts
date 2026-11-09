import { describe, expect, it } from "vitest";

import { CATCH_MS, type FruitEvent, FruitTrial, LANDED_MS } from "./fruitTrial";
import { BASKET_LINE_Y_SW } from "./lateral";

const STEP = 1000 / 60;
// Falls 1.7 SW to the basket line in 5 s, and another 0.5 SW to the ground.
const SETUP = { x: 0.8, startY: 1.4, groundY: -0.8, speedSwS: 0.34, basketWidthSw: 0.7 };

function run(trial: FruitTrial, from: number, to: number, basket: (t: number) => number | null) {
  const events: FruitEvent[] = [];
  for (let step = 0; from + step * STEP <= to + 1e-9; step++) {
    const t = from + step * STEP;
    events.push(...trial.update(t, basket(t)));
  }
  return events;
}

describe("FruitTrial", () => {
  it("falls at a steady speed", () => {
    const trial = new FruitTrial(SETUP, 1000);
    expect(trial.y(1000)).toBeCloseTo(1.4);
    expect(trial.y(3500)).toBeCloseTo(1.4 - 0.85);
  });

  it("is caught when the basket covers it at the basket line", () => {
    const trial = new FruitTrial(SETUP, 0);
    // The basket arrives under the fruit at 2 s and stays.
    const events = run(trial, 0, 5100, (t) => (t >= 2000 ? 0.7 : 0));
    expect(trial.outcome).toBe("success");
    expect(trial.moments.end).toBeGreaterThanOrEqual(5000);
    expect(trial.moments.end).toBeLessThan(5000 + STEP + 1e-6);
    expect(trial.moments.under).toBeCloseTo(2000, -2);
    expect(events.filter((event) => event.type === "under")).toHaveLength(1);
    // It stays in the basket.
    expect(trial.y(5500)).toBe(BASKET_LINE_Y_SW);
  });

  it("is missed if the basket is away at the line, even if it was under earlier", () => {
    const trial = new FruitTrial(SETUP, 0);
    run(trial, 0, 5100, (t) => (t < 3000 ? 0.8 : -0.4));
    expect(trial.outcome).toBe("miss");
    expect(trial.moments.under).not.toBeNull();
    expect(trial.phase).toBe("DROPPING");
  });

  it("lands softly on the ground after a miss, then finishes", () => {
    const trial = new FruitTrial(SETUP, 0);
    const events = run(trial, 0, 8000, () => -0.5);
    const landed = events.findIndex((event) => event.type === "landed");
    expect(landed).toBeGreaterThan(-1);
    expect(trial.y(7000)).toBeCloseTo(SETUP.groundY);
    expect(events.at(-1)?.type).toBe("done");
    // Ground reached at about 6.47 s, then the landing shows for LANDED_MS.
    expect(trial.phase).toBe("DONE");
    expect(6470 + LANDED_MS).toBeLessThan(8000);
  });

  it("shows a catch briefly, then finishes", () => {
    const trial = new FruitTrial(SETUP, 0);
    run(trial, 0, 5000 + CATCH_MS - 50, () => 0.8);
    expect(trial.phase).toBe("CAUGHT");
    run(trial, 5000 + CATCH_MS, 5000 + CATCH_MS + 2 * STEP, () => 0.8);
    expect(trial.phase).toBe("DONE");
  });

  it("counts a missing hand as no basket", () => {
    const trial = new FruitTrial(SETUP, 0);
    run(trial, 0, 5100, () => null);
    expect(trial.outcome).toBe("miss");
    expect(trial.moments.under).toBeNull();
  });
});
