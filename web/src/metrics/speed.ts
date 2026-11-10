import type { Sample } from "./resample";

/**
 * The rate of change of each sample, from its neighbours (central difference), or from the one
 * neighbour at either end. Samples whose time does not increase are dropped first.
 */
function rates(
  samples: readonly Sample[],
  size: (from: Sample, to: Sample) => number,
): [number, number][] {
  const usable: Sample[] = [];
  for (const sample of samples) {
    if (!sample.every(Number.isFinite)) continue;
    const last = usable.at(-1);
    if (!last || sample[0] > last[0]) usable.push(sample);
  }
  if (usable.length < 2) return [];
  return usable.map((sample, index) => {
    const from = usable[Math.max(0, index - 1)];
    const to = usable[Math.min(usable.length - 1, index + 1)];
    return [sample[0], size(from, to) / ((to[0] - from[0]) / 1000)];
  });
}

/**
 * Speed along a trajectory of [t_ms, x_sw, y_sw] points, in SW/s, as [t_ms, speed] rows. Use the
 * raw fingertip; smooth afterwards for analysis if needed.
 */
export function speedFromTrajectory(points: readonly Sample[]): [number, number][] {
  return rates(
    points.filter((point) => point.length >= 3),
    (from, to) => Math.hypot(to[1] - from[1], to[2] - from[2]),
  );
}

/** How fast an angle changes, from [t_ms, degrees] rows, in degrees per second (always ≥ 0). */
export function angularSpeed(samples: readonly Sample[]): [number, number][] {
  return rates(
    samples.filter((sample) => sample.length >= 2),
    (from, to) => Math.abs(to[1] - from[1]),
  );
}
