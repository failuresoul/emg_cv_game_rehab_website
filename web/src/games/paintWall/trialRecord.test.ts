import { describe, expect, it } from "vitest";

import type { Sweep } from "./sweepDetector";
import {
  AngleRecorder,
  buildStripeRecord,
  stripeMetrics,
  stripeScore,
  withUpperArm,
} from "./trialRecord";

const sweep = (kind: Sweep["kind"], durationMs: number): Sweep => ({
  kind,
  peakHeight: kind === "full" ? 0.9 : 0.5,
  startMs: 0,
  endMs: durationMs,
  durationMs,
});

/** An elbow bending from `straight` to `bent` and back, `count` times, at 30 Hz. */
function elbowAngles(count: number, straight: number, bent: number, noise = 0): [number, number][] {
  const rows: [number, number][] = [];
  for (let t = 0; t <= count * 2000; t += 1000 / 30) {
    const phase = (t % 2000) / 2000;
    const angle = straight - (straight - bent) * Math.sin(Math.PI * phase) ** 2;
    rows.push([t, angle + noise * Math.sin(t / 7)]);
  }
  return rows;
}

describe("AngleRecorder", () => {
  it("keeps about 30 angles a second and skips missing ones", () => {
    const recorder = new AngleRecorder();
    for (let t = 0; t <= 1000; t += 1000 / 60) recorder.add(t, t > 500 && t < 600 ? null : 120);
    const samples = recorder.toArray();
    expect(samples.length).toBeGreaterThan(25);
    expect(samples.length).toBeLessThan(33);
    expect(samples.every(([, angle]) => angle === 120)).toBe(true);
  });
});

describe("stripeMetrics", () => {
  it("measures the range, sweeps and smoothness from the raw angles", () => {
    const metrics = stripeMetrics(
      elbowAngles(3, 150, 75),
      [sweep("full", 1800), sweep("partial", 1000), sweep("full", 2200)],
      12.5,
    );
    expect(metrics.maxStraightDeg).toBeCloseTo(150);
    expect(metrics.maxBendDeg).toBeCloseTo(75, 0);
    expect(metrics.achievedRangeDeg).toBeCloseTo(75, 0);
    expect(metrics.fullSweeps).toBe(2);
    expect(metrics.partialSweeps).toBe(1);
    expect(metrics.meanSweepMs).toBe(2000);
    expect(metrics.angularSparc as number).toBeLessThan(0);
    expect(metrics.upperArmMotionDeg).toBe(12.5);
  });

  it("rates a shaky elbow as less smooth", () => {
    const smooth = stripeMetrics(elbowAngles(2, 150, 80), [], null).angularSparc as number;
    const shaky = stripeMetrics(elbowAngles(2, 150, 80, 3), [], null).angularSparc as number;
    expect(shaky).toBeLessThan(smooth);
  });

  it("has nothing to measure without angles", () => {
    expect(stripeMetrics([], [], null)).toMatchObject({
      achievedRangeDeg: null,
      maxBendDeg: null,
      meanSweepMs: null,
      angularSparc: null,
    });
  });
});

describe("score and compensation", () => {
  it("gives 30 a full sweep, 10 a partial one and 50 for a finished stripe", () => {
    const metrics = stripeMetrics(
      [],
      [sweep("full", 1), sweep("full", 1), sweep("partial", 1)],
      null,
    );
    expect(stripeScore(metrics, "success")).toBe(120);
    expect(stripeScore(metrics, "miss")).toBe(70);
  });

  it("adds upper-arm movement to the posture monitor's compensation", () => {
    const none = { flagged: false, type: null, max_values: {} };
    expect(withUpperArm(none, true, 26.04)).toEqual({
      flagged: true,
      type: "upper_arm",
      max_values: { upper_arm_motion_deg: 26 },
    });
    const trunk = { flagged: true, type: "trunk", max_values: { trunk_displacement_sw: 0.2 } };
    expect(withUpperArm(trunk, true, 30).type).toBe("trunk+upper_arm");
    // Not flagged: the measure is still kept, the flag is not added.
    expect(withUpperArm(none, false, 8)).toEqual({
      flagged: false,
      type: null,
      max_values: { upper_arm_motion_deg: 8 },
    });
  });
});

describe("buildStripeRecord", () => {
  it("saves the stripe as a target with the elbow measures", () => {
    const metrics = stripeMetrics(elbowAngles(3, 150, 75), [sweep("full", 1800)], 4.04);
    const record = buildStripeRecord({
      trialNo: 3,
      params: { required_range_frac: 0.75 },
      stripeIndex: 2,
      targetFrac: 0.75,
      outcome: "miss",
      spawnMs: 1000,
      endMs: 31000,
      metrics,
      compensation: { flagged: false, type: null, max_values: {} },
      trajectory: [],
    });
    expect(record.target).toEqual({ kind: "stripe", index: 2, target_frac: 0.75 });
    expect(record.outcome).toBe("miss");
    expect(record.timings.end).toBe(30000);
    expect(record.metrics).toMatchObject({
      max_straight_deg: 150,
      full_sweeps: 1,
      partial_sweeps: 0,
      mean_sweep_ms: 1800,
      upper_arm_motion_deg: 4,
      movement_ms: null,
    });
    expect(record.metrics.angular_sparc as number).toBeLessThanOrEqual(0);
  });
});
