import { describe, expect, it } from "vitest";

import { buildPath, closestPointOnPath, pathLength, pointAtDistance } from "@/metrics/paths";
import type { TrajectoryPoint } from "@/types/api";
import { convexHull } from "@/vision/geometry";

import { MAX_TARGET_POINTS } from "./placement";
import {
  buildTraceRecord,
  inCorridor,
  NO_TRACE,
  type TraceGeometry,
  traceMetrics,
  traceOutcome,
  traceScore,
  traceStars,
} from "./trialRecord";

const HULL = convexHull(
  [1.0, 0.9, 0.8, 0.65, 0.55, 0.5, 0.6, 0.85].map((radius, index) => ({
    x: radius * Math.cos((index * Math.PI) / 4),
    y: radius * Math.sin((index * Math.PI) / 4),
  })),
);
const PATH = buildPath("s_curve", { hull: HULL, lengthSw: 0.9 });
const LENGTH = pathLength(PATH);
const SPEED = 0.25;
const TRACE_START = 2000;
const TRACE_END = TRACE_START + (LENGTH / SPEED) * 1000;
const GEOMETRY: TraceGeometry = {
  path: PATH,
  traceStartMs: TRACE_START,
  traceEndMs: TRACE_END,
  guideSpeedSwS: SPEED,
  corridorWidthSw: 0.4,
};

/** The fingertip at 30 Hz during the trace, placed by `offset` from where the guide is. */
function follow(offset: (t: number, along: number) => { x: number; y: number }): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let t = TRACE_START; t <= TRACE_END; t += 1000 / 30) {
    const along = (SPEED * (t - TRACE_START)) / 1000;
    const guide = pointAtDistance(PATH, along);
    const shift = offset(t, along);
    points.push([t, guide.x + shift.x, guide.y + shift.y]);
  }
  return points;
}

describe("inCorridor", () => {
  it("is true within half the corridor's width of the path, and false beyond", () => {
    const middle = pointAtDistance(PATH, LENGTH / 2);
    expect(inCorridor(PATH, middle, 0.4)).toBe(true);
    expect(inCorridor(PATH, { x: middle.x, y: middle.y + 0.15 }, 0.4)).toBe(
      closestPointOnPath(PATH, { x: middle.x, y: middle.y + 0.15 }).distance <= 0.2,
    );
    expect(inCorridor(PATH, { x: middle.x + 2, y: middle.y }, 0.4)).toBe(false);
  });
});

describe("traceMetrics", () => {
  it("measures a perfect follow as no error, all in the corridor and fully covered", () => {
    const metrics = traceMetrics(
      follow(() => ({ x: 0, y: 0 })),
      GEOMETRY,
    );
    expect(metrics.meanTrackingErrorSw).toBeCloseTo(0, 6);
    expect(metrics.meanPathErrorSw).toBeCloseTo(0, 6);
    expect(metrics.timeInCorridorPct).toBe(100);
    expect(Math.abs(metrics.lagMs as number)).toBeLessThan(5);
    expect(metrics.coveragePct).toBeGreaterThan(95);
    expect(metrics.sparc).not.toBeNull();
    expect(metrics.sparc as number).toBeLessThan(0);
    expect(metrics.peakSpeedSwS).toBeCloseTo(SPEED, 1);
    expect(traceOutcome(metrics.timeInCorridorPct)).toBe("success");
    expect(traceStars(metrics.timeInCorridorPct)).toBe(3);
  });

  it("measures a wobbly follow as off the path part of the time and less smooth", () => {
    const perfect = traceMetrics(
      follow(() => ({ x: 0, y: 0 })),
      GEOMETRY,
    );
    // Sideways wobble of 0.3 SW, twice a second: outside the 0.2 SW half-width at its peaks.
    const wobbly = traceMetrics(
      follow((t) => ({ x: 0, y: 0.3 * Math.sin((2 * Math.PI * 2 * t) / 1000) })),
      GEOMETRY,
    );
    expect(wobbly.meanPathErrorSw as number).toBeGreaterThan(0.05);
    expect(wobbly.meanTrackingErrorSw as number).toBeGreaterThan(0.1);
    expect(wobbly.timeInCorridorPct as number).toBeLessThan(100);
    expect(wobbly.timeInCorridorPct as number).toBeGreaterThan(20);
    expect(wobbly.sparc as number).toBeLessThan(perfect.sparc as number);
    expect(wobbly.peakSpeedSwS as number).toBeGreaterThan(perfect.peakSpeedSwS as number);
  });

  it("measures a fingertip trailing the guide as positive lag", () => {
    // Half a second behind the guide all the way.
    const late = traceMetrics(
      follow((_, along) => {
        const behind = pointAtDistance(PATH, Math.max(0, along - SPEED * 0.5));
        const guide = pointAtDistance(PATH, along);
        return { x: behind.x - guide.x, y: behind.y - guide.y };
      }),
      GEOMETRY,
    );
    expect(late.lagMs as number).toBeGreaterThan(350);
    expect(late.lagMs as number).toBeLessThan(550);
    expect(late.meanPathErrorSw as number).toBeLessThan(0.01);
    expect(late.meanTrackingErrorSw as number).toBeGreaterThan(0.08);
  });

  it("only uses the trace itself, and has nothing to measure without the hand", () => {
    const before: TrajectoryPoint[] = [[100, 5, 5]];
    const metrics = traceMetrics([...before, ...follow(() => ({ x: 0, y: 0 }))], GEOMETRY);
    expect(metrics.timeInCorridorPct).toBe(100);
    const lost = traceMetrics(before, GEOMETRY);
    expect(lost).toMatchObject({ timeInCorridorPct: 0, coveragePct: 0, sparc: null });
  });
});

