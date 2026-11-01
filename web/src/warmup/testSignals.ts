// Synthetic angle signals for the warm-up tests.

export const FRAME_MS = 1000 / 30;

/** Repeatable random numbers from -1 to 1, so that a test cannot fail by chance. */
export function seededNoise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
}

export interface Sample {
  value: number;
  timestamp: number;
}

export interface CycleOptions {
  rest: number;
  peak: number;
  cycles: number;
  periodMs?: number;
  frameMs?: number;
  startTs?: number;
  noiseDeg?: number;
  seed?: number;
}

/** Smooth movements from rest to peak and back. */
export function cycles({
  rest,
  peak,
  cycles: count,
  periodMs = 3000,
  frameMs = FRAME_MS,
  startTs = 0,
  noiseDeg = 0,
  seed = 1,
}: CycleOptions): Sample[] {
  const noise = seededNoise(seed);
  const frames = Math.round((count * periodMs) / frameMs);
  return Array.from({ length: frames + 1 }, (_, index) => {
    const elapsed = index * frameMs;
    const shape = (1 - Math.cos((2 * Math.PI * elapsed) / periodMs)) / 2;
    return {
      value: rest + (peak - rest) * shape + noise() * noiseDeg,
      timestamp: startTs + elapsed,
    };
  });
}

/** A held value, for rest periods or holding at a target. */
export function hold(
  value: number,
  durationMs: number,
  startTs = 0,
  noiseDeg = 0,
  seed = 1,
): Sample[] {
  const noise = seededNoise(seed);
  const frames = Math.round(durationMs / FRAME_MS);
  return Array.from({ length: frames + 1 }, (_, index) => ({
    value: value + noise() * noiseDeg,
    timestamp: startTs + index * FRAME_MS,
  }));
}

/** Straight lines between [timestamp, value] points. */
export function ramp(points: [number, number][]): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [startTs, startValue] = points[i];
    const [endTs, endValue] = points[i + 1];
    for (let t = startTs; t < endTs; t += FRAME_MS) {
      const share = (t - startTs) / (endTs - startTs);
      samples.push({ value: startValue + share * (endValue - startValue), timestamp: t });
    }
  }
  const [lastTs, lastValue] = points[points.length - 1];
  samples.push({ value: lastValue, timestamp: lastTs });
  return samples;
}
