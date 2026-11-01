import { describe, expect, it } from "vitest";

import {
  browserName,
  buildCalibration,
  compareArea,
  type DirectionResult,
  DIRECTIONS_DEG,
  reachPointsFromRadii,
} from "./calibration";

function measured(radius: number, overrides: Partial<DirectionResult> = {}): DirectionResult {
  return {
    bestProjectionSw: radius,
    maxTrunkSw: 0.05,
    retries: 0,
    flagged: false,
    shoulderWidthPx: 160,
    ...overrides,
  };
}

describe("buildCalibration", () => {
  const eight = (result: DirectionResult) => Array.from({ length: 8 }, () => result);

  it("meets the server's rules for a normal reach", () => {
    const calibration = buildCalibration(eight(measured(1)), "right");

    expect(calibration?.affected_side).toBe("right");
    expect(calibration?.directions_deg).toEqual([...DIRECTIONS_DEG]);
    expect(calibration?.reach_radii_sw).toHaveLength(8);
    expect(calibration?.reach_points_sw).toHaveLength(8);
    expect(calibration?.hull_sw).toHaveLength(8);
    expect(calibration?.hull_area_sw2).toBeCloseTo(2 * Math.SQRT2);
    expect(calibration?.quality.valid).toEqual(Array(8).fill(true));
  });

  it("places reach points in the body frame directions", () => {
    const points = buildCalibration(eight(measured(1)), "left")?.reach_points_sw ?? [];

    expect(points[0][0]).toBeCloseTo(1);
    expect(points[0][1]).toBeCloseTo(0);
    expect(points[2][0]).toBeCloseTo(0);
    expect(points[2][1]).toBeCloseTo(1);
    expect(points[4][0]).toBeCloseTo(-1);
    expect(points[6][1]).toBeCloseTo(-1);
  });

  it("raises a very small reach to the limit and marks it invalid", () => {
    const results = eight(measured(1));
    const small = [measured(0.05), ...results.slice(1)];

    const calibration = buildCalibration(small, "left");

    expect(calibration?.reach_radii_sw[0]).toBe(0.2);
    expect(calibration?.quality.valid[0]).toBe(false);
    expect(calibration?.quality.valid[1]).toBe(true);
  });

  it("lowers a very large reach to the limit and marks it invalid", () => {
    const calibration = buildCalibration(eight(measured(4)), "left");

    expect(calibration?.reach_radii_sw[0]).toBe(3);
    expect(calibration?.quality.valid[0]).toBe(false);
  });

  it("marks flagged and skipped directions invalid", () => {
    const results = eight(measured(1));
    const mixed = [
      measured(1, { flagged: true }),
      measured(1, { bestProjectionSw: null, flagged: true }),
      ...results.slice(2),
    ];

    const calibration = buildCalibration(mixed, "left");

    expect(calibration?.quality.valid.slice(0, 3)).toEqual([false, false, true]);
    expect(calibration?.reach_radii_sw[1]).toBe(0.2);
  });

  it("adds up retries and keeps the largest trunk displacement", () => {
    const results = eight(measured(1));
    const mixed = [
      measured(1, { retries: 2, maxTrunkSw: 0.2 }),
      measured(1, { retries: 1, maxTrunkSw: 0.1 }),
      ...results.slice(2),
    ];

    const { quality } = buildCalibration(mixed, "left") ?? {};

    expect(quality?.retries).toBe(3);
    expect(quality?.max_trunk_displacement_sw).toBeCloseTo(0.2);
  });

  it("uses the median shoulder width, ignoring directions without one", () => {
    const results = [100, 160, 160, 160, 160, 160, 900].map((width) =>
      measured(1, { shoulderWidthPx: width }),
    );
    results.push(measured(1, { shoulderWidthPx: null }));

    expect(buildCalibration(results, "left")?.shoulder_width_px).toBe(160);
  });

  it("returns null if the shoulders were never seen", () => {
    expect(buildCalibration(eight(measured(1, { shoulderWidthPx: null })), "left")).toBeNull();
  });
});

describe("reachPointsFromRadii", () => {
  it("places each radius on its direction", () => {
    const points = reachPointsFromRadii([2, 1, 3, 1, 1, 1, 1, 1]);

    expect(points).toHaveLength(8);
    expect(points[0][0]).toBeCloseTo(2);
    expect(points[0][1]).toBeCloseTo(0);
    expect(points[2][0]).toBeCloseTo(0);
    expect(points[2][1]).toBeCloseTo(3);
  });
});

describe("compareArea", () => {
  it("counts a difference of up to 10% as similar", () => {
    expect(compareArea(11, 10)).toBe("similar");
    expect(compareArea(9, 10)).toBe("similar");
  });

  it("counts a difference over 10% as larger or smaller", () => {
    expect(compareArea(11.1, 10)).toBe("larger");
    expect(compareArea(8.9, 10)).toBe("smaller");
  });
});

describe("compareArea edge cases", () => {
  it("counts equal areas as similar", () => {
    expect(compareArea(2.5, 2.5)).toBe("similar");
  });

  it("measures the change against the earlier map, not the new one", () => {
    // +10% of 10 is 11, but 11 to 10 is only -9.1%, so the two directions are not mirror images.
    expect(compareArea(11, 10)).toBe("similar");
    expect(compareArea(10, 11)).toBe("similar");
    expect(compareArea(8.99, 10)).toBe("smaller");
    expect(compareArea(11.01, 10)).toBe("larger");
  });
});

describe("browserName", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      "Chrome 140",
    ],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "Edge 140"],
    ["Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox 130"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "Safari 18"],
    ["something else", "Unknown"],
  ])("reads %s", (userAgent, expected) => {
    expect(browserName(userAgent)).toBe(expected);
  });
});
