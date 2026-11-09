import { describe, expect, it } from "vitest";

import type { TrajectoryPoint } from "@/types/api";

import { readParams, REACH_ACTIVATE_PARAMS } from "./params";
import type { TargetPlacement } from "./placement";
import {
  buildTrialRecord,
  CompensationTally,
  MAX_TIME_BONUS,
  POINTS_PER_SUCCESS,
  trialScore,
} from "./trialRecord";

const TARGET: TargetPlacement = {
  centreSw: { x: 0.6, y: 0.8 },
  radiusSw: 0.45,
  directionDeg: 45,
  directionIndex: 1,
  distanceFrac: 0.7,
  reachSw: 1.43,
  sector: "D1R2",
  clamped: false,
};

/** Still for 300 ms, then a straight line to the target at 1 SW/s, at 30 Hz, from spawn at 5000. */
function straightTrajectory(): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let t = 0; t <= 1400; t += 1000 / 30) {
    const share = Math.min(1, Math.max(0, (t - 300) / 1000));
    points.push([t, 0.6 * share, 0.8 * share]);
  }
  return points;
}

describe("buildTrialRecord", () => {
  const moments = {
    spawn: 5000,
    enter: 6300,
    dwellDone: 6800,
    activationStart: 7000,
    activationDone: 7200,
    end: 7200,
  };
  const record = buildTrialRecord({
    trialNo: 4,
    params: { distance_frac: 0.7, direction_deg: 45 },
    target: TARGET,
    outcome: "success",
    moments,
    activation: { latencyMs: 200, peakLevel: 0.91234 },
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: straightTrajectory(),
  });

  it("measures a straight path as fully efficient", () => {
    expect(record.metrics.path_efficiency).toBeGreaterThan(0.99);
    expect(record.metrics.straight_dist_sw).toBeCloseTo(record.metrics.path_length_sw as number, 3);
    expect(record.metrics.peak_speed_sw_s).toBeCloseTo(1, 1);
  });

  it("times the reaction from spawn to the first movement, and the movement to entering", () => {
    expect(record.metrics.reaction_ms).toBeGreaterThanOrEqual(266);
    expect(record.metrics.reaction_ms).toBeLessThanOrEqual(334);
    expect(record.metrics.movement_ms).toBe(1300 - (record.metrics.reaction_ms as number));
    expect(record.timings.move_onset).toBe(record.metrics.reaction_ms);
  });

  it("stores timings relative to spawn", () => {
    expect(record.timings).toMatchObject({
      spawn: 0,
      enter: 1300,
      dwell_done: 1800,
      activation_start: 2000,
      activation_done: 2200,
      end: 2200,
    });
  });

  it("stores the activation, target and trial", () => {
    expect(record.metrics.activation_latency_ms).toBe(200);
    expect(record.metrics.activation_peak).toBe(0.912);
    expect(record.target).toEqual({
      x_sw: 0.6,
      y_sw: 0.8,
      radius_sw: 0.45,
      direction_deg: 45,
      distance_frac: 0.7,
      sector: "D1R2",
    });
    expect(record.trial_no).toBe(4);
    expect(record.trajectory.length).toBeGreaterThan(40);
  });

  it("leaves measures empty for a reach that never entered", () => {
    const failed = buildTrialRecord({
      trialNo: 1,
      params: {},
      target: TARGET,
      outcome: "reach_fail",
      moments: {
        ...moments,
        enter: null,
        dwellDone: null,
        activationStart: null,
        activationDone: null,
        end: 13000,
      },
      activation: null,
      compensation: { flagged: false, type: null, max_values: {} },
      trajectory: [],
    });
    expect(failed.metrics.movement_ms).toBeNull();
    expect(failed.metrics.activation_peak).toBeNull();
    expect(failed.timings.enter).toBeNull();
    expect(failed.timings.end).toBe(8000);
  });
});

describe("trialScore", () => {
  it("gives 100 plus a time bonus of up to 50 for a success", () => {
    expect(trialScore("success", { spawn: 0, enter: 0 }, 8000)).toBe(
      POINTS_PER_SUCCESS + MAX_TIME_BONUS,
    );
    expect(trialScore("success", { spawn: 0, enter: 4000 }, 8000)).toBe(125);
    expect(trialScore("success", { spawn: 0, enter: 8000 }, 8000)).toBe(100);
  });

  it("gives nothing, and takes nothing, for a failure", () => {
    expect(trialScore("reach_fail", { spawn: 0, enter: null }, 8000)).toBe(0);
    expect(trialScore("activation_fail", { spawn: 0, enter: 1000 }, 8000)).toBe(0);
  });
});

describe("CompensationTally", () => {
  it("flags sustained compensation with its kinds and largest values", () => {
    const tally = new CompensationTally();
    tally.add([], { trunkDisplacement: 0.05, trunkLeanDeg: 3, shoulderHike: 0.01 });
    tally.add(["lean"], { trunkDisplacement: 0.1, trunkLeanDeg: 12.34567, shoulderHike: 0.02 });
    tally.add(["trunk", "lean"], { trunkDisplacement: 0.2, trunkLeanDeg: 8, shoulderHike: 0 });
    expect(tally.toRecord()).toEqual({
      flagged: true,
      type: "trunk+lean",
      max_values: { trunk_displacement_sw: 0.2, trunk_lean_deg: 12.346, shoulder_hike_sw: 0.02 },
    });
  });

  it("is not flagged without sustained compensation", () => {
    const tally = new CompensationTally();
    tally.add([], null);
    expect(tally.toRecord()).toEqual({ flagged: false, type: null, max_values: {} });
  });
});

describe("readParams", () => {
  it("gives every setting its default when nothing is set", () => {
    expect(readParams({})).toEqual({
      distanceFrac: 0.7,
      directionDeg: 0,
      directionIndex: 0,
      targetRadiusSw: 0.45,
      dwellMs: 500,
      activationDemand: 0.5,
      activationHoldMs: 200,
      activationWindowMs: 3000,
      reachTimeLimitMs: 8000,
      restMs: 1500,
    });
  });

  it("works out the direction index from the angle when the provider gives none", () => {
    expect(readParams({ direction_deg: 135 }).directionIndex).toBe(3);
    expect(readParams({ direction_deg: 135, direction_index: 3 }).directionIndex).toBe(3);
  });

  it("keeps fixed settings to a single value", () => {
    const fixed = REACH_ACTIVATE_PARAMS.filter((spec) => spec.min === spec.max);
    expect(fixed.map((spec) => spec.name)).toEqual([
      "activation_hold_ms",
      "reach_time_limit_ms",
      "rest_ms",
    ]);
  });
});
