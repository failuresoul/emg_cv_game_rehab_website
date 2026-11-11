import { describe, expect, it } from "vitest";

import type { HoldMoments, HoldTally } from "./holdMachine";
import {
  buildHoldRecord,
  holdMetrics,
  holdScore,
  MAX_IN_BAND_BONUS,
  POINTS_PER_HOLD,
  standardDeviation,
} from "./trialRecord";

const MOMENTS: HoldMoments = {
  spawn: 1000,
  firstInBand: 1800,
  holdDone: 6000,
  relaxed: 6700,
  end: 6700,
};

function tallyOf(levels: readonly number[], extra: Partial<HoldTally> = {}): HoldTally {
  return {
    inBandMs: 3000,
    activeMs: 5000,
    longestRunMs: 2200,
    overshootCount: 2,
    maxOvershoot: 0.08,
    inBandCount: levels.length,
    inBandSum: levels.reduce((total, level) => total + level, 0),
    inBandSumSquares: levels.reduce((total, level) => total + level * level, 0),
    ...extra,
  };
}

describe("standardDeviation", () => {
  it("is the population standard deviation", () => {
    const levels = [0.4, 0.5, 0.6, 0.5];
    const tally = tallyOf(levels);
    // Mean 0.5; squared deviations 0.01, 0, 0.01, 0 → variance 0.005.
    expect(
      standardDeviation(tally.inBandCount, tally.inBandSum, tally.inBandSumSquares),
    ).toBeCloseTo(Math.sqrt(0.005), 10);
  });

  it("is 0 for a steady level, never NaN, and null without samples", () => {
    const steady = tallyOf(Array(100).fill(0.55));
    expect(standardDeviation(steady.inBandCount, steady.inBandSum, steady.inBandSumSquares)).toBe(
      0,
    );
    expect(standardDeviation(0, 0, 0)).toBeNull();
  });
});

describe("holdMetrics", () => {
  it("works out each measure from the moments and the tally", () => {
    const metrics = holdMetrics(MOMENTS, tallyOf([0.45, 0.55]));
    expect(metrics).toMatchObject({
      timeToBandMs: 800,
      longestContinuousHoldMs: 2200,
      overshootCount: 2,
      maxOvershoot: 0.08,
      relaxationMs: 700,
    });
    expect(metrics.timeInBandPct).toBeCloseTo(60);
    expect(metrics.steadiness).toBeCloseTo(0.05);
  });

  it("leaves what never happened empty", () => {
    const moments = { ...MOMENTS, firstInBand: null, holdDone: null, relaxed: null };
    const metrics = holdMetrics(
      moments,
      tallyOf([], { inBandMs: 0, longestRunMs: 0, overshootCount: 0, maxOvershoot: null }),
    );
    expect(metrics).toMatchObject({
      timeToBandMs: null,
      timeInBandPct: 0,
      steadiness: null,
      relaxationMs: null,
      maxOvershoot: null,
    });
  });
});

describe("buildHoldRecord", () => {
  it("saves the band as the target, the measures and the input source", () => {
    const metrics = holdMetrics(MOMENTS, tallyOf([0.45, 0.55]));
    const record = buildHoldRecord({
      trialNo: 2,
      params: { band_center: 0.5, band_width: 0.3 },
      bandCenter: 0.5,
      bandWidth: 0.3,
      outcome: "success",
      failedPhase: null,
      moments: MOMENTS,
      metrics,
      inputSource: "cv_grip",
      compensation: { flagged: false, type: null, max_values: {} },
    });
    expect(record.target).toEqual({ kind: "grip_band", center: 0.5, width: 0.3 });
    expect(record.timings).toMatchObject({
      activation_start: 800,
      activation_done: 5000,
      end: 5700,
    });
    expect(record.metrics).toMatchObject({
      time_to_band_ms: 800,
      time_in_band_pct: 60,
      longest_continuous_hold_ms: 2200,
      overshoot_count: 2,
      max_overshoot: 0.08,
      steadiness: 0.05,
      relaxation_ms: 700,
      input_source: "cv_grip",
      failed_phase: null,
    });
    expect(record.trajectory).toEqual([]);
  });

  it("stores which phase ran out of time", () => {
    const moments = { ...MOMENTS, relaxed: null, end: 9000 };
    const record = buildHoldRecord({
      trialNo: 1,
      params: {},
      bandCenter: 0.6,
      bandWidth: 0.2,
      outcome: "miss",
      failedPhase: "relax",
      moments,
      metrics: holdMetrics(moments, tallyOf([0.6])),
      inputSource: "keyboard",
      compensation: { flagged: false, type: null, max_values: {} },
    });
    expect(record.outcome).toBe("miss");
    expect(record.metrics.failed_phase).toBe("relax");
    expect(record.metrics.relaxation_ms).toBeNull();
    expect(record.metrics.input_source).toBe("keyboard");
  });
});

describe("holdScore", () => {
  it("gives 100 for a hold and relax, more for time in the band, nothing for a miss", () => {
    const metrics = holdMetrics(MOMENTS, tallyOf([0.5]));
    expect(holdScore("success", metrics)).toBe(POINTS_PER_HOLD + 0.6 * MAX_IN_BAND_BONUS);
    expect(holdScore("miss", metrics)).toBe(0);
  });
});
