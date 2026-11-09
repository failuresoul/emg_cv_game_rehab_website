import { describe, expect, it } from "vitest";

import type { TrajectoryPoint } from "@/types/api";

import { readParams } from "./params";
import { buildFruitRecord, lateralMetrics } from "./trialRecord";

const RANGE = { min: -0.6, max: 1.3 };
const FRAME_MS = 1000 / 30;

/**
 * The hand waits at `fromX` for `waitMs`, then moves along x at `speed` SW/s to `peakX`, and (if
 * given) comes back to `settleX`. y wobbles a little, which sideways measures must ignore.
 */
function sideways(
  fromX: number,
  peakX: number,
  speed: number,
  waitMs: number,
  settleX: number = peakX,
): TrajectoryPoint[] {
  const out = (Math.abs(peakX - fromX) / speed) * 1000;
  const back = (Math.abs(settleX - peakX) / speed) * 1000;
  const points: TrajectoryPoint[] = [];
  for (let t = 0; t <= waitMs + out + back + 1000; t += FRAME_MS) {
    let x: number;
    if (t <= waitMs) x = fromX;
    else if (t <= waitMs + out) x = fromX + (peakX - fromX) * ((t - waitMs) / out);
    else if (t <= waitMs + out + back) x = peakX + (settleX - peakX) * ((t - waitMs - out) / back);
    else x = settleX;
    points.push([t, x, -0.3 + 0.01 * Math.sin(t / 50)]);
  }
  return points;
}

describe("lateralMetrics", () => {
  it("measures a straight sideways move as fully efficient, with no overshoot", () => {
    const metrics = lateralMetrics(sideways(0, 0.9, 0.6, 600), RANGE, 0.9, 2100, 5000);
    expect(metrics.lateralDistanceSw).toBeCloseTo(0.9);
    expect(metrics.reactionMs).toBeGreaterThanOrEqual(600 - FRAME_MS);
    expect(metrics.reactionMs).toBeLessThanOrEqual(600 + FRAME_MS);
    expect(metrics.movementMs).toBeCloseTo(2100 - (metrics.reactionMs as number));
    expect(metrics.lateralPathEfficiency).toBeGreaterThan(0.99);
    expect(metrics.overshootSw).toBeCloseTo(0, 3);
    expect(metrics.peakLateralSpeedSwS).toBeCloseTo(0.6, 1);
  });

  it("measures how far the hand went past the fruit before coming back", () => {
    const metrics = lateralMetrics(sideways(0, 1.1, 0.6, 300, 0.9), RANGE, 0.9, 1800, 6000);
    expect(metrics.overshootSw).toBeCloseTo(0.2, 2);
  });

  it("measures overshoot across the body too", () => {
    const metrics = lateralMetrics(sideways(0.3, -0.55, 0.5, 300, -0.4), RANGE, -0.4, 1800, 6000);
    expect(metrics.lateralDistanceSw).toBeCloseTo(0.7);
    expect(metrics.overshootSw).toBeCloseTo(0.15, 2);
  });

  it("uses the basket's x, which stops at the end of the range", () => {
    // The hand goes to x = 1.6, but the basket stops at 1.3.
    const metrics = lateralMetrics(sideways(0, 1.6, 0.8, 300), RANGE, 1.2, null, 6000);
    expect(metrics.overshootSw).toBeCloseTo(0.1, 2);
  });

  it("is empty but for the distance when the hand never moves", () => {
    const metrics = lateralMetrics(sideways(0.2, 0.2, 1, 0), RANGE, -0.3, null, 5000);
    expect(metrics.lateralDistanceSw).toBeCloseTo(0.5);
    expect(metrics.reactionMs).toBeNull();
    expect(metrics.overshootSw).toBeNull();
  });
});

describe("buildFruitRecord", () => {
  const moments = { spawn: 10000, under: 12100, end: 15000 };
  const record = buildFruitRecord({
    trialNo: 2,
    params: { target_side: -1, target_frac: 0.7 },
    side: "across",
    x: -0.42,
    range: RANGE,
    outcome: "success",
    moments,
    compensation: { flagged: true, type: "lean", max_values: { trunk_lean_deg: 12 } },
    trajectory: sideways(0.2, -0.42, 0.5, 500),
  });

  it("stores the fruit as the target, on the across side", () => {
    expect(record.target).toEqual({
      x_sw: -0.42,
      y_sw: -0.3,
      radius_sw: 0.13,
      direction_deg: 180,
      distance_frac: 0.7,
      sector: "D4R2",
    });
  });

  it("stores the sideways measures and the side", () => {
    expect(record.metrics.side).toBe("across");
    expect(record.metrics.lateral_distance_sw).toBeCloseTo(0.62);
    expect(record.metrics.lateral_path_efficiency).toBeGreaterThan(0.99);
    expect(record.metrics.path_efficiency).toBe(record.metrics.lateral_path_efficiency);
    expect(record.metrics.activation_latency_ms).toBeNull();
    expect(record.timings).toMatchObject({ spawn: 0, enter: 2100, end: 5000 });
    expect(record.compensation.flagged).toBe(true);
  });
});

describe("readParams", () => {
  it("defaults to one fruit at a time, outward", () => {
    expect(readParams({})).toEqual({
      fallSpeedSwS: 0.35,
      spreadFrac: 0.7,
      basketWidthSw: 0.7,
      spawnIntervalMs: 4000,
      maxOnScreen: 1,
      side: "out",
      targetFrac: 0.7,
    });
  });

  it("reads -1 as across", () => {
    expect(readParams({ target_side: -1 }).side).toBe("across");
  });
});
