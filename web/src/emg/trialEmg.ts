import type { EmgSite, GameId, TrialTarget, TrialTimings } from "@/types/api";

import { type EmgCalibration, MAX_PERCENT_MVC, OFFSET_MS, ONSET_K, ONSET_MS } from "./processing";

/** The per-trial trace is kept at 50 Hz, and at most 1500 points (30 s) are saved. */
export const EMG_TRACE_STEP_MS = 20;
export const MAX_EMG_TRACE_POINTS = 1500;
/** The recorder keeps the last minute, longer than any trial. */
const RECORDER_SECONDS = 60;

/** [ms since the trial's spawn, %MVC]. */
export type EmgTracePoint = [number, number];

export interface TrialEmgMetrics {
  peak_mvc: number | null;
  mean_mvc_active: number | null;
  onset_latency_ms: number | null;
  relaxation_ms: number | null;
  onset_ms: number | null;
  offset_ms: number | null;
  time_in_band_pct: number | null;
  steadiness: number | null;
}

export interface TrialEmg {
  site: EmgSite;
  trace: EmgTracePoint[];
  metrics: TrialEmgMetrics;
}

/**
 * %MVC at 50 Hz in game time, while the muscle sensor drives the game. A trial's part is cut out
 * when it is logged.
 */
export class EmgTraceRecorder {
  private readonly times: number[] = [];
  private readonly values: number[] = [];

  /** Adds a sample, at most one every 20 ms; time must not go backwards. */
  add(t: number, percent: number): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && t - last < EMG_TRACE_STEP_MS) return;
    this.times.push(t);
    this.values.push(Math.min(MAX_PERCENT_MVC, Math.max(0, percent)));
    const oldest = t - RECORDER_SECONDS * 1000;
    let drop = 0;
    while (drop < this.times.length && (this.times[drop] as number) < oldest) drop += 1;
    if (drop > 0) {
      this.times.splice(0, drop);
      this.values.splice(0, drop);
    }
  }

  /** The samples from `from` to `to` (game time), as [ms since `from`, %MVC]. */
  slice(from: number, to: number): EmgTracePoint[] {
    const out: EmgTracePoint[] = [];
    this.times.forEach((t, index) => {
      if (t >= from && t <= to)
        out.push([round(t - from, 0), round(this.values[index] as number, 1)]);
    });
    return out;
  }

  get size(): number {
    return this.times.length;
  }

  clear(): void {
    this.times.length = 0;
    this.values.length = 0;
  }
}

/** At most `max` points, chosen evenly, always keeping the first and the last. */
export function capTrace(
  trace: readonly EmgTracePoint[],
  max = MAX_EMG_TRACE_POINTS,
): EmgTracePoint[] {
  if (trace.length <= max) return [...trace];
  if (max <= 1) return trace.slice(0, max);
  const out: EmgTracePoint[] = [];
  const step = (trace.length - 1) / (max - 1);
  for (let index = 0; index < max; index += 1) {
    out.push(trace[Math.round(index * step)] as EmgTracePoint);
  }
  return out;
}

/** The onset threshold in %MVC: rest mean + 3 x rest SD, on the 0-100 scale of rest to MVC. */
export function thresholdPercent(calibration: EmgCalibration): number {
  const range = calibration.mvc - calibration.restMean;
  if (!(range > 0)) return 0;
  return Math.max(0, ((ONSET_K * calibration.restSd) / range) * 100);
}

/**
 * When the muscle should act in a trial (ms since spawn): `cue` asks for the contraction,
 * `release` for letting go; `hold` is the holding window and `band` the target band (%MVC) of a
 * holding game.
 */
export interface EmgCues {
  cue: number | null;
  release: number | null;
  hold: { from: number; to: number } | null;
  band: { low: number; high: number } | null;
}

/**
 * The cues of each EMG game, from its timings (relative to spawn):
 * - reach_activate: squeeze once the dwell is done; let go once the activation is done.
 * - grip_hold: squeeze from the start; hold from entering the band to the hold time reached,
 *   then the relax prompt.
 * - bloom (extensors): open from the start; the close begins at activation_start.
 */
