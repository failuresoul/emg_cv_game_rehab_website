import { describe, expect, it } from "vitest";

import { convexHull, distance, type Point, pointInPolygon } from "@/vision/geometry";

import {
  buildPath,
  closestPointOnPath,
  distanceToPath,
  evenlySpaced,
  PATH_SHAPES,
  pathLength,
  pointAtDistance,
} from "./paths";

const L: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

/** A reach hull like a calibration's: farther outward than across, in 8 directions. */
function hullFromRadii(radii: readonly number[]): Point[] {
  return convexHull(
    radii.map((radius, index) => ({
      x: radius * Math.cos((index * Math.PI) / 4),
      y: radius * Math.sin((index * Math.PI) / 4),
    })),
  );
}
const TYPICAL_HULL = hullFromRadii([1.0, 0.9, 0.8, 0.65, 0.55, 0.5, 0.6, 0.85]);
const SMALL_HULL = hullFromRadii([0.45, 0.4, 0.35, 0.25, 0.2, 0.2, 0.25, 0.4]);

describe("path helpers", () => {
  it("measures a path's length", () => {
    expect(pathLength(L)).toBe(2);
    expect(pathLength([{ x: 0, y: 0 }])).toBe(0);
  });

  it("finds the point at a distance along the path, kept to its ends", () => {
    expect(pointAtDistance(L, 0.5)).toEqual({ x: 0.5, y: 0 });
    expect(pointAtDistance(L, 1.25)).toEqual({ x: 1, y: 0.25 });
    expect(pointAtDistance(L, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAtDistance(L, 9)).toEqual({ x: 1, y: 1 });
  });

  it("is zero for points on the path, between its points as well as at them", () => {
    for (const point of [L[0], L[1], { x: 0.37, y: 0 }, { x: 1, y: 0.8 }]) {
      expect(distanceToPath(L, point)).toBeCloseTo(0, 12);
    }
  });

  it("measures the shortest distance from a point off the path, and where it is along", () => {
    const below = closestPointOnPath(L, { x: 0.4, y: -0.3 });
    expect(below.distance).toBeCloseTo(0.3);
    expect(below.point).toEqual({ x: 0.4, y: 0 });
    expect(below.along).toBeCloseTo(0.4);

    const right = closestPointOnPath(L, { x: 1.5, y: 0.6 });
    expect(right.distance).toBeCloseTo(0.5);
    expect(right.along).toBeCloseTo(1.6);

    // Past the start: the nearest point is the start itself.
    const before = closestPointOnPath(L, { x: -0.3, y: -0.4 });
    expect(before.distance).toBeCloseTo(0.5);
    expect(before.along).toBe(0);
  });

  it("respaces a path evenly, keeping its ends", () => {
    const spaced = evenlySpaced(L, 0.1);
    expect(spaced).toHaveLength(21);
    expect(spaced[0]).toEqual(L[0]);
    expect(spaced.at(-1)).toEqual(L[2]);
    for (let i = 1; i < spaced.length; i++) {
      expect(distance(spaced[i - 1], spaced[i])).toBeCloseTo(0.1, 9);
    }
  });
});

describe("buildPath", () => {
  it.each(PATH_SHAPES)("keeps a %s inside the hull, for every size and turn", (shape) => {
    for (const hull of [TYPICAL_HULL, SMALL_HULL]) {
      for (const sizeFrac of [0.3, 0.8, 1]) {
        for (const rotationDeg of [0, 45, 90, 200]) {
          const path = buildPath(shape, { hull, sizeFrac, rotationDeg });
          expect(path.length).toBeGreaterThan(5);
          for (const point of path) expect(pointInPolygon(point, hull)).toBe(true);
        }
      }
    }
  });

  it.each(PATH_SHAPES)("gives a %s as points evenly spaced in SW", (shape) => {
    const path = buildPath(shape, { hull: TYPICAL_HULL, spacingSw: 0.03 });
    const gaps = path.slice(1).map((point, index) => distance(path[index], point));
    // Straight-line gaps between neighbours are a hair under the spacing along curves.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0.025);
      expect(gap).toBeLessThan(0.035);
    }
  });

  it("makes a smaller path for a smaller size or a smaller reach", () => {
    const full = pathLength(buildPath("s_curve", { hull: TYPICAL_HULL, sizeFrac: 1 }));
    const half = pathLength(buildPath("s_curve", { hull: TYPICAL_HULL, sizeFrac: 0.5 }));
    const small = pathLength(buildPath("s_curve", { hull: SMALL_HULL, sizeFrac: 1 }));
    expect(half).toBeCloseTo(full / 2, 1);
    expect(small).toBeLessThan(full);
  });

  it("draws each shape differently", () => {
    const ends = PATH_SHAPES.map((shape) => {
      const path = buildPath(shape, { hull: TYPICAL_HULL });
      return `${path[0].x.toFixed(2)},${path[0].y.toFixed(2)}`;
    });
    expect(new Set(ends).size).toBe(PATH_SHAPES.length);
  });

  it("needs a hull with at least three corners", () => {
    expect(() => buildPath("line", { hull: L.slice(0, 2) })).toThrow(RangeError);
  });
});

describe("pointInPolygon", () => {
  it("tells inside from outside, whichever way the corners run", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 1 }, [...square].reverse())).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false);
    expect(pointInPolygon({ x: 1, y: -0.1 }, square)).toBe(false);
  });
});
