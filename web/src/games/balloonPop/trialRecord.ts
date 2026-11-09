import { reachPathMetrics } from "@/games/shared/metrics";
import type { GameParams } from "@/games/shared/types";
import type { TrajectoryPoint, TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";

import type { BalloonMoments } from "./balloonMachine";
import type { BalloonPlacement } from "./placement";

export const POINTS_PER_POP = 100;
export const MAX_TIME_BONUS = 50;

/**
 * 100 for a pop, plus up to 50 for popping soon after the balloon arrives: the full bonus at once,
 * none at the end of its wait. A balloon that floats away scores nothing and costs nothing.
 */
export function balloonScore(
  outcome: TrialOutcome,
  moments: Pick<BalloonMoments, "arrived" | "touch">,
  hoverMs: number,
): number {
  if (outcome !== "success") return 0;
  if (moments.arrived === null || moments.touch === null || hoverMs <= 0) return POINTS_PER_POP;
  const share = Math.max(0, 1 - (moments.touch - moments.arrived) / hoverMs);
  return POINTS_PER_POP + Math.round(MAX_TIME_BONUS * Math.min(1, share));
}

/** The highest of a run of angles, ignoring frames where the arm was not seen. */
export class PeakTracker {
  private peak: number | null = null;

  add(value: number | null): void {
    if (value === null || !Number.isFinite(value)) return;
    this.peak = this.peak === null ? value : Math.max(this.peak, value);
  }

  get value(): number | null {
    return this.peak;
  }
}

export interface BalloonRecordInput {
  trialNo: number;
  params: GameParams;
  placement: BalloonPlacement;
  outcome: TrialOutcome;
  moments: BalloonMoments;
  /** Only in touch_squeeze mode, once a squeeze has started. */
  activation: { latencyMs: number | null; peakLevel: number } | null;
  peakArmElevationDeg: number | null;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null | undefined, places = 0) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/**
 * One balloon as the server stores it. Times are relative to spawn and measures use RAW
 * positions. The reach ends at the touch: in touch mode that is the pop, and in touch_squeeze
 * mode the squeeze that follows is timed separately.
 */
export function buildBalloonRecord(input: BalloonRecordInput): TrialCreate {
  const { moments, placement, activation } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  const touch = relative(moments.touch);
  const path = reachPathMetrics(input.trajectory, touch);
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: {
      x_sw: round(placement.centreSw.x, 4) as number,
      y_sw: round(placement.centreSw.y, 4) as number,
      radius_sw: placement.radiusSw,
      direction_deg: placement.directionDeg,
      distance_frac: placement.heightFrac,
      sector: placement.sector,
    },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: round(path.reactionMs),
      enter: touch,
      // Balloons have no dwell. They arrive rise_ms after spawn (in params).
      dwell_done: null,
      activation_start: relative(moments.activationStart),
      activation_done: relative(moments.activationDone),
      end: relative(moments.end),
    },
    metrics: {
      reaction_ms: round(path.reactionMs),
      movement_ms: round(path.movementMs),
      path_length_sw: round(path.pathLengthSw, 4),
      straight_dist_sw: round(path.straightDistSw, 4),
      path_efficiency: round(path.pathEfficiency, 4),
      peak_speed_sw_s: round(path.peakSpeedSwS, 4),
      activation_latency_ms: round(activation?.latencyMs),
      activation_peak: round(activation?.peakLevel, 3),
      peak_arm_elevation_deg: round(input.peakArmElevationDeg, 1),
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
