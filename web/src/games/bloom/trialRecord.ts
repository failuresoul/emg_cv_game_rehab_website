import type { GameParams } from "@/games/shared/types";
import type { TrialCompensation, TrialCreate } from "@/types/api";

import type { BloomFailPhase, BloomMoments, OpennessSample } from "./bloomMachine";

export const POINTS_PER_FLOWER = 100;
export const MAX_TIME_BONUS = 50;

/**
 * 100 for a flower whose seed was collected, plus up to 50 for opening quickly: the full bonus for
 * an instant opening, none at the time limit. A miss scores nothing and loses nothing.
 */
export function bloomScore(
  outcome: "success" | "miss",
  timeToOpenMs: number | null,
  phaseTimeLimitMs: number,
): number {
  if (outcome !== "success") return 0;
  const openMs = timeToOpenMs ?? phaseTimeLimitMs;
  const share = phaseTimeLimitMs > 0 ? Math.max(0, 1 - openMs / phaseTimeLimitMs) : 0;
  return POINTS_PER_FLOWER + Math.round(MAX_TIME_BONUS * Math.min(1, share));
}

/** Population standard deviation of the levels from `from` to `to`, inclusive. */
export function holdStability(
  samples: readonly OpennessSample[],
  from: number,
  to: number,
): number | null {
  const levels = samples.filter(({ t }) => t >= from && t <= to).map(({ level }) => level);
  if (levels.length === 0) return null;
  const mean = levels.reduce((total, level) => total + level, 0) / levels.length;
  const variance = levels.reduce((total, level) => total + (level - mean) ** 2, 0) / levels.length;
  return Math.sqrt(variance);
}

/**
 * How fast the hand opened, in level per second: from the lowest openness before the end point
 * to the end point. The end point is the start of the hold that made the flower bloom or, for a
 * bud that never bloomed, the highest openness reached. Null if the hand never opened further.
 */
export function opennessRiseRate(
  samples: readonly OpennessSample[],
  openOnset: number | null,
): number | null {
  if (samples.length < 2) return null;
  let end = -1;
  if (openOnset !== null) {
    end = samples.findIndex(({ t }) => t >= openOnset);
  }
  if (end < 0) {
    end = 0;
    samples.forEach((sample, index) => {
      if (sample.level > samples[end].level) end = index;
    });
  }
  let low = 0;
  for (let index = 1; index <= end; index++) {
    // The latest lowest point, so a hand resting closed before opening does not slow the rate.
    if (samples[index].level <= samples[low].level) low = index;
  }
  const rise = samples[end].level - samples[low].level;
  const seconds = (samples[end].t - samples[low].t) / 1000;
  return rise > 0 && seconds > 0 ? rise / seconds : null;
}

export interface BloomMetrics {
  timeToOpenMs: number | null;
  peakOpenness: number | null;
  holdStability: number | null;
  timeToCloseMs: number | null;
  peakGrip: number | null;
  opennessRiseRate: number | null;
}

/** Every bloom measure, from the machine's moments and readings. */
export function bloomMetrics(
  moments: BloomMoments,
  samples: readonly OpennessSample[],
  peakGrip: number | null,
): BloomMetrics {
  const levels = samples.map(({ level }) => level);
  return {
    timeToOpenMs: moments.openOnset === null ? null : moments.openOnset - moments.spawn,
    peakOpenness: levels.length > 0 ? Math.max(...levels) : null,
    holdStability:
      moments.openOnset !== null && moments.bloomed !== null
        ? holdStability(samples, moments.openOnset, moments.bloomed)
        : null,
    timeToCloseMs:
      moments.closeOnset !== null && moments.closeStart !== null
        ? moments.closeOnset - moments.closeStart
        : null,
    peakGrip,
    opennessRiseRate: opennessRiseRate(samples, moments.openOnset),
  };
}

export interface BloomRecordInput {
  trialNo: number;
  params: GameParams;
  outcome: "success" | "miss";
  failedPhase: BloomFailPhase | null;
  moments: BloomMoments;
  metrics: BloomMetrics;
  compensation: TrialCompensation;
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;
const share = (value: number | null) => (value === null ? null : Math.min(1, Math.max(0, value)));

/**
 * One flower as the server stores it. It has no place in the body frame, so its target is just
 * its kind, and there is no trajectory. Timings are relative to the spawn; the grip hold of the
 * closing phase is saved as the activation.
 */
export function buildBloomRecord(input: BloomRecordInput): TrialCreate {
  const { moments, metrics } = input;
  const relative = (ms: number | null) => (ms === null ? null : round(ms - moments.spawn));
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: { kind: "bloom" },
    outcome: input.outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: relative(moments.closeOnset),
      activation_done: relative(moments.closeDone),
      end: relative(moments.end),
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: null,
      activation_latency_ms: round(metrics.timeToCloseMs),
      activation_peak: round(share(metrics.peakGrip), 3),
      time_to_open_ms: round(metrics.timeToOpenMs),
      peak_openness: round(share(metrics.peakOpenness), 3),
      hold_stability: round(metrics.holdStability, 4),
      time_to_close_ms: round(metrics.timeToCloseMs),
      peak_grip: round(share(metrics.peakGrip), 3),
      openness_rise_rate: round(metrics.opennessRiseRate, 3),
      failed_phase: input.failedPhase,
    },
    compensation: input.compensation,
    trajectory: [],
  };
}
