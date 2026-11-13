/**
 * The muscle sensor's calibration, pure: the relaxed level from 10 s at rest, and the maximum
 * voluntary contraction (MVC) from three efforts, each counted as its highest 0.5 s mean.
 */

import { FLAT_SD_MV, isSaturated, windowStats } from "./processing";
import { CALIBRATION, READINESS } from "./readinessConfig";

export type RestProblem = "electrodeOff" | "unstable";

export interface RestResult {
  mean: number;
  sd: number;
  problem: RestProblem | null;
}

/** The relaxed level: mean and SD of the smoothed envelope. Repeat if the line is flat (an
 * electrode off) or the arm was not still (SD or mean above the relaxed limits). */
export function restResult(envelope: ArrayLike<number>): RestResult {
  const { mean, sd } = windowStats(envelope);
  let problem: RestProblem | null = null;
  if (sd < FLAT_SD_MV) problem = "electrodeOff";
  else if (sd > READINESS.relaxedMaxSdMv || mean > READINESS.relaxedMaxMeanMv) {
    problem = "unstable";
  }
  return { mean, sd, problem };
}

/** The highest mean over any `windowMs` (0.5 s) of the envelope; the plain mean if shorter. */
export function highestWindowMean(
  envelope: ArrayLike<number>,
  fs: number,
  windowMs: number = CALIBRATION.mvcWindowMs,
): number {
  const size = Math.max(1, Math.round((fs * windowMs) / 1000));
  if (envelope.length === 0) return 0;
  if (envelope.length <= size) return windowStats(envelope).mean;
  let sum = 0;
  for (let index = 0; index < size; index += 1) sum += envelope[index]!;
  let best = sum;
  for (let index = size; index < envelope.length; index += 1) {
    sum += envelope[index]! - envelope[index - size]!;
    if (sum > best) best = sum;
  }
  return best / size;
}

export interface AttemptResult {
  /** The attempt's highest 0.5 s mean (mV). */
  peakMv: number;
  /** Any raw sample at the saturation level: repeat the attempt with less gain. */
  saturated: boolean;
}

export function evaluateAttempt(
  raw: ArrayLike<number>,
  envelope: ArrayLike<number>,
  fs: number,
): AttemptResult {
  let saturated = false;
  for (let index = 0; index < raw.length; index += 1) {
    if (isSaturated(raw[index]!)) {
      saturated = true;
      break;
    }
  }
  return { peakMv: highestWindowMean(envelope, fs), saturated };
}

/** (largest - smallest) / largest. */
export function attemptSpread(peaks: readonly number[]): number {
  if (peaks.length < 2) return 0;
  const largest = Math.max(...peaks);
  return largest > 0 ? (largest - Math.min(...peaks)) / largest : 0;
}

export interface MvcResult {
  mvc: number;
  /** The attempts averaged: all three, or the three closest of four. */
  used: number[];
  spread: number;
  consistent: boolean;
}

/** MVC = the average of the attempts; with a fourth (extra) attempt, of the three closest. */
export function combineAttempts(peaks: readonly number[]): MvcResult {
  let used = [...peaks];
  if (peaks.length > CALIBRATION.attempts) {
    const sorted = [...peaks].sort((a, b) => a - b);
    let best = sorted.slice(0, CALIBRATION.attempts);
    for (let start = 1; start + CALIBRATION.attempts <= sorted.length; start += 1) {
      const candidate = sorted.slice(start, start + CALIBRATION.attempts);
      if (attemptSpread(candidate) < attemptSpread(best)) best = candidate;
    }
    used = best;
  }
  const spread = attemptSpread(used);
  const mvc = used.length > 0 ? used.reduce((sum, value) => sum + value, 0) / used.length : 0;
  return { mvc, used, spread, consistent: spread <= CALIBRATION.maxAttemptSpread };
}

/** One extra attempt when the three are not within 15% (only once). */
export function needsExtraAttempt(peaks: readonly number[], extraUsed: boolean): boolean {
  return (
    !extraUsed &&
    peaks.length === CALIBRATION.attempts &&
    attemptSpread(peaks) > CALIBRATION.maxAttemptSpread
  );
}

/** The MVC must be at least 3 x the rest mean, or the electrodes are not over the muscle. */
export function mvcStrongEnough(mvc: number, restMean: number): boolean {
  return mvc >= CALIBRATION.minMvcToRestRatio * restMean;
}

/** Onset threshold, as the server computes it: rest mean + 3 x rest SD. */
export function thresholdMv(rest: { mean: number; sd: number }): number {
  return Math.round((rest.mean + 3 * rest.sd) * 100) / 100;
}

/** A short trace for the summary's mini plot: `points` evenly chosen values. */
export function downsample(values: ArrayLike<number>, points = 60): number[] {
  if (values.length <= points) return Array.from(values);
  const out: number[] = [];
  for (let index = 0; index < points; index += 1) {
    out.push(values[Math.floor((index * (values.length - 1)) / (points - 1))]!);
  }
  return out;
}
