import { describe, expect, it } from "vitest";

import { defaultHull } from "@/games/shared/playArea";
import { hullDiameter, PATH_SHAPES, pathLength } from "@/metrics/paths";
import { convexHull, pointInPolygon } from "@/vision/geometry";

import { MAX_TARGET_POINTS, placePath, targetPoints } from "./placement";

const HULL = convexHull(
  [1.0, 0.9, 0.8, 0.65, 0.55, 0.5, 0.6, 0.85].map((radius, index) => ({
    x: radius * Math.cos((index * Math.PI) / 4),
    y: radius * Math.sin((index * Math.PI) / 4),
  })),
);

describe("placePath", () => {
  it.each(PATH_SHAPES)("keeps a %s inside the reach for every setting", (shape) => {
    for (const hull of [HULL, defaultHull()]) {
      for (const pathLengthFrac of [0.4, 0.7, 1]) {
        for (const ringFrac of [0.5, 0.7, 0.9]) {
          for (const outward of [true, false]) {
            const { points } = placePath({ shape, hull, pathLengthFrac, ringFrac, outward });
            for (const point of points) expect(pointInPolygon(point, hull)).toBe(true);
          }
        }
      }
    }
  });

  it("is the length asked for when it fits, and shorter only when it does not", () => {
    const asked = 0.4 * hullDiameter(HULL);
    const short = placePath({
      shape: "line",
      hull: HULL,
      pathLengthFrac: 0.4,
      ringFrac: 0.5,
      outward: true,
    });
    expect(short.lengthSw).toBeCloseTo(asked, 2);
    expect(pathLength(short.points)).toBeCloseTo(short.lengthSw, 6);

    const long = placePath({
      shape: "line",
      hull: HULL,
      pathLengthFrac: 1,
      ringFrac: 0.9,
      outward: true,
    });
    expect(long.lengthSw).toBeLessThan(hullDiameter(HULL));
  });

  it("puts the path's middle further out for a larger ring share", () => {
    const at = (ringFrac: number) =>
      placePath({ shape: "arc", hull: HULL, pathLengthFrac: 0.4, ringFrac, outward: true })
        .centreSw;
    const near = at(0.5);
    const far = at(0.9);
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(Math.hypot(near.x, near.y) * 1.5);
  });

  it("runs outward or inward as asked", () => {
    for (const shape of PATH_SHAPES) {
      const out = placePath({
        shape,
        hull: HULL,
        pathLengthFrac: 0.6,
        ringFrac: 0.7,
        outward: true,
      });
      const back = placePath({
        shape,
        hull: HULL,
        pathLengthFrac: 0.6,
        ringFrac: 0.7,
        outward: false,
      });
      expect(out.points.at(-1)!.x).toBeGreaterThanOrEqual(out.points[0].x);
      expect(back.points.at(-1)!.x).toBeLessThanOrEqual(back.points[0].x);
      expect(back.points).toEqual([...out.points].reverse());
    }
  });
});

describe("targetPoints", () => {
  it("keeps at most 200 points, both ends included", () => {
    const many = Array.from({ length: 731 }, (_, i) => ({ x: i / 100, y: -i / 200 }));
    const saved = targetPoints(many);
    expect(saved).toHaveLength(MAX_TARGET_POINTS);
    expect(saved[0]).toEqual([0, 0]);
    expect(saved.at(-1)).toEqual([7.3, -3.65]);
    const few = targetPoints(many.slice(0, 10));
    expect(few).toHaveLength(10);
  });
});
