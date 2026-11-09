import { describe, expect, it } from "vitest";

import type { TrajectoryPoint, TrialCreate } from "@/types/api";

import { centredSpeeds, MOVE_ONSET_SPEED_SW_S, reachPathMetrics, summariseTrials } from "./metrics";

const FRAME_MS = 1000 / 30;

/** Still at the start for `waitMs`, then straight to (dx, dy) at `speed` SW/s, sampled at 30 Hz. */
function straightReach(waitMs: number, dx: number, dy: number, speed: number): TrajectoryPoint[] {
  const distance = Math.hypot(dx, dy);
  const moveMs = (distance / speed) * 1000;
  const points: TrajectoryPoint[] = [];
  for (let t = 0; t <= waitMs + moveMs + 200; t += FRAME_MS) {
    const share = Math.min(1, Math.max(0, (t - waitMs) / moveMs));
    points.push([t, 0.1 + dx * share, 0.2 + dy * share]);
  }
  return points;
}

describe("centredSpeeds", () => {
  it("measures a steady movement's speed and leaves the ends empty", () => {
    const speeds = centredSpeeds([
      [0, 0, 0],
      [50, 0.05, 0],
      [100, 0.1, 0],
    ]);
    expect(speeds[0]).toBeNull();
    expect(speeds[1]).toBeCloseTo(1);
    expect(speeds[2]).toBeNull();
  });
});

describe("reachPathMetrics", () => {
  it("measures a straight reach as fully efficient", () => {
    const trajectory = straightReach(400, 0.6, 0.8, 1.0); // 1 SW in 1 s.
    const enterMs = 1300;
    const metrics = reachPathMetrics(trajectory, enterMs);

    expect(metrics.pathEfficiency).toBeGreaterThan(0.99);
    expect(metrics.pathEfficiency).toBeLessThanOrEqual(1);
    // Movement began at 400 ms; the centred speed sees it within a frame.
    expect(metrics.reactionMs).toBeGreaterThanOrEqual(400 - FRAME_MS);
    expect(metrics.reactionMs).toBeLessThanOrEqual(400 + FRAME_MS);
    expect(metrics.movementMs).toBeCloseTo(enterMs - (metrics.reactionMs as number));
    expect(metrics.peakSpeedSwS).toBeCloseTo(1, 1);
    expect(metrics.straightDistSw).toBeCloseTo(metrics.pathLengthSw as number, 6);
    expect(metrics.pathLengthSw).toBeGreaterThan(0.85);
    expect(metrics.pathLengthSw).toBeLessThanOrEqual(0.91);
  });

  it("stops at the moment of entering the target", () => {
    const trajectory = straightReach(0, 2, 0, 1);
    // Onset is found within a frame or two of the start, so the path starts just after it.
    const toEnter = reachPathMetrics(trajectory, 1000).pathLengthSw as number;
    expect(toEnter).toBeGreaterThan(0.9);
    expect(toEnter).toBeLessThanOrEqual(1);
    const whole = reachPathMetrics(trajectory, null);
    expect(whole.pathLengthSw).toBeGreaterThan(1.9);
    expect(whole.pathLengthSw).toBeLessThanOrEqual(2);
    expect(whole.movementMs).toBeNull();
  });

  it("measures a detour as less efficient", () => {
    const out = straightReach(0, 0, 1, 1);
    const across = straightReach(0, 1, 0, 1).map(([t, x, y]): TrajectoryPoint => [
      t + 1300,
      x,
      y + 1,
    ]);
    const metrics = reachPathMetrics([...out, ...across], null);
    expect(metrics.pathEfficiency).toBeCloseTo(Math.SQRT2 / 2, 1);
  });

  it("does not count jitter below 0.15 SW/s as movement", () => {
    const jitter: TrajectoryPoint[] = Array.from({ length: 60 }, (_, i) => [
      i * FRAME_MS,
      0.5 + (i % 2) * 0.002,
      0.5,
    ]);
    expect(
      centredSpeeds(jitter).every((speed) => speed === null || speed < MOVE_ONSET_SPEED_SW_S),
    ).toBe(true);
    expect(reachPathMetrics(jitter, null).reactionMs).toBeNull();
  });

  it("is empty without at least two points", () => {
    expect(reachPathMetrics([[0, 0, 0]], null).pathLengthSw).toBeNull();
    expect(reachPathMetrics([], 100).reactionMs).toBeNull();
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
