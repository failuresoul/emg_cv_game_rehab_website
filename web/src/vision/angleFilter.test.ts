import { describe, expect, it } from "vitest";

import { AngleFilter, JointAngleFilter } from "./angleFilter";

function run(values: (number | null)[]): (number | null)[] {
  const filter = new AngleFilter();
  return values.map((value) => filter.add(value));
}

describe("AngleFilter", () => {
  it("removes a single spike", () => {
    const output = run([90, 90, 90, 90, 170, 90, 90, 90]);

    for (const value of output) expect(value).toBeCloseTo(90);
  });

  it("returns the first value unchanged", () => {
    expect(run([42])).toEqual([42]);
  });

  it("follows a real change, without jumping straight to it", () => {
    const output = run([0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);

    // The median needs three of the last five frames to change.
    expect(output[6]).toBe(0);
    expect(output[7]).toBeCloseTo(40);
    expect(output[8]).toBeCloseTo(64);
    expect(output[14] as number).toBeGreaterThan(98);
  });

  it("clears its history after a gap", () => {
    expect(run([10, 10, null, 80])).toEqual([10, 10, null, 80]);
  });
});

describe("JointAngleFilter", () => {
  it("filters each measure on its own, keeping nulls", () => {
    const filter = new JointAngleFilter();
    const quality = { source: "3d", trunkReference: "hip", confidence: 1 } as const;

    const output = filter.add({
      armElevationDeg: { value: 30, ...quality },
      elevationPlaneDeg: null,
      elbowFlexionDeg: { value: 170, ...quality },
    });

    expect(output).toEqual({
      armElevationDeg: 30,
      elevationPlaneDeg: null,
      elbowFlexionDeg: 170,
    });
  });
});

describe("AngleFilter, bad input", () => {
  it.each([NaN, Infinity, -Infinity])(
    "treats %s as a gap, without poisoning later values",
    (bad) => {
      expect(run([10, bad, 20, 20])).toEqual([10, null, 20, 20]);
    },
  );
});
