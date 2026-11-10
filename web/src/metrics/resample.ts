/** One sample: its time in ms, then one or more values, such as [t_ms, speed] or [t_ms, x, y]. */
export type Sample = readonly number[];

export const DEFAULT_RATE_HZ = 60;

export interface Resampled {
  /** Rows of [t_ms, ...values], evenly spaced from the first sample's time to the last's. */
  samples: number[][];
  /** The rate actually used: (points − 1) / duration. Within a fraction of a percent of the one asked. */
  rateHz: number;
}

/**
 * Resamples irregular samples to a fixed rate with linear interpolation. The number of points is
 * round(duration · rate) + 1, so the first and last samples are kept exactly. Samples whose time
 * does not increase are dropped. Fewer than two usable samples give no rows and a rate of 0.
 *
 * The server's Python version (Day 11) does the same, step for step, so results agree
 * (shared/test-vectors/generate_sparc_vectors.py).
 */
export function resample(samples: readonly Sample[], rateHz = DEFAULT_RATE_HZ): Resampled {
  const usable: Sample[] = [];
  for (const sample of samples) {
    if (sample.length < 2 || !sample.every(Number.isFinite)) continue;
    const last = usable.at(-1);
    if (!last || sample[0] > last[0]) usable.push(sample);
  }
  if (usable.length < 2 || !(rateHz > 0)) return { samples: [], rateHz: 0 };

  const t0 = usable[0][0];
  const tEnd = usable[usable.length - 1][0];
  const durationS = (tEnd - t0) / 1000;
  const count = Math.max(2, Math.round(durationS * rateHz) + 1);
  const width = Math.min(...usable.map((sample) => sample.length));
  const rows: number[][] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const t = t0 + ((tEnd - t0) * i) / (count - 1);
    while (j < usable.length - 2 && usable[j + 1][0] < t) j++;
    const a = usable[j];
    const b = usable[j + 1];
    const share = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const row = [t];
    for (let column = 1; column < width; column++) {
      row.push(a[column] + (b[column] - a[column]) * share);
    }
    rows.push(row);
  }
  // Exactly the original endpoints, without rounding error.
  rows[0] = [...usable[0].slice(0, width)];
  rows[count - 1] = [...usable[usable.length - 1].slice(0, width)];
  return { samples: rows, rateHz: (count - 1) / durationS };
}

/**
 * Zero-phase moving average for analysis: each point becomes the mean of the `window` points
 * centred on it (fewer near the ends), so peaks do not shift in time. `window` is made odd.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  const half = Math.max(0, Math.floor(window / 2));
  return values.map((_, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(values.length - 1, index + half);
    let total = 0;
    for (let k = from; k <= to; k++) total += values[k];
    return total / (to - from + 1);
  });
}

/** Runs one second-order section over the values, starting at rest at the first value. */
function biquad(values: readonly number[], b: readonly number[], a: readonly number[]): number[] {
  const offset = values[0];
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return values.map((value) => {
    const x = value - offset;
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y + offset;
  });
}

/**
 * A 2nd-order Butterworth low-pass filter run forwards then backwards (zero phase, effectively 4th
 * order), for analysis only: saved data stays raw. Each pass starts at rest at its first value,
 * which avoids a jump at the ends. The cut-off must be below half the sampling rate.
 */
export function butterworthLowPass(
  values: readonly number[],
  cutoffHz: number,
  rateHz: number,
): number[] {
  if (values.length === 0) return [];
  if (!(cutoffHz > 0) || !(cutoffHz < rateHz / 2)) {
    throw new RangeError(`cut-off ${cutoffHz} Hz must be between 0 and ${rateHz / 2} Hz`);
  }
  // Bilinear transform with pre-warping.
  const k = Math.tan((Math.PI * cutoffHz) / rateHz);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  const b = [b0, 2 * b0, b0];
  const a = [1, 2 * (k * k - 1) * norm, (1 - Math.SQRT2 * k + k * k) * norm];
  const forward = biquad(values, b, a);
  return biquad([...forward].reverse(), b, a).reverse();
}
