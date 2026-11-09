import { describe, expect, it } from "vitest";

import { createPlayArea } from "@/games/shared/playArea";
import type { ScreenBounds } from "@/games/shared/targetPlacement";

import { balloonPosition, placeBalloon, SWAY_SW } from "./placement";

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

describe.each(["left", "right"] as const)("placeBalloon, %s side", (affectedSide) => {
  const transform = createPlayArea({
    width: WIDTH,
    height: HEIGHT,
    affectedSide,
    hull,
    insets: { top: 72 },
  });
  const place = (directionDeg: number, heightFrac: number, radiusSw = 0.3) =>
    placeBalloon({
      directionDeg,
      directionIndex: directionDeg / 45,
      heightFrac,
      radiusSw,
      reachRadiiSw: RADII,
      transform,
      bounds: BOUNDS,
    });

  it("waits straight up at heightFrac of the reach up", () => {
    const balloon = place(90, 0.7);
    expect(balloon.centreSw.x).toBeCloseTo(0);
    expect(balloon.centreSw.y).toBeCloseTo(0.7 * 0.9);
    expect(balloon.sector).toBe("D2R2");
    expect(balloon.clamped).toBe(false);
  });

  it("waits up and out at 45 degrees, and up and across at 135", () => {
    const out = place(45, 0.55);
    expect(out.centreSw.x).toBeCloseTo(0.55 * Math.SQRT1_2);
    expect(out.centreSw.y).toBeCloseTo(0.55 * Math.SQRT1_2);
    expect(out.sector).toBe("D1R2");

    const across = place(135, 0.4);
    expect(across.centreSw.x).toBeCloseTo(-0.4 * 0.6 * Math.SQRT1_2);
    expect(across.centreSw.y).toBeCloseTo(0.4 * 0.6 * Math.SQRT1_2);
    expect(across.sector).toBe("D3R1");
  });

  it("interpolates the reach between calibrated directions", () => {
    const balloon = place(67.5, 1);
    expect(balloon.reachSw).toBeCloseTo(0.95);
  });

  it("shows up-and-out on the same side of the screen as the shoulder's outward side", () => {
    const shoulderX = transform.toScreen({ x: 0, y: 0 }).x;
    const outX = transform.toScreen(place(45, 0.7).centreSw).x;
    expect(Math.sign(outX - shoulderX)).toBe(affectedSide === "left" ? -1 : 1);
  });

  it("starts below the screen, right under where it will wait", () => {
    const balloon = place(90, 0.85);
    const start = transform.toScreen(balloon.startSw);
    const target = transform.toScreen(balloon.centreSw);
    expect(start.x).toBeCloseTo(target.x);
    expect(start.y).toBeGreaterThan(HEIGHT);
  });

  it("stays fully on screen even at the top of the reach", () => {
    const balloon = place(90, 1.1, 0.6);
    const centre = transform.toScreen(balloon.centreSw);
    expect(centre.y - 0.6 * transform.pixelsPerSw).toBeGreaterThanOrEqual(BOUNDS.top - 1e-6);
  });
});

describe("balloonPosition", () => {
  const placement = { startSw: { x: 0.2, y: -2 }, centreSw: { x: 0.2, y: 0.6 } };

  it("rises from the start to its height", () => {
    expect(balloonPosition(placement, 0, 0)).toEqual({ x: 0.2, y: -2 });
    const top = balloonPosition(placement, 1, 0);
    expect(top.x).toBeCloseTo(0.2);
    expect(top.y).toBeCloseTo(0.6);
    // Eases out: most of the way up by half time.
    expect(balloonPosition(placement, 0.5, 0).y).toBeGreaterThan(0.2);
  });

  it("sways gently from side to side while it waits", () => {
    const xs = Array.from({ length: 31 }, (_, i) => balloonPosition(placement, 1, i * 100).x);
    expect(Math.max(...xs) - 0.2).toBeCloseTo(SWAY_SW, 2);
    expect(0.2 - Math.min(...xs)).toBeCloseTo(SWAY_SW, 2);
  });

  it("floats away upward", () => {
    const away = balloonPosition(placement, 1, 0, 1, 3);
    expect(away.y).toBeCloseTo(3.6);
  });
});
