import type { GameParams } from "@/games/shared/types";
import { sparc } from "@/metrics/sparc";
import { speedFromTrajectory } from "@/metrics/speed";
import type { TrajectoryPoint, TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";
import type { Point } from "@/vision/geometry";

import type { CarryMoments } from "./carryMachine";

export const SUCCESS_POINTS = 100;
/** Up to this many points more for a quick carry, falling to 0 at the time limit. */
export const SPEED_BONUS = 50;
/** Fewer points for each drop, but never below the points for a success. */
export const DROP_COST = 10;

export interface TransportMetrics {
  /** Straight distance over path length of the carry, from 0 to 1. */
  pathEfficiency: number | null;
  sparc: number | null;
  peakSpeedSwS: number | null;
}

const NO_TRANSPORT: TransportMetrics = { pathEfficiency: null, sparc: null, peakSpeedSwS: null };

/**
 * How the object was carried, from the RAW pinch point between the last grasp and the release
 * in the box (times relative to the spawn). Null measures without at least two points.
 */
export function transportMetrics(
  trajectory: readonly TrajectoryPoint[],
  fromMs: number,
  toMs: number,
): TransportMetrics {
  const samples = trajectory.filter(([t]) => t >= fromMs && t <= toMs);
  if (samples.length < 2) return NO_TRANSPORT;
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    length += Math.hypot(samples[i][1] - samples[i - 1][1], samples[i][2] - samples[i - 1][2]);
  }
  const [, x0, y0] = samples[0];
  const [, x1, y1] = samples[samples.length - 1];
  const straight = Math.hypot(x1 - x0, y1 - y0);
  const speeds = speedFromTrajectory(samples);
  return {
    pathEfficiency: length > 0 ? Math.min(1, straight / length) : null,
    sparc: sparc(speeds),
    peakSpeedSwS: speeds.length > 0 ? Math.max(...speeds.map(([, speed]) => speed)) : null,
  };
}

/** 100 for placing the object, up to 50 more for a quick carry, 10 fewer for each drop. */
export function carryScore(
  outcome: TrialOutcome,
  moments: CarryMoments,
  drops: number,
  timeLimitMs: number,
): number {
  if (outcome !== "success" || moments.placed === null) return 0;
  const share = Math.min(1, Math.max(0, (moments.placed - moments.spawn) / timeLimitMs));
  const bonus = Math.round(SPEED_BONUS * (1 - share));
  return Math.max(SUCCESS_POINTS, SUCCESS_POINTS + bonus - DROP_COST * drops);
}

export interface CarryRecordInput {
  trialNo: number;
  params: GameParams;
  pick: Point;
  place: Point;
  objectRadiusSw: number;
  boxSizeSw: number;
  outcome: TrialOutcome;
  moments: CarryMoments;
  drops: number;
  /** The RAW pinch point at the release in the box, or null for a miss. */
  releaseRawSw: Point | null;
  compensation: TrialCompensation;
  /** The RAW pinch point over the trial. */
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;
// `|| 0` saves −0 as 0.
const pair = (point: Point): [number, number] => [round(point.x, 4) || 0, round(point.y, 4) || 0];

/** One trial as the server stores it. Timings are relative to the spawn; metrics use RAW points. */
export function buildCarryRecord(input: CarryRecordInput): TrialCreate {
  const { moments, outcome } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  const between = (from: number | null, to: number | null) =>
    from === null || to === null ? null : round(Math.max(0, to - from));
  const placed = outcome === "success" && moments.placed !== null && moments.lastGrasp !== null;
  const transport = placed
    ? transportMetrics(
        input.trajectory,
        (moments.lastGrasp as number) - moments.spawn,
        (moments.placed as number) - moments.spawn,
      )
    : NO_TRANSPORT;
  const releaseError =
    placed && input.releaseRawSw
      ? Math.hypot(input.releaseRawSw.x - input.place.x, input.releaseRawSw.y - input.place.y)
      : null;
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: {
      kind: "pick_place",
      pick: pair(input.pick),
      place: pair(input.place),
      object_radius_sw: input.objectRadiusSw,
      box_size_sw: input.boxSizeSw,
    },
    outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      // The object reached, and grasped (the first time).
      enter: relative(moments.reached),
      dwell_done: relative(moments.firstGrasp),
      activation_start: null,
      activation_done: null,
      end: relative(moments.end),
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: round(transport.peakSpeedSwS, 4),
      activation_latency_ms: null,
      activation_peak: null,
      reach_ms: between(moments.spawn, moments.reached),
      grasp_latency_ms: between(moments.reached, moments.firstGrasp),
      transport_ms: placed ? between(moments.lastGrasp, moments.placed) : null,
      transport_path_efficiency: round(transport.pathEfficiency, 4),
      drops: input.drops,
      release_error_sw: round(releaseError, 4),
      sparc: transport.sparc === null ? null : Math.min(0, round(transport.sparc, 4) ?? 0),
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
