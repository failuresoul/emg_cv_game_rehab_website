import { describe, expect, it } from "vitest";

import type { TrajectoryPoint } from "@/types/api";

import { readParams } from "./params";
import type { BalloonPlacement } from "./placement";
import {
  balloonScore,
  buildBalloonRecord,
  MAX_TIME_BONUS,
  PeakTracker,
  POINTS_PER_POP,
} from "./trialRecord";

const PLACEMENT: BalloonPlacement = {
  centreSw: { x: 0, y: 0.8 },
  startSw: { x: 0, y: -2 },
  radiusSw: 0.45,
  directionDeg: 90,
  directionIndex: 2,
  heightFrac: 0.85,
  reachSw: 0.94,
  sector: "D2R2",
  clamped: false,
};

/** Still for 500 ms, then straight up at 0.8 SW/s, at 30 Hz. */
function straightUp(): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let t = 0; t <= 2500; t += 1000 / 30) {
    const share = Math.min(1, Math.max(0, (t - 500) / 1000));
    points.push([t, 0, -0.5 + 1.3 * share]);
  }
  return points;
}

const moments = {
  spawn: 1000,
  arrived: 3500,
  touch: 3600,
  activationStart: null,
  activationDone: null,
  pop: 3600,
  end: 3600,
};

describe("buildBalloonRecord", () => {
  const record = buildBalloonRecord({
    trialNo: 3,
    params: { height_frac: 0.85, direction_deg: 90 },
    placement: PLACEMENT,
    outcome: "success",
    moments,
    activation: null,
    peakArmElevationDeg: 121.37,
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: straightUp(),
  });

  it("measures a straight raise as fully efficient, using the path up to the touch", () => {
    expect(record.metrics.path_efficiency).toBeGreaterThan(0.99);
    expect(record.metrics.peak_speed_sw_s).toBeCloseTo(1.3, 1);
    expect(record.metrics.path_length_sw).toBeCloseTo(1.3, 1);
  });

  it("times the reaction from spawn and the movement from onset to the pop", () => {
    expect(record.metrics.reaction_ms).toBeGreaterThanOrEqual(466);
    expect(record.metrics.reaction_ms).toBeLessThanOrEqual(534);
    expect(record.metrics.movement_ms).toBe(2600 - (record.metrics.reaction_ms as number));
    expect(record.timings).toMatchObject({ spawn: 0, enter: 2600, dwell_done: null, end: 2600 });
  });

  it("stores the peak arm elevation and the balloon as the target", () => {
    expect(record.metrics.peak_arm_elevation_deg).toBe(121.4);
    expect(record.metrics.activation_latency_ms).toBeNull();
    expect(record.target).toEqual({
      x_sw: 0,
      y_sw: 0.8,
      radius_sw: 0.45,
      direction_deg: 90,
      distance_frac: 0.85,
      sector: "D2R2",
    });
  });

  it("stores the squeeze in touch_squeeze mode", () => {
    const squeezed = buildBalloonRecord({
      trialNo: 1,
      params: {},
      placement: PLACEMENT,
      outcome: "success",
      moments: { ...moments, activationStart: 3900, activationDone: 4100, pop: 4100, end: 4100 },
      activation: { latencyMs: 300, peakLevel: 0.9 },
      peakArmElevationDeg: null,
      compensation: { flagged: false, type: null, max_values: {} },
      trajectory: straightUp(),
    });
    expect(squeezed.metrics.activation_latency_ms).toBe(300);
    expect(squeezed.timings.activation_start).toBe(2900);
    expect(squeezed.timings.activation_done).toBe(3100);
    expect(squeezed.metrics.peak_arm_elevation_deg).toBeNull();
  });
});

describe("balloonScore", () => {
  it("gives 100 plus up to 50 for popping soon after arrival", () => {
    expect(balloonScore("success", { arrived: 1000, touch: 1000 }, 7000)).toBe(
      POINTS_PER_POP + MAX_TIME_BONUS,
    );
    expect(balloonScore("success", { arrived: 1000, touch: 4500 }, 7000)).toBe(125);
  });

  it("gives nothing for a balloon that floats away", () => {
    expect(balloonScore("miss", { arrived: 1000, touch: null }, 7000)).toBe(0);
  });
});

describe("PeakTracker", () => {
  it("keeps the highest angle and ignores unseen frames", () => {
    const peak = new PeakTracker();
    expect(peak.value).toBeNull();
    [30, null, 95.5, 80, Number.NaN].forEach((value) => peak.add(value));
    expect(peak.value).toBe(95.5);
  });
});

describe("readParams", () => {
  it("defaults to a touch at 70% height, straight up", () => {
    expect(readParams({})).toMatchObject({
      heightFrac: 0.7,
      directionDeg: 90,
      directionIndex: 2,
      balloonRadiusSw: 0.45,
      riseMs: 2500,
      hoverMs: 7000,
      popMode: "touch",
      restMs: 1200,
    });
  });

  it("needs a squeeze when squeeze_to_pop is 1", () => {
    expect(readParams({ squeeze_to_pop: 1 }).popMode).toBe("touch_squeeze");
  });
});
