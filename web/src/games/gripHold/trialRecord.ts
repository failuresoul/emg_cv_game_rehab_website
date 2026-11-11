import type { GameParams } from "@/games/shared/types";
import type { InputSource, TrialCompensation, TrialCreate } from "@/types/api";

import type { HoldFailPhase, HoldMoments, HoldTally } from "./holdMachine";

export const POINTS_PER_HOLD = 100;
/** Up to this many points more for a hold spent inside the band all the time. */
export const MAX_IN_BAND_BONUS = 50;

export interface HoldMetrics {
  timeToBandMs: number | null;
  /** Share of the hold phase spent inside the band, 0–100; null with no hold phase. */
  timeInBandPct: number | null;
  longestContinuousHoldMs: number;
  overshootCount: number;
  maxOvershoot: number | null;
  /** Standard deviation of the level while inside the band; null if it never was. */
  steadiness: number | null;
  relaxationMs: number | null;
}

/** Population standard deviation from a count, a sum and a sum of squares. */
export function standardDeviation(count: number, sum: number, sumSquares: number): number | null {
  if (count === 0) return null;
  const mean = sum / count;
  const variance = sumSquares / count - mean * mean;
  // Rounding leaves a steady level a variance of about ±1e-16, which is no spread at all.
  return variance > 1e-12 ? Math.sqrt(variance) : 0;
}

/** Every hold measure, from the machine's moments and tally. */
export function holdMetrics(moments: HoldMoments, tally: HoldTally): HoldMetrics {
  return {
    timeToBandMs: moments.firstInBand === null ? null : moments.firstInBand - moments.spawn,
    timeInBandPct: tally.activeMs > 0 ? (100 * tally.inBandMs) / tally.activeMs : null,
    longestContinuousHoldMs: tally.longestRunMs,
    overshootCount: tally.overshootCount,
    maxOvershoot: tally.maxOvershoot,
    steadiness: standardDeviation(tally.inBandCount, tally.inBandSum, tally.inBandSumSquares),
    relaxationMs:
      moments.relaxed !== null && moments.holdDone !== null
        ? moments.relaxed - moments.holdDone
        : null,
  };
}

/** 100 for a hold and relax, plus up to 50 for time spent inside the band. A miss scores 0. */
export function holdScore(outcome: "success" | "miss", metrics: HoldMetrics): number {
  if (outcome !== "success") return 0;
  const share = Math.min(1, Math.max(0, (metrics.timeInBandPct ?? 0) / 100));
  return POINTS_PER_HOLD + Math.round(MAX_IN_BAND_BONUS * share);
}

export interface HoldRecordInput {
  trialNo: number;
  params: GameParams;
  bandCenter: number;
  bandWidth: number;
  outcome: "success" | "miss";
  failedPhase: HoldFailPhase | null;
  moments: HoldMoments;
  metrics: HoldMetrics;
  inputSource: InputSource;
  compensation: TrialCompensation;
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;
const share = (value: number | null) => (value === null ? null : Math.min(1, Math.max(0, value)));

/**
 * One hold as the server stores it. It has no place in the body frame, so its target is the band,
 * and there is no trajectory. Timings are relative to the spawn: the hold's start (entering the
 * band) and end (the hold time reached) are saved as the activation.
 */
export function buildHoldRecord(input: HoldRecordInput): TrialCreate {
  const { moments, metrics } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: { kind: "grip_band", center: input.bandCenter, width: input.bandWidth },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: relative(moments.firstInBand),
      activation_done: relative(moments.holdDone),
      end: relative(moments.end),
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
      time_to_band_ms: round(metrics.timeToBandMs),
      time_in_band_pct:
        metrics.timeInBandPct === null
          ? null
          : Math.min(100, Math.max(0, round(metrics.timeInBandPct, 1) ?? 0)),
      longest_continuous_hold_ms: round(metrics.longestContinuousHoldMs),
      overshoot_count: metrics.overshootCount,
      max_overshoot: round(share(metrics.maxOvershoot), 3),
      steadiness: round(share(metrics.steadiness), 4),
      relaxation_ms: round(metrics.relaxationMs),
      input_source: input.inputSource,
      failed_phase: input.failedPhase,
    },
    compensation: input.compensation,
    trajectory: [],
  };
}