export function emgCuesFor(
  gameId: GameId,
  timings: TrialTimings,
  target: TrialTarget | null,
): EmgCues {
  if (gameId === "reach_activate") {
    return { cue: timings.dwell_done, release: timings.activation_done, hold: null, band: null };
  }
  if (gameId === "grip_hold") {
    const hold =
      timings.activation_start !== null && timings.activation_done !== null
        ? { from: timings.activation_start, to: timings.activation_done }
        : null;
    const center = target?.kind === "grip_band" ? target.center : undefined;
    const width = target?.kind === "grip_band" ? target.width : undefined;
    const band =
      center !== undefined && width !== undefined
        ? { low: (center - width / 2) * 100, high: (center + width / 2) * 100 }
        : null;
    return { cue: 0, release: timings.activation_done, hold, band };
  }
  if (gameId === "bloom") {
    return { cue: 0, release: timings.activation_start, hold: null, band: null };
  }
  return { cue: null, release: null, hold: null, band: null };
}

/** The first time at or after `from` when the trace stays on one side of the threshold for
 * `holdMs`; the crossing's start is returned, as the live detector does. */
function firstSustained(
  trace: readonly EmgTracePoint[],
  from: number,
  threshold: number,
  above: boolean,
  holdMs: number,
): number | null {
  let since: number | null = null;
  for (const [t, value] of trace) {
    if (t < from) continue;
    const onSide = above ? value >= threshold : value < threshold;
    if (!onSide) {
      since = null;
      continue;
    }
    if (since === null) since = t;
    if (t - since >= holdMs) return since;
  }
  return null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * One trial's EMG measures from its %MVC trace:
 * - peak_mvc: the highest %MVC;
 * - mean_mvc_active: mean %MVC of the samples above the onset threshold;
 * - onset: first contraction (above the threshold for 50 ms) after the cue; latency from the cue;
 * - offset: first relaxation (below for 100 ms) after the release cue; relaxation from that cue;
 * - holding games: share of the hold inside the band, and steadiness (SD of the level, 0-1).
 */
export function emgTrialMetrics(
  trace: readonly EmgTracePoint[],
  cues: EmgCues,
  thresholdPct: number,
): TrialEmgMetrics {
  const values = trace.map(([, value]) => value);
  const peak = values.length > 0 ? Math.max(...values) : null;
  const active = values.filter((value) => value >= thresholdPct);
  const meanActive =
    active.length > 0 ? active.reduce((total, value) => total + value, 0) / active.length : null;

  const onset =
    cues.cue === null ? null : firstSustained(trace, cues.cue, thresholdPct, true, ONSET_MS);
  const offset =
    cues.release === null
      ? null
      : firstSustained(trace, cues.release, thresholdPct, false, OFFSET_MS);

  let timeInBand: number | null = null;
  let steadiness: number | null = null;
  if (cues.hold && cues.band) {
    const { from, to } = cues.hold;
    const { low, high } = cues.band;
    const held = trace.filter(([t]) => t >= from && t <= to).map(([, value]) => value);
    if (held.length > 0) {
      const inside = held.filter((value) => value >= low && value <= high).length;
      timeInBand = (inside / held.length) * 100;
      const levels = held.map((value) => Math.min(1, value / 100));
      const mean = levels.reduce((total, value) => total + value, 0) / levels.length;
      const variance =
        levels.reduce((total, value) => total + (value - mean) ** 2, 0) / levels.length;
      steadiness = Math.sqrt(variance);
    }
  }

  return {
    peak_mvc: peak === null ? null : round(Math.min(MAX_PERCENT_MVC, peak), 1),
    mean_mvc_active: meanActive === null ? null : round(meanActive, 1),
    onset_latency_ms: onset === null || cues.cue === null ? null : round(onset - cues.cue, 0),
    relaxation_ms:
      offset === null || cues.release === null ? null : round(offset - cues.release, 0),
    onset_ms: onset === null ? null : round(onset, 0),
    offset_ms: offset === null ? null : round(offset, 0),
    time_in_band_pct: timeInBand === null ? null : round(timeInBand, 1),
    steadiness: steadiness === null ? null : round(steadiness, 4),
  };
}

/** The trial's EMG record: its trace (capped) and measures. */
export function buildTrialEmg(input: {
  site: EmgSite;
  trace: readonly EmgTracePoint[];
  gameId: GameId;
  timings: TrialTimings;
  target: TrialTarget | null;
  calibration: EmgCalibration;
}): TrialEmg {
  const cues = emgCuesFor(input.gameId, input.timings, input.target);
  return {
    site: input.site,
    trace: capTrace(input.trace),
    metrics: emgTrialMetrics(input.trace, cues, thresholdPercent(input.calibration)),
  };
}
