import { describe, expect, it } from "vitest";

import type { BloomMoments, OpennessSample } from "./bloomMachine";
import {
  bloomMetrics,
  bloomScore,
  buildBloomRecord,
  holdStability,
  opennessRiseRate,
} from "./trialRecord";

const samples = (levels: number[], stepMs = 100, from = 0): OpennessSample[] =>
  levels.map((level, index) => ({ t: from + index * stepMs, level }));

const MOMENTS: BloomMoments = {
  spawn: 10_000,
  openOnset: 11_200,
  bloomed: 12_000,
  closeStart: 13_000,
  closeOnset: 13_600,
  closeDone: 13_900,
  end: 13_900,
};

describe("holdStability", () => {
  it("is the standard deviation of openness during the hold", () => {
    const hold = samples([0.8, 0.9, 0.8, 0.9]);
    expect(holdStability(hold, 0, 300)).toBeCloseTo(0.05);
  });

  it("is 0 for a perfectly steady hold", () => {
    expect(holdStability(samples([0.75, 0.75, 0.75]), 0, 200)).toBeCloseTo(0, 10);
  });

  it("only counts readings inside the hold", () => {
    const readings = samples([0.1, 0.2, 0.8, 0.8, 0.8, 0.3]);
    expect(holdStability(readings, 200, 400)).toBeCloseTo(0, 10);
  });

  it("is null without readings", () => {
    expect(holdStability([], 0, 1000)).toBeNull();
  });
});

describe("opennessRiseRate", () => {
  // Resting at 0.1, opening steadily from 0.5 s to 1.3 s, then held at 0.9.
  const opening = samples([
    0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9,
  ]);

  it("is the level per second from the last low point to the start of the hold", () => {
    // Onset at 1.2 s (0.8): from 0.1 at 0.5 s, 0.7 in 0.7 s.
    expect(opennessRiseRate(opening, 1200)).toBeCloseTo(1.0);
  });

  it("ignores time spent resting before opening", () => {
    const slowStart = [...samples([0.1, 0.1, 0.1], 1000), ...samples([0.5, 0.9], 200, 3000)];
    expect(opennessRiseRate(slowStart, 3200)).toBeCloseTo(0.8 / 1.2);
  });

  it("uses the highest openness when the flower never bloomed", () => {
    const partial = samples([0.2, 0.3, 0.5, 0.6, 0.4]);
    expect(opennessRiseRate(partial, null)).toBeCloseTo(0.4 / 0.3);
  });

  it("is null when the hand never opened further", () => {
    expect(opennessRiseRate(samples([0.5, 0.5, 0.4]), null)).toBeNull();
    expect(opennessRiseRate(samples([0.9]), 0)).toBeNull();
    // Already open at the start of the hold.
    expect(opennessRiseRate(samples([0.9, 0.9]), 0)).toBeNull();
  });
});

describe("bloomMetrics", () => {
  it("measures both phases", () => {
    const readings = samples(
      [0.1, 0.3, 0.6, 0.8, 0.85, 0.75, 0.8, 0.85, 0.8, 0.9, 0.85],
      200,
      10_600,
    );
    const metrics = bloomMetrics(MOMENTS, readings, 0.83);
    expect(metrics.timeToOpenMs).toBe(1200);
    expect(metrics.timeToCloseMs).toBe(600);
    expect(metrics.peakOpenness).toBe(0.9);
    expect(metrics.peakGrip).toBe(0.83);
    expect(metrics.holdStability).toBeGreaterThan(0);
    expect(metrics.holdStability).toBeLessThan(0.06);
    expect(metrics.opennessRiseRate).toBeCloseTo(0.7 / 0.6);
  });

  it("leaves out what a missed opening never reached", () => {
    const missed: BloomMoments = {
      ...MOMENTS,
      openOnset: null,
      bloomed: null,
      closeStart: null,
      closeOnset: null,
      closeDone: null,
    };
    const metrics = bloomMetrics(missed, samples([0.1, 0.4, 0.5], 100, 10_000), null);
    expect(metrics.timeToOpenMs).toBeNull();
    expect(metrics.holdStability).toBeNull();
    expect(metrics.timeToCloseMs).toBeNull();
    expect(metrics.peakGrip).toBeNull();
    expect(metrics.peakOpenness).toBe(0.5);
    expect(metrics.opennessRiseRate).toBeCloseTo(2);
  });
});

describe("buildBloomRecord", () => {
  const metrics = {
    timeToOpenMs: 1200.4,
    peakOpenness: 1.02,
    holdStability: 0.031234,
    timeToCloseMs: 600,
    peakGrip: 0.8312,
    opennessRiseRate: 1.16666,
  };

  it("saves a non-spatial target, the hand metrics and no trajectory", () => {
    const record = buildBloomRecord({
      trialNo: 3,
      params: { open_demand: 0.7 },
      outcome: "success",
      failedPhase: null,
      moments: MOMENTS,
      metrics,
      compensation: { flagged: false, type: null, max_values: {} },
    });
    expect(record.target).toEqual({ kind: "bloom" });
    expect(record.trajectory).toEqual([]);
    expect(record.timings).toMatchObject({
      spawn: 0,
      activation_start: 3600,
      activation_done: 3900,
      end: 3900,
    });
    expect(record.metrics).toMatchObject({
      time_to_open_ms: 1200,
      peak_openness: 1,
      hold_stability: 0.0312,
      time_to_close_ms: 600,
      peak_grip: 0.831,
      openness_rise_rate: 1.167,
      activation_latency_ms: 600,
      activation_peak: 0.831,
      failed_phase: null,
    });
  });

  it("stores the phase that ran out of time", () => {
    const record = buildBloomRecord({
      trialNo: 1,
      params: {},
      outcome: "miss",
      failedPhase: "close",
      moments: { ...MOMENTS, closeOnset: null, closeDone: null, end: 21_000 },
      metrics: { ...metrics, timeToCloseMs: null },
      compensation: { flagged: true, type: "trunk", max_values: {} },
    });
    expect(record.outcome).toBe("miss");
    expect(record.metrics.failed_phase).toBe("close");
    expect(record.metrics.time_to_close_ms).toBeNull();
    expect(record.timings.end).toBe(11_000);
  });
});

describe("bloomScore", () => {
  it("gives 100 plus up to 50 for opening quickly, and nothing for a miss", () => {
    expect(bloomScore("success", 0, 8000)).toBe(150);
    expect(bloomScore("success", 4000, 8000)).toBe(125);
    expect(bloomScore("success", 8000, 8000)).toBe(100);
    expect(bloomScore("miss", 1000, 8000)).toBe(0);
  });
});
