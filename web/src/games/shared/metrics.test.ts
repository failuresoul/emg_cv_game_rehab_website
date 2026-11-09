import { describe, expect, it } from "vitest";

import type { TrialCreate } from "@/types/api";

import { pathMetrics, summariseTrials } from "./metrics";

describe("pathMetrics", () => {
  it("measures a straight movement as fully efficient", () => {
    const metrics = pathMetrics([
      [0, 0, 0],
      [100, 0, 0],
      [200, 0.5, 0],
      [300, 1, 0],
    ]);
    expect(metrics.pathLengthSw).toBeCloseTo(1);
    expect(metrics.straightDistSw).toBeCloseTo(1);
    expect(metrics.pathEfficiency).toBeCloseTo(1);
    expect(metrics.peakSpeedSwS).toBeCloseTo(5);
    expect(metrics.moveOnsetMs).toBe(200);
  });

  it("measures a detour as less efficient", () => {
    const metrics = pathMetrics([
      [0, 0, 0],
      [100, 0, 1],
      [200, 1, 1],
      [300, 1, 0],
    ]);
    expect(metrics.pathLengthSw).toBeCloseTo(3);
    expect(metrics.pathEfficiency).toBeCloseTo(1 / 3);
  });

  it("stops at untilMs and needs two points", () => {
    expect(pathMetrics([[0, 0, 0]]).pathLengthSw).toBeNull();
    const metrics = pathMetrics(
      [
        [0, 0, 0],
        [100, 1, 0],
        [200, 5, 0],
      ],
      150,
    );
    expect(metrics.pathLengthSw).toBeCloseTo(1);
  });
});

describe("summariseTrials", () => {
  const trial = (
    outcome: TrialCreate["outcome"],
    movement: number | null,
    flagged = false,
  ): TrialCreate =>
    ({
      outcome,
      metrics: { movement_ms: movement, path_efficiency: movement === null ? null : 0.8 },
      compensation: { flagged, type: null, max_values: {} },
    }) as TrialCreate;

  it("averages successful trials only and counts compensation in all", () => {
    const summary = summariseTrials([
      trial("success", 1000),
      trial("success", 2000, true),
      trial("reach_fail", 9000, true),
      trial("aborted", null),
    ]);
    expect(summary).toEqual({
      successes: 2,
      success_rate: 0.5,
      mean_movement_ms: 1500,
      mean_path_efficiency: 0.8,
      compensated_trials: 2,
    });
  });

  it("is all zero for no trials", () => {
    expect(summariseTrials([])).toEqual({
      successes: 0,
      success_rate: 0,
      mean_movement_ms: null,
      mean_path_efficiency: null,
      compensated_trials: 0,
    });
  });
});
