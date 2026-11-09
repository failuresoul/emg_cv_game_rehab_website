import { reachPathMetrics } from "@/games/shared/metrics";
import type { GameParams } from "@/games/shared/types";
import type { CompensationValues } from "@/warmup/compensation";
import type { CompensationType } from "@/warmup/compensationConfig";
import type { TrajectoryPoint, TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";

import type { TargetPlacement } from "./placement";
import type { TrialMoments } from "./trialMachine";

export const POINTS_PER_SUCCESS = 100;
export const MAX_TIME_BONUS = 50;

/**
 * 100 for a success, plus up to 50 for reaching quickly: the full bonus for an instant reach,
 * none at the time limit. Failures score nothing and lose nothing.
 */
export function trialScore(
  outcome: TrialOutcome,
  moments: Pick<TrialMoments, "spawn" | "enter">,
  reachTimeLimitMs: number,
): number {
  if (outcome !== "success") return 0;
  const reachMs = moments.enter === null ? reachTimeLimitMs : moments.enter - moments.spawn;
  const share = reachTimeLimitMs > 0 ? Math.max(0, 1 - reachMs / reachTimeLimitMs) : 0;
  return POINTS_PER_SUCCESS + Math.round(MAX_TIME_BONUS * Math.min(1, share));
}

/** Compensation seen while reaching: the kinds held long enough to count, and the largest values. */
export class CompensationTally {
  private readonly types = new Set<CompensationType>();
  private max: CompensationValues | null = null;

  add(sustained: readonly CompensationType[], values: CompensationValues | null): void {
    sustained.forEach((type) => this.types.add(type));
    if (!values) return;
    this.max = this.max
      ? {
          trunkDisplacement: Math.max(this.max.trunkDisplacement, values.trunkDisplacement),
          trunkLeanDeg: Math.max(this.max.trunkLeanDeg, values.trunkLeanDeg),
          shoulderHike: Math.max(this.max.shoulderHike, values.shoulderHike),
        }
      : { ...values };
  }

  toRecord(): TrialCompensation {
    const types = (["trunk", "lean", "shoulder"] as const).filter((type) => this.types.has(type));
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      flagged: types.length > 0,
      type: types.length > 0 ? types.join("+") : null,
      max_values: this.max
        ? {
            trunk_displacement_sw: round(this.max.trunkDisplacement),
            trunk_lean_deg: round(this.max.trunkLeanDeg),
            shoulder_hike_sw: round(this.max.shoulderHike),
          }
        : {},
    };
  }
}

export interface TrialRecordInput {
  trialNo: number;
  params: GameParams;
  target: TargetPlacement;
  outcome: TrialOutcome;
  moments: TrialMoments;
  /** Latency (window start to the successful hold's start) and the peak level, if it got that far. */
  activation: { latencyMs: number | null; peakLevel: number } | null;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/** One trial as the server stores it. Timings are relative to spawn; metrics use RAW positions. */
export function buildTrialRecord(input: TrialRecordInput): TrialCreate {
  const { moments, target, activation } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  const enter = relative(moments.enter);
  const path = reachPathMetrics(input.trajectory, enter);
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: {
      x_sw: round(target.centreSw.x, 4) as number,
      y_sw: round(target.centreSw.y, 4) as number,
      radius_sw: target.radiusSw,
      direction_deg: target.directionDeg,
      distance_frac: target.distanceFrac,
      sector: target.sector,
    },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: round(path.reactionMs),
      enter,
      dwell_done: relative(moments.dwellDone),
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
      activation_latency_ms: round(activation?.latencyMs ?? null),
      activation_peak: round(activation?.peakLevel ?? null, 3),
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