describe("outcome", () => {
  it("is a success from 70% of the trace inside the corridor", () => {
    expect(traceOutcome(70)).toBe("success");
    expect(traceOutcome(69.9)).toBe("miss");
    expect(traceOutcome(null)).toBe("miss");
  });

  it("gives 1 to 3 stars and never takes points away", () => {
    expect([10, 69, 70, 89, 90, 100].map(traceStars)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(traceScore({ timeInCorridorPct: 75 })).toBe(125);
    expect(traceScore({ timeInCorridorPct: 40 })).toBe(40);
    expect(traceScore({ timeInCorridorPct: null })).toBe(0);
  });
});

describe("buildTraceRecord", () => {
  const moments = { spawn: 1000, startEnter: 2200, traceStart: 2700, traceEnd: 6300, end: 6300 };

  it("saves the path as a target of at most 200 points, and the trace metrics", () => {
    const long = buildPath("circle_part", { hull: HULL, spacingSw: 0.005 });
    expect(long.length).toBeGreaterThan(MAX_TARGET_POINTS);
    const metrics = traceMetrics(
      follow(() => ({ x: 0, y: 0 })),
      GEOMETRY,
    );
    const record = buildTraceRecord({
      trialNo: 1,
      params: { shape_index: 3 },
      shape: "circle_part",
      path: long,
      moments,
      startTimedOut: false,
      metrics,
      compensation: { flagged: false, type: null, max_values: {} },
      trajectory: [],
    });
    const target = record.target as { kind: string; shape: string; points: number[][] };
    expect(target.kind).toBe("path");
    expect(target.shape).toBe("circle_part");
    expect(target.points).toHaveLength(MAX_TARGET_POINTS);
    expect(target.points[0][0]).toBeCloseTo(long[0].x, 3);
    expect(target.points.at(-1)?.[1]).toBeCloseTo(long[long.length - 1].y, 3);
    expect(record.outcome).toBe("success");
    expect(record.timings).toMatchObject({ enter: 1200, dwell_done: 1700, end: 5300 });
    expect(record.metrics).toMatchObject({ time_in_corridor_pct: 100, movement_ms: null });
    expect(record.metrics.sparc as number).toBeLessThanOrEqual(0);
  });

  it("saves a start circle never held as reach_fail, with nothing measured", () => {
    const record = buildTraceRecord({
      trialNo: 2,
      params: {},
      shape: "line",
      path: PATH,
      moments: { ...moments, startEnter: null, traceStart: null, traceEnd: null, end: 16000 },
      startTimedOut: true,
      metrics: NO_TRACE,
      compensation: { flagged: false, type: null, max_values: {} },
      trajectory: [],
    });
    expect(record.outcome).toBe("reach_fail");
    expect(record.metrics.time_in_corridor_pct).toBeNull();
    expect(record.metrics.coverage_pct).toBeNull();
  });
});
