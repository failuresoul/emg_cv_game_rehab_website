import { describe, expect, it } from "vitest";

import { angularSpeed, speedFromTrajectory } from "./speed";

describe("speedFromTrajectory", () => {
  it("is steady for a steady movement, in SW per second", () => {
    // 0.3 SW to the right and 0.4 SW up each 100 ms: 5 SW/s.
    const points = [0, 100, 200, 300].map((t, i) => [t, 0.3 * i, 0.4 * i]);
    for (const [, speed] of speedFromTrajectory(points)) expect(speed).toBeCloseTo(5);
  });

  it("uses each point's neighbours, and one neighbour at the ends", () => {
    const points = [
      [0, 0, 0],
      [100, 0.1, 0],
      [200, 0.4, 0],
    ];
    expect(speedFromTrajectory(points)).toEqual([
      [0, expect.closeTo(1)],
      [100, expect.closeTo(2)],
      [200, expect.closeTo(3)],
    ]);
  });

  it("skips repeated times and needs two points", () => {
    expect(
      speedFromTrajectory([
        [0, 0, 0],
        [0, 1, 1],
        [100, 0.1, 0],
      ]),
    ).toHaveLength(2);
    expect(speedFromTrajectory([[0, 0, 0]])).toEqual([]);
  });
});

describe("angularSpeed", () => {
  it("is the size of the change in degrees per second, either way", () => {
    const raising = [
      [0, 10],
      [500, 40],
      [1000, 70],
    ];
    angularSpeed(raising).forEach(([, speed]) => expect(speed).toBeCloseTo(60));
    const lowering = raising.map(([t, deg]) => [t, 80 - deg]);
    angularSpeed(lowering).forEach(([, speed]) => expect(speed).toBeCloseTo(60));
  });
});
