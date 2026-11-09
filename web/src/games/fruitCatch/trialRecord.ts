import { centredSpeeds, MOVE_ONSET_SPEED_SW_S } from "@/games/shared/metrics";
import type { GameParams } from "@/games/shared/types";
import type { TrajectoryPoint, TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";

import type { FruitMoments } from "./fruitTrial";
import {
  BASKET_LINE_Y_SW,
  basketX,
  FRUIT_RADIUS_SW,
  fruitSector,
  type LateralRange,
} from "./lateral";
import type { Side } from "./params";

export const POINTS_PER_CATCH = 100;

export interface LateralMetrics {
  /** From the basket's x at spawn to the fruit's x. */
  lateralDistanceSw: number | null;
  /** Spawn to the first point moving sideways faster than 0.15 SW/s. */
  reactionMs: number | null;
  /** Move onset to the basket first being under the fruit. */
  movementMs: number | null;
  /** Sideways path from move onset to the basket being under the fruit (or the end). */
  lateralPathSw: number | null;
  lateralStraightSw: number | null;
  /** Straight over path, 0–1. */
  lateralPathEfficiency: number | null;
  /** The furthest the basket went past the fruit, in the direction of the movement. */
  overshootSw: number | null;
  peakLateralSpeedSwS: number | null;
}

/**
 * Sideways measures from a fruit's RAW trajectory (times from spawn), using the basket's x: the
 * fingertip's x kept within the range. `underMs` is when the basket was first under the fruit and
 * `endMs` when the fruit reached the basket line.
 */
export function lateralMetrics(
  trajectory: readonly TrajectoryPoint[],
  range: LateralRange,
  targetX: number,
  underMs: number | null,
  endMs: number | null,
): LateralMetrics {
  const points: TrajectoryPoint[] = trajectory
    .filter(([t]) => t >= 0 && (endMs === null || t <= endMs))
    .map(([t, x]) => [t, basketX(x, range), 0]);
  const empty: LateralMetrics = {
    lateralDistanceSw: null,
    reactionMs: null,
    movementMs: null,
    lateralPathSw: null,
    lateralStraightSw: null,
    lateralPathEfficiency: null,
    overshootSw: null,
    peakLateralSpeedSwS: null,
  };
  if (points.length === 0) return empty;
  const lateralDistanceSw = Math.abs(targetX - points[0][1]);
  if (points.length < 2) return { ...empty, lateralDistanceSw };

  const speeds = centredSpeeds(points);
  const onset = speeds.findIndex((speed) => speed !== null && speed > MOVE_ONSET_SPEED_SW_S);
  if (onset < 0) return { ...empty, lateralDistanceSw };

  const [reactionMs, onsetX] = points[onset];
  const until = underMs ?? endMs ?? Infinity;
  let path = 0;
  let peak = 0;
  let last = onset;
  for (let i = onset; i < points.length && points[i][0] <= until; i++) {
    if (i > onset) path += Math.abs(points[i][1] - points[i - 1][1]);
    const speed = speeds[i];
    if (speed !== null) peak = Math.max(peak, speed);
    last = i;
  }
  const straight = Math.abs(points[last][1] - onsetX);

  // Past the fruit, in the direction the hand set off towards it, until the fruit arrived.
  const direction = Math.sign(targetX - onsetX);
  let overshoot = 0;
  if (direction !== 0) {
    for (let i = onset; i < points.length; i++) {
      overshoot = Math.max(overshoot, direction * (points[i][1] - targetX));
    }
  }

  return {
    lateralDistanceSw,
    reactionMs,
    movementMs: underMs === null ? null : Math.max(0, underMs - reactionMs),
    lateralPathSw: path,
    lateralStraightSw: straight,
    lateralPathEfficiency: path > 0 ? Math.min(1, straight / path) : null,
    overshootSw: overshoot,
    peakLateralSpeedSwS: peak,
  };
}

export interface FruitRecordInput {
  trialNo: number;
  params: GameParams;
  side: Side;
  x: number;
  range: LateralRange;
  outcome: TrialOutcome;
  moments: FruitMoments;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/** One fruit as the server stores it. Times are relative to spawn; measures use RAW positions. */
export function buildFruitRecord(input: FruitRecordInput): TrialCreate {
  const { moments, range, side, x } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  const under = relative(moments.under);
  const end = relative(moments.end);
  const lateral = lateralMetrics(input.trajectory, range, x, under, end);
  const reach = side === "out" ? range.max : -range.min;
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: {
      x_sw: round(x, 4) as number,
      y_sw: BASKET_LINE_Y_SW,
      radius_sw: FRUIT_RADIUS_SW,
      direction_deg: side === "out" ? 0 : 180,
      distance_frac: round(reach > 0 ? Math.abs(x) / reach : 0, 3) as number,
      sector: fruitSector(side, x, range),
    },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: round(lateral.reactionMs),
      // When the basket was first under the fruit.
      enter: under,
      dwell_done: null,
      activation_start: null,
      activation_done: null,
      end,
    },
    metrics: {
      reaction_ms: round(lateral.reactionMs),
      movement_ms: round(lateral.movementMs),
      // Sideways, as the basket only moves along x.
      path_length_sw: round(lateral.lateralPathSw, 4),
      straight_dist_sw: round(lateral.lateralStraightSw, 4),
      path_efficiency: round(lateral.lateralPathEfficiency, 4),
      peak_speed_sw_s: round(lateral.peakLateralSpeedSwS, 4),
      activation_latency_ms: null,
      activation_peak: null,
      lateral_distance_sw: round(lateral.lateralDistanceSw, 4),
      lateral_path_efficiency: round(lateral.lateralPathEfficiency, 4),
      overshoot_sw: round(lateral.overshootSw, 4),
      side,
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
