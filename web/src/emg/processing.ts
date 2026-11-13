/**
 * Pure EMG processing on the sensor's envelope (millivolts at the ESP32's pin). No browser APIs:
 * every function here is tested on its own.
 */

/** At or above this the signal is clipped: the sensor's gain or the voltage divider is too high
 * (firmware/README.md keeps the pin at or below 3.0 V). */
export const SATURATION_MV = 3000;
/** A standard deviation below this over a second means a flat line: an electrode is off. */
export const FLAT_SD_MV = 2;
export const SMOOTHING_MS = 50;
export const MAX_PERCENT_MVC = 120;
/** Onset: above rest mean + k * rest SD for ONSET_MS; offset: below it for OFFSET_MS. */
export const ONSET_K = 3;
export const ONSET_MS = 50;
export const OFFSET_MS = 100;

export function isSaturated(mv: number): boolean {
  return mv >= SATURATION_MV;
}

export interface WindowStats {
  count: number;
  mean: number;
  sd: number;
  peak: number;
  min: number;
}

/** Mean, (population) standard deviation, peak and minimum; zeros for no values. */
export function windowStats(values: ArrayLike<number>): WindowStats {
  const count = values.length;
  if (count === 0) return { count: 0, mean: 0, sd: 0, peak: 0, min: 0 };
  let sum = 0;
  let peak = -Infinity;
  let min = Infinity;
  for (let index = 0; index < count; index += 1) {
    const value = values[index]!;
    sum += value;
    if (value > peak) peak = value;
    if (value < min) min = value;
  }
  const mean = sum / count;
  let squares = 0;
  for (let index = 0; index < count; index += 1) {
    const difference = values[index]! - mean;
    squares += difference * difference;
  }
  return { count, mean, sd: Math.sqrt(squares / count), peak, min };
}

/** Flat line over the window (at least half a second of samples): the electrode is off. */
export function isFlatLine(values: ArrayLike<number>, minimumSamples: number): boolean {
  if (values.length < minimumSamples) return false;
  return windowStats(values).sd < FLAT_SD_MV;
}

/** Saturation: at least `minimumCount` samples of the window are clipped. */
export function isSaturating(values: ArrayLike<number>, minimumCount = 5): boolean {
  let clipped = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (isSaturated(values[index]!)) {
      clipped += 1;
      if (clipped >= minimumCount) return true;
    }
  }
  return false;
}

/** A moving average over the last `windowMs` (50 ms by default) of samples at fs. */
export class MovingAverage {
  private readonly values: Float64Array;
  private index = 0;
  private filled = 0;
  private sum = 0;

  constructor(fs: number, windowMs = SMOOTHING_MS) {
    this.values = new Float64Array(Math.max(1, Math.round((fs * windowMs) / 1000)));
  }

  push(value: number): number {
    if (this.filled === this.values.length) this.sum -= this.values[this.index]!;
    else this.filled += 1;
    this.values[this.index] = value;
    this.sum += value;
    this.index = (this.index + 1) % this.values.length;
    return this.sum / this.filled;
  }

  reset(): void {
    this.values.fill(0);
    this.index = 0;
    this.filled = 0;
    this.sum = 0;
  }
}

export interface EmgCalibration {
  /** The smoothed envelope at rest (mV) and its spread. */
  restMean: number;
  restSd: number;
  /** The smoothed envelope at the strongest voluntary contraction (mV). */
  mvc: number;
}

/** (envelope - rest) / (MVC - rest) as a percentage, clamped to 0-120; 0 for a calibration with
 * no range. */
export function percentMvc(envelopeMv: number, calibration: EmgCalibration): number {
  const range = calibration.mvc - calibration.restMean;
  if (!(range > 0) || !Number.isFinite(envelopeMv)) return 0;
  const percent = ((envelopeMv - calibration.restMean) / range) * 100;
  return Math.min(MAX_PERCENT_MVC, Math.max(0, percent));
}

export type OnsetEvent = { type: "onset" | "offset"; t: number };

/**
 * Contraction onset and offset with hysteresis in time: onset once the envelope stays above
 * rest mean + 3 x rest SD for 50 ms, offset once it stays below for 100 ms. Each event carries the
 * time the crossing began, not when it was confirmed.
 */
export class OnsetDetector {
  readonly threshold: number;
  private active = false;
  private crossingSince: number | null = null;

  constructor(calibration: Pick<EmgCalibration, "restMean" | "restSd">, k = ONSET_K) {
    this.threshold = calibration.restMean + k * calibration.restSd;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The next smoothed sample at time t (ms); an event when one is confirmed. */
  push(t: number, envelopeMv: number): OnsetEvent | null {
    const above = envelopeMv > this.threshold;
    if (above === this.active) {
      // Back on the current side: a crossing that did not last is forgotten.
      this.crossingSince = null;
      return null;
    }
    if (this.crossingSince === null) this.crossingSince = t;
    const needed = this.active ? OFFSET_MS : ONSET_MS;
    if (t - this.crossingSince < needed) return null;
    this.active = above;
    const event: OnsetEvent = { type: above ? "onset" : "offset", t: this.crossingSince };
    this.crossingSince = null;
    return event;
  }
}

/** A fixed-size circular store of the last samples, oldest first when read. */
export class RingBuffer {
  private readonly data: Float64Array;
  private start = 0;
  private size = 0;

  constructor(capacity: number) {
    this.data = new Float64Array(Math.max(1, capacity));
  }

  get length(): number {
    return this.size;
  }

  get capacity(): number {
    return this.data.length;
  }

  push(value: number): void {
    const end = (this.start + this.size) % this.data.length;
    this.data[end] = value;
    if (this.size < this.data.length) this.size += 1;
    else this.start = (this.start + 1) % this.data.length;
  }

  /** The last `count` values (all, by default), oldest first. */
  last(count = this.size): Float64Array {
    const n = Math.min(count, this.size);
    const out = new Float64Array(n);
    const from = this.start + this.size - n;
    for (let index = 0; index < n; index += 1) {
      out[index] = this.data[(from + index) % this.data.length]!;
    }
    return out;
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }
}
