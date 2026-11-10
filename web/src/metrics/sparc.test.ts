import { describe, expect, it } from "vitest";

import vectors from "../../../shared/test-vectors/sparc.json";

import { sparc, SPARC_DEFAULTS, sparcDetails } from "./sparc";
import { speedFromTrajectory } from "./speed";

type Case = (typeof vectors.cases)[number];
const byName = (name: string): Case => {
  const found = vectors.cases.find((item) => item.name === name);
  if (!found) throw new Error(`no test vector ${name}`);
  return found;
};

/** Speed of a minimum-jerk movement of `distance` SW over `durationMs`, at 100 Hz. */
function minJerk(distance: number, durationMs: number, startMs = 0): number[][] {
  const rows: number[][] = [];
  for (let t = 0; t <= durationMs; t += 10) {
    const tau = t / durationMs;
    rows.push([startMs + t, (distance / (durationMs / 1000)) * 30 * tau ** 2 * (1 - tau) ** 2]);
  }
  return rows;
}

describe("SPARC test vectors (shared with the server)", () => {
  it("uses the same method as the vectors", () => {
    expect(vectors.method.resample_hz).toBe(SPARC_DEFAULTS.rateHz);
    expect(vectors.method.pad_level).toBe(SPARC_DEFAULTS.padLevel);
    expect(vectors.method.cutoff_hz).toBe(SPARC_DEFAULTS.cutoffHz);
    expect(vectors.method.amplitude_threshold).toBe(SPARC_DEFAULTS.amplitudeThreshold);
  });

  it.each(vectors.cases.map((item) => [item.name, item] as const))("reproduces %s", (_, item) => {
    const result = sparcDetails(item.speed);
    expect(result).not.toBeNull();
    const { expected } = item;
    expect(Math.abs((result?.sparc ?? 0) - expected.sparc)).toBeLessThan(vectors.tolerance);
    expect(result?.resampledCount).toBe(expected.resampled_count);
    expect(result?.fftSize).toBe(expected.fft_size);
    expect(result?.rateHz).toBeCloseTo(expected.rate_hz, 9);
    expect(result?.cutoffHz).toBeCloseTo(expected.cutoff_hz, 9);
  });
});

describe("sparc", () => {
  it("rates a minimum-jerk reach smoother than the same reach in two sub-movements", () => {
    const smooth = sparc(byName("min_jerk_reach").speed) as number;
    const twoParts = sparc(byName("two_sub_movements").speed) as number;
    expect(smooth).toBeLessThan(0);
    expect(smooth).toBeGreaterThan(twoParts);
  });

  it("makes a reach less smooth when noise is added", () => {
    const clean = sparc(byName("min_jerk_reach").speed) as number;
    const noisy = sparc(byName("noisy_reach").speed) as number;
    expect(noisy).toBeLessThan(clean);
  });

  it("does not depend on the movement's size or speed", () => {
    const base = sparc(minJerk(0.6, 1000)) as number;
    expect(sparc(minJerk(1.2, 1000))).toBeCloseTo(base, 6);
    // A slower reach of the same shape: only resampling details change.
    expect(sparc(minJerk(0.6, 1600))).toBeCloseTo(base, 1);
  });

  it("works from a trajectory's speed", () => {
    const points = Array.from({ length: 31 }, (_, i) => {
      const tau = i / 30;
      const along = 0.6 * (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5);
      return [i * (1000 / 30), along * 0.8, along * 0.6];
    });
    const value = sparc(speedFromTrajectory(points));
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThan(-2);
  });

  it("is null when there is nothing to measure", () => {
    expect(sparc([])).toBeNull();
    expect(
      sparc([
        [0, 1],
        [16, 1],
      ]),
    ).toBeNull();
    expect(
      sparc([
        [0, 0],
        [500, 0],
        [1000, 0],
      ]),
    ).toBeNull();
  });
});
