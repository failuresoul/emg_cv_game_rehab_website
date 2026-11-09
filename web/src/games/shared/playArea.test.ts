import { describe, expect, it } from "vitest";

import type { Point } from "@/vision/geometry";

import {
  createPlayArea,
  DEFAULT_REACH_SW,
  PLAY_AREA_HEIGHT_SHARE,
  PLAY_AREA_MAX_WIDTH_SHARE,
} from "./playArea";

const WIDTH = 1600;
const HEIGHT = 900;
// A typical calibrated reach: further outward than across the body, a little more up than down.
const HULL: Point[] = [
  { x: 1.4, y: 0 },
  { x: 1.0, y: 1.0 },
  { x: 0, y: 1.3 },
  { x: -0.6, y: 0.6 },
  { x: -0.7, y: 0 },
  { x: -0.4, y: -0.5 },
  { x: 0, y: -0.9 },
  { x: 0.9, y: -0.8 },
];
const SAMPLES: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -0.5, y: -0.75 },
  { x: 1.23, y: 0.456 },
];

describe.each(["left", "right"] as const)("createPlayArea for a %s-affected patient", (side) => {
  const area = createPlayArea({ width: WIDTH, height: HEIGHT, affectedSide: side, hull: HULL });

  it("returns every body point to where it started", () => {
    for (const point of SAMPLES) {
      const back = area.toBody(area.toScreen(point));
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it("returns every screen point to where it started", () => {
    for (const pixel of [
      { x: 0, y: 0 },
      { x: WIDTH, y: HEIGHT },
      { x: 412.5, y: 77 },
    ]) {
      const back = area.toScreen(area.toBody(pixel));
      expect(back.x).toBeCloseTo(pixel.x, 6);
      expect(back.y).toBeCloseTo(pixel.y, 6);
    }
  });

  it("puts the affected shoulder at the origin and up at the top of the screen", () => {
    expect(area.toScreen({ x: 0, y: 0 })).toEqual(area.originPx);
    expect(area.toScreen({ x: 0, y: 1 }).y).toBeLessThan(area.originPx.y);
  });

  it("makes the reach hull fill 80% of the screen height", () => {
    const ys = HULL.map((point) => area.toScreen(point).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(PLAY_AREA_HEIGHT_SHARE * HEIGHT, 6);
    // ...centred vertically.
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(HEIGHT / 2, 6);
  });

  it("keeps the whole hull on screen", () => {
    for (const point of HULL) {
      const pixel = area.toScreen(point);
      expect(pixel.x).toBeGreaterThanOrEqual(0);
      expect(pixel.x).toBeLessThanOrEqual(WIDTH);
      expect(pixel.y).toBeGreaterThanOrEqual(0);
      expect(pixel.y).toBeLessThanOrEqual(HEIGHT);
    }
  });
});

describe("createPlayArea mirroring", () => {
  const left = createPlayArea({ width: WIDTH, height: HEIGHT, affectedSide: "left", hull: HULL });
  const right = createPlayArea({ width: WIDTH, height: HEIGHT, affectedSide: "right", hull: HULL });

  it("shows outward on the screen's left for the left side, as a mirror does", () => {
    expect(left.toScreen({ x: 1, y: 0 }).x).toBeLessThan(left.originPx.x);
    expect(right.toScreen({ x: 1, y: 0 }).x).toBeGreaterThan(right.originPx.x);
  });

  it("places the shoulder away from the reach, leaving room to reach outward", () => {
    // The hull reaches further outward (1.4) than across the body (0.7).
    expect(left.originPx.x).toBeGreaterThan(WIDTH / 2);
    expect(right.originPx.x).toBeLessThan(WIDTH / 2);
  });

  it("gives both sides the same scale, one the mirror image of the other", () => {
    expect(left.pixelsPerSw).toBeCloseTo(right.pixelsPerSw);
    for (const point of SAMPLES) {
      expect(left.toScreen(point).x).toBeCloseTo(WIDTH - right.toScreen(point).x, 6);
      expect(left.toScreen(point).y).toBeCloseTo(right.toScreen(point).y, 6);
    }
  });
});

describe("createPlayArea limits", () => {
  it("fits the hull below a top bar", () => {
    const top = 100;
    const area = createPlayArea({
      width: WIDTH,
      height: HEIGHT,
      affectedSide: "left",
      hull: HULL,
      insets: { top },
    });
    const ys = HULL.map((point) => area.toScreen(point).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(
      PLAY_AREA_HEIGHT_SHARE * (HEIGHT - top),
      6,
    );
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(top + (HEIGHT - top) / 2, 6);
    expect(Math.min(...ys)).toBeGreaterThan(top);
  });

  it("uses a reach of 1.2 shoulder widths all round without a calibration", () => {
    const area = createPlayArea({
      width: WIDTH,
      height: HEIGHT,
      affectedSide: "right",
      hull: null,
    });
    const top = area.toScreen({ x: 0, y: DEFAULT_REACH_SW }).y;
    const bottom = area.toScreen({ x: 0, y: -DEFAULT_REACH_SW }).y;
    expect(bottom - top).toBeCloseTo(PLAY_AREA_HEIGHT_SHARE * HEIGHT, 6);
  });

  it("shrinks to fit a narrow screen", () => {
    const width = 400;
    const area = createPlayArea({ width, height: HEIGHT, affectedSide: "left", hull: HULL });
    const xs = HULL.map((point) => area.toScreen(point).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(PLAY_AREA_MAX_WIDTH_SHARE * width, 6);
  });
});
