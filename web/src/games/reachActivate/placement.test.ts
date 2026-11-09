import { describe, expect, it } from "vitest";

import { createPlayArea, DEFAULT_REACH_SW } from "@/games/shared/playArea";

import {
  keepOnScreen,
  placeTarget,
  reachInDirection,
  ringFor,
  type ScreenBounds,
  sectorName,
} from "./placement";

// Reach for 0, 45 … 315 degrees.
const RADII = [1.2, 1.0, 0.9, 0.6, 0.5, 0.6, 0.8, 1.1];
const WIDTH = 1600;
const HEIGHT = 900;
const BOUNDS: ScreenBounds = {
  width: WIDTH,
  height: HEIGHT,
  top: 96,
  right: 32,
  bottom: 32,
  left: 32,
};
const hull = RADII.map((radius, index) => ({
  x: radius * Math.cos((index * Math.PI) / 4),
  y: radius * Math.sin((index * Math.PI) / 4),
}));

describe("reachInDirection", () => {
  it("uses the calibrated reach on the eight directions", () => {
    RADII.forEach((radius, index) => expect(reachInDirection(RADII, index * 45)).toBe(radius));
  });

  it("interpolates between the two nearest directions", () => {
    expect(reachInDirection(RADII, 22.5)).toBeCloseTo(1.1);
    expect(reachInDirection(RADII, 30)).toBeCloseTo(1.2 - (0.2 * 30) / 45);
    expect(reachInDirection(RADII, 157.5)).toBeCloseTo(0.55);
  });

  it("wraps from 315 back to 0 degrees, and accepts angles outside 0–360", () => {
    expect(reachInDirection(RADII, 337.5)).toBeCloseTo(1.15);
    expect(reachInDirection(RADII, -22.5)).toBeCloseTo(1.15);
    expect(reachInDirection(RADII, 405)).toBeCloseTo(1.0);
  });

  it("uses the default reach without a usable calibration", () => {
    expect(reachInDirection(null, 90)).toBe(DEFAULT_REACH_SW);
    expect(reachInDirection([1, 1, 1], 90)).toBe(DEFAULT_REACH_SW);
    expect(reachInDirection([1, 1, 1, 0, 1, 1, 1, 1], 90)).toBe(DEFAULT_REACH_SW);
  });
});

describe("sector names", () => {
  it("puts distances into three rings", () => {
    expect(ringFor(0.4)).toBe(1);
    expect(ringFor(0.549)).toBe(1);
    expect(ringFor(0.55)).toBe(2);
    expect(ringFor(0.7)).toBe(2);
    expect(ringFor(0.85)).toBe(2);
    expect(ringFor(0.86)).toBe(3);
    expect(ringFor(1.1)).toBe(3);
  });

  it("names the direction index and the ring", () => {
    expect(sectorName(3, 0.7)).toBe("D3R2");
    expect(sectorName(0, 0.4)).toBe("D0R1");
    expect(sectorName(7, 1.0)).toBe("D7R3");
  });
});

describe.each(["left", "right"] as const)("placeTarget, %s side", (affectedSide) => {
  const transform = createPlayArea({ width: WIDTH, height: HEIGHT, affectedSide, hull });

  it("places the centre at distanceFrac of the reach in that direction", () => {
    const target = placeTarget({
      directionDeg: 90,
      directionIndex: 2,
      distanceFrac: 0.5,
      radiusSw: 0.3,
      reachRadiiSw: RADII,
      transform,
      bounds: BOUNDS,
    });
    expect(target.centreSw.x).toBeCloseTo(0);
    expect(target.centreSw.y).toBeCloseTo(0.45);
    expect(target.reachSw).toBeCloseTo(0.9);
    expect(target.sector).toBe("D2R1");
    expect(target.clamped).toBe(false);
  });

  it("goes outward along +x at 0 degrees", () => {
    const target = placeTarget({
      directionDeg: 0,
      directionIndex: 0,
      distanceFrac: 0.7,
      radiusSw: 0.3,
      reachRadiiSw: RADII,
      transform,
      bounds: BOUNDS,
    });
    expect(target.centreSw.x).toBeCloseTo(0.84);
    expect(target.centreSw.y).toBeCloseTo(0);
  });

  it("keeps a target that would leave the screen fully inside it", () => {
    const target = placeTarget({
      directionDeg: 90,
      directionIndex: 2,
      distanceFrac: 1.1,
      radiusSw: 0.6,
      reachRadiiSw: RADII,
      transform,
      bounds: BOUNDS,
    });
    expect(target.clamped).toBe(true);
    const centre = transform.toScreen(target.centreSw);
    const radiusPx = target.radiusSw * transform.pixelsPerSw;
    expect(centre.y - radiusPx).toBeCloseTo(BOUNDS.top);
    // Moved down only as far as needed, so still above the shoulder and on its direction.
    expect(target.centreSw.y).toBeLessThan(0.99);
    expect(target.centreSw.y).toBeGreaterThan(0);
    expect(target.centreSw.x).toBeCloseTo(0);
  });
});

describe("keepOnScreen", () => {
  const transform = createPlayArea({ width: WIDTH, height: HEIGHT, affectedSide: "right", hull });

  it("leaves a target that fits where it is", () => {
    const centre = { x: 0.3, y: 0.2 };
    expect(keepOnScreen(centre, 0.2, transform, BOUNDS)).toEqual({
      centreSw: centre,
      clamped: false,
    });
  });

  it("pulls a target back from every edge", () => {
    for (const centre of [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: -10 },
    ]) {
      const result = keepOnScreen(centre, 0.3, transform, BOUNDS);
      const pixel = transform.toScreen(result.centreSw);
      const radiusPx = 0.3 * transform.pixelsPerSw;
      expect(result.clamped).toBe(true);
      expect(pixel.x - radiusPx).toBeGreaterThanOrEqual(BOUNDS.left - 1e-6);
      expect(pixel.x + radiusPx).toBeLessThanOrEqual(WIDTH - BOUNDS.right + 1e-6);
      expect(pixel.y - radiusPx).toBeGreaterThanOrEqual(BOUNDS.top - 1e-6);
      expect(pixel.y + radiusPx).toBeLessThanOrEqual(HEIGHT - BOUNDS.bottom + 1e-6);
    }
  });
});
