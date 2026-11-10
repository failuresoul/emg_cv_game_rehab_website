import type { GameParams } from "@/games/shared/types";
import { closestPointOnPath, pathLength, type PathShape, pointAtDistance } from "@/metrics/paths";
import { sparc } from "@/metrics/sparc";
import { speedFromTrajectory } from "@/metrics/speed";
import type { TrajectoryPoint, TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { targetPoints } from "./placement";
import type { TraceMoments } from "./traceMachine";

/** A trace counts as followed well from this share of its time inside the corridor. */
export const SUCCESS_IN_CORRIDOR_PCT = 70;
/** Three stars from this share of time inside the corridor; two from the success share. */
export const THREE_STARS_PCT = 90;
export const SUCCESS_BONUS = 50;

export interface TraceGeometry {
  path: readonly Point[];
  /** Times relative to the spawn, in ms. */
  traceStartMs: number;
  traceEndMs: number;
  guideSpeedSwS: number;
  corridorWidthSw: number;
}

export interface TraceMetrics {
  /** Mean distance from the guide, in SW. */
  meanTrackingErrorSw: number | null;
  /** Mean distance from the path, in SW. */
  meanPathErrorSw: number | null;
  /** Share of the trace inside the corridor, 0–100; null when the trace never began. */
  timeInCorridorPct: number | null;
  /** Mean delay behind the guide, in ms: positive behind, negative ahead. */
  lagMs: number | null;
  /** Share of the path's stretches followed inside the corridor, 0–100; null without a trace. */
  coveragePct: number | null;
  sparc: number | null;
  peakSpeedSwS: number | null;
}

/** A trial whose trace never began (the start circle was not held in time). */
export const NO_TRACE: TraceMetrics = {
  meanTrackingErrorSw: null,
  meanPathErrorSw: null,
  timeInCorridorPct: null,
  lagMs: null,
  coveragePct: null,
  sparc: null,
  peakSpeedSwS: null,
};

const mean = (values: readonly number[]) =>
  values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;

/** Whether a point is inside the corridor: within half its width of the path. */
export function inCorridor(path: readonly Point[], point: Point, corridorWidthSw: number): boolean {
  return closestPointOnPath(path, point).distance <= corridorWidthSw / 2;
}

/** How many stretches the path has: one between each pair of its evenly spaced points. */
export function stretchCount(path: readonly Point[]): number {
  return Math.max(1, path.length - 1);
}

/** Which stretch of the path a distance along it falls in, from 0. */
export function stretchIndex(path: readonly Point[], alongSw: number): number {
  const count = stretchCount(path);
  const length = pathLength(path);
  if (!(length > 0)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor((alongSw / length) * count)));
}

/**
 * How well the fingertip followed the guide, from the RAW trajectory between the guide setting
 * off and reaching the end. Each sample counts once (they are about 30 Hz apart).
 */
export function traceMetrics(
  trajectory: readonly TrajectoryPoint[],
  geometry: TraceGeometry,
): TraceMetrics {
  const { path, traceStartMs, traceEndMs, guideSpeedSwS, corridorWidthSw } = geometry;
  const samples = trajectory.filter(([t]) => t >= traceStartMs && t <= traceEndMs);
  // The hand was out of sight for the whole trace: nothing was followed.
  if (samples.length === 0) return { ...NO_TRACE, timeInCorridorPct: 0, coveragePct: 0 };

  const tracking: number[] = [];
  const pathErrors: number[] = [];
  const lags: number[] = [];
  const covered = new Set<number>();
  let inside = 0;
  for (const [t, x, y] of samples) {
    const point = { x, y };
    const guide = pointAtDistance(path, (guideSpeedSwS * (t - traceStartMs)) / 1000);
    tracking.push(Math.hypot(guide.x - x, guide.y - y));
    const closest = closestPointOnPath(path, point);
    pathErrors.push(closest.distance);
    // When the guide was where the fingertip is now.
    lags.push(t - (traceStartMs + (closest.along / guideSpeedSwS) * 1000));
    if (closest.distance <= corridorWidthSw / 2) {
      inside++;
      covered.add(stretchIndex(path, closest.along));
    }
  }
  const speeds = speedFromTrajectory(samples);
  return {
    meanTrackingErrorSw: mean(tracking),
    meanPathErrorSw: mean(pathErrors),
    timeInCorridorPct: (100 * inside) / samples.length,
    lagMs: mean(lags),
    coveragePct: (100 * covered.size) / stretchCount(path),
    sparc: sparc(speeds),
    peakSpeedSwS: speeds.length > 0 ? Math.max(...speeds.map(([, speed]) => speed)) : null,
  };
}

export function traceOutcome(timeInCorridorPct: number | null): TrialOutcome {
  return (timeInCorridorPct ?? 0) >= SUCCESS_IN_CORRIDOR_PCT ? "success" : "miss";
}

/** One star for finishing, two for following well, three for following very well. */
export function traceStars(timeInCorridorPct: number | null): 1 | 2 | 3 {
  const pct = timeInCorridorPct ?? 0;
  if (pct >= THREE_STARS_PCT) return 3;
  return pct >= SUCCESS_IN_CORRIDOR_PCT ? 2 : 1;
}

/** The share of time in the corridor as points, plus 50 for following well. Never negative. */
export function traceScore(metrics: Pick<TraceMetrics, "timeInCorridorPct">): number {
  const pct = metrics.timeInCorridorPct ?? 0;
  return Math.round(pct) + (traceOutcome(pct) === "success" ? SUCCESS_BONUS : 0);
}

export interface TraceRecordInput {
  trialNo: number;
  params: GameParams;
  shape: PathShape;
  path: readonly Point[];
  moments: TraceMoments;
  /** True when the start circle was never held in time. */
  startTimedOut: boolean;
  metrics: TraceMetrics;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/** One trace as the server stores it. Timings are relative to the spawn; metrics use RAW points. */
export function buildTraceRecord(input: TraceRecordInput): TrialCreate {
  const { moments, metrics } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  const pct = (value: number | null) =>
    value === null ? null : Math.min(100, Math.max(0, round(value, 1) ?? 0));
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: { kind: "path", shape: input.shape, points: targetPoints(input.path) },
    outcome: input.startTimedOut ? "reach_fail" : traceOutcome(metrics.timeInCorridorPct),
    timings: {
      spawn: 0,
      move_onset: null,
      enter: relative(moments.startEnter),
      dwell_done: relative(moments.traceStart),
      activation_start: null,
      activation_done: null,
      end: relative(moments.end),
    },
    metrics: {
      reaction_ms: null,
      // The guide sets the pace, so a trace has no movement time of the patient's own.
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: round(metrics.peakSpeedSwS, 4),
      activation_latency_ms: null,
      activation_peak: null,
      mean_tracking_error_sw: round(metrics.meanTrackingErrorSw, 4),
      mean_path_error_sw: round(metrics.meanPathErrorSw, 4),
      time_in_corridor_pct: pct(metrics.timeInCorridorPct),
      lag_ms: round(metrics.lagMs),
      coverage_pct: pct(metrics.coveragePct),
      sparc: metrics.sparc === null ? null : Math.min(0, round(metrics.sparc, 4) ?? 0),
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
