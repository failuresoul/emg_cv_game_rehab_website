import { describe, expect, it } from "vitest";

import { createPlayArea, DEFAULT_REACH_SW } from "@/games/shared/playArea";

import { basketX, covers, fallMs, fruitSector, fruitX, lateralRange } from "./lateral";

// Reach for 0, 45 … 315 degrees: further outward (1.3) than across the body (0.6).
const RADII = [1.3, 1.0, 0.9, 0.7, 0.6, 0.6, 0.8, 1.1];

describe("lateralRange", () => {
  it("goes from the reach across the body to the reach outward", () => {
    expect(lateralRange(RADII)).toEqual({ min: -0.6, max: 1.3 });
  });

  it("uses the default reach without a calibration", () => {
    expect(lateralRange(null)).toEqual({ min: -DEFAULT_REACH_SW, max: DEFAULT_REACH_SW });
  });
});

describe.each(["left", "right"] as const)("lateral layout, %s side", (affectedSide) => {
  const hull = RADII.map((radius, index) => ({
    x: radius * Math.cos((index * Math.PI) / 4),
    y: radius * Math.sin((index * Math.PI) / 4),
  }));
  const area = createPlayArea({
    width: 1600,
    height: 900,
    affectedSide,
    hull,
    insets: { top: 72 },
  });
  const range = lateralRange(RADII);

  it("puts outward fruit on the affected arm's side of the screen, across on the other", () => {
    const shoulder = area.toScreen({ x: 0, y: 0 }).x;
    const out = area.toScreen({ x: fruitX("out", 1, 1, range), y: 0 }).x;
    const across = area.toScreen({ x: fruitX("across", 1, 1, range), y: 0 }).x;
    const outward = affectedSide === "left" ? -1 : 1;
    expect(Math.sign(out - shoulder)).toBe(outward);
    expect(Math.sign(across - shoulder)).toBe(-outward);
  });

  it("keeps the whole range on screen", () => {
    for (const x of [range.min, range.max]) {
      const pixel = area.toScreen({ x, y: -0.3 }).x;
      expect(pixel).toBeGreaterThan(0);
      expect(pixel).toBeLessThan(1600);
    }
  });
});

describe("fruit and basket positions", () => {
  const range = lateralRange(RADII);

  it("places fruit at a share of the spread on its side", () => {
    expect(fruitX("out", 1, 0.7, range)).toBeCloseTo(0.91);
    expect(fruitX("out", 0.4, 0.7, range)).toBeCloseTo(0.364);
    expect(fruitX("across", 1, 0.7, range)).toBeCloseTo(-0.42);
    expect(fruitX("across", 0.7, 1, range)).toBeCloseTo(-0.42);
  });

  it("keeps the basket within the range", () => {
    expect(basketX(0.5, range)).toBe(0.5);
    expect(basketX(2, range)).toBe(1.3);
    expect(basketX(-2, range)).toBe(-0.6);
  });

  it("catches when the fruit is within half the basket's width", () => {
    expect(covers(0.5, 0.7, 0.85)).toBe(true);
    expect(covers(0.5, 0.7, 0.15)).toBe(true);
    expect(covers(0.5, 0.7, 0.86)).toBe(false);
    expect(covers(0.5, 0.7, 0.14)).toBe(false);
  });

  it("names out as D0 and across as D4, with a ring by distance", () => {
    expect(fruitSector("out", 0.5, range)).toBe("D0R1");
    expect(fruitSector("out", 1.2, range)).toBe("D0R3");
    expect(fruitSector("across", -0.4, range)).toBe("D4R2");
  });

  it("times a steady fall", () => {
    expect(fallMs(1.4, -0.3, 0.34)).toBeCloseTo(5000);
    expect(fallMs(-0.3, 1, 0.5)).toBe(0);
    expect(fallMs(1, 0, 0)).toBe(Infinity);
  });
});
