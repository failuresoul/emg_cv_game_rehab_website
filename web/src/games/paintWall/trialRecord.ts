import type { GameParams } from "@/games/shared/types";
import { sparc } from "@/metrics/sparc";
import { angularSpeed } from "@/metrics/speed";
import type { TrajectoryPoint, TrialCompensation, TrialCreate } from "@/types/api";

import type { Sweep } from "./sweepDetector";

export const POINTS_PER_FULL_SWEEP = 30;
export const POINTS_PER_PARTIAL_SWEEP = 10;
export const STRIPE_BONUS = 50;
/** Elbow angles closer together than this are skipped: about 30 Hz, like the trajectory. */
const MIN_ANGLE_GAP_MS = 25;

/** The RAW elbow angle during one stripe, as [t_ms, degrees], about 30 Hz. */
export class AngleRecorder {
  private readonly samples: [number, number][] = [];

  add(t: number, angleDeg: number | null): void {
    if (angleDeg === null || !Number.isFinite(angleDeg)) return;
    const last = this.samples.at(-1);
    if (last && t - last[0] < MIN_ANGLE_GAP_MS) return;
    this.samples.push([t, angleDeg]);
  }

  toArray(): [number, number][] {
    return this.samples.map(([t, angle]) => [t, angle]);
  }
}

export interface StripeMetrics {
  /** Most straight minus most bent during the stripe, in degrees. */
  achievedRangeDeg: number | null;
  /** The most bent angle reached (the smallest). */
  maxBendDeg: number | null;
  /** The most straight angle reached (the largest). */
  maxStraightDeg: number | null;
  fullSweeps: number;
  partialSweeps: number;
  /** Mean duration of the full sweeps, in ms. */
  meanSweepMs: number | null;
  /** SPARC of the elbow's angular speed: ≤ 0, closer to 0 is smoother. */
  angularSparc: number | null;
  /** The most the upper arm moved from its start during a sweep, in degrees. */
  upperArmMotionDeg: number | null;
}

/** The stripe's measures, from the RAW elbow angles and the sweeps counted. */
export function stripeMetrics(
  angles: readonly (readonly [number, number])[],
  sweeps: readonly Sweep[],
  upperArmMotionDeg: number | null,
): StripeMetrics {
  const values = angles.map(([, angle]) => angle);
  const maxBendDeg = values.length > 0 ? Math.min(...values) : null;
  const maxStraightDeg = values.length > 0 ? Math.max(...values) : null;
  const full = sweeps.filter((sweep) => sweep.kind === "full");
  return {
    achievedRangeDeg:
      maxBendDeg !== null && maxStraightDeg !== null ? maxStraightDeg - maxBendDeg : null,
    maxBendDeg,
    maxStraightDeg,
    fullSweeps: full.length,
    partialSweeps: sweeps.length - full.length,
    meanSweepMs:
      full.length > 0
        ? full.reduce((total, sweep) => total + sweep.durationMs, 0) / full.length
        : null,
    angularSparc: sparc(angularSpeed(angles)),
    upperArmMotionDeg,
  };
}

/** 30 a full sweep, 10 a partial one, and 50 for a finished stripe. Nothing is taken away. */
export function stripeScore(metrics: StripeMetrics, outcome: "success" | "miss"): number {
  return (
    metrics.fullSweeps * POINTS_PER_FULL_SWEEP +
    metrics.partialSweeps * POINTS_PER_PARTIAL_SWEEP +
    (outcome === "success" ? STRIPE_BONUS : 0)
  );
}

/**
 * Adds upper-arm movement to the compensation from the posture monitor: the kind `upper_arm`
 * and its largest value, in degrees.
 */
export function withUpperArm(
  compensation: TrialCompensation,
  flagged: boolean,
  motionDeg: number | null,
): TrialCompensation {
  const max_values =
    motionDeg === null
      ? compensation.max_values
      : { ...compensation.max_values, upper_arm_motion_deg: Math.round(motionDeg * 10) / 10 };
  if (!flagged) return { ...compensation, max_values };
  return {
    flagged: true,
    type: compensation.type ? `${compensation.type}+upper_arm` : "upper_arm",
    max_values,
  };
}

export interface StripeRecordInput {
  trialNo: number;
  params: GameParams;
  /** The stripe's place on the wall, from 0 at the left. */
  stripeIndex: number;
  targetFrac: number;
  outcome: "success" | "miss";
  spawnMs: number;
  endMs: number;
  metrics: StripeMetrics;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/** One stripe as the server stores it; angles and the trajectory are RAW. */
export function buildStripeRecord(input: StripeRecordInput): TrialCreate {
  const { metrics } = input;
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: { kind: "stripe", index: input.stripeIndex, target_frac: input.targetFrac },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: null,
      activation_done: null,
      end: round(input.endMs - input.spawnMs),
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: null,
      activation_latency_ms: null,
      activation_peak: null,
      achieved_range_deg: round(metrics.achievedRangeDeg, 1),
      max_bend_deg: round(metrics.maxBendDeg, 1),
      max_straight_deg: round(metrics.maxStraightDeg, 1),
      full_sweeps: metrics.fullSweeps,
      partial_sweeps: metrics.partialSweeps,
      mean_sweep_ms: round(metrics.meanSweepMs),
      angular_sparc:
        metrics.angularSparc === null ? null : Math.min(0, round(metrics.angularSparc, 4) ?? 0),
      upper_arm_motion_deg: round(metrics.upperArmMotionDeg, 1),
    },
    compensation: input.compensation,
    trajectory: input.trajectory,
  };
}
