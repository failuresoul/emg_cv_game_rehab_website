import { describe, expect, it } from "vitest";

import { butterworthLowPass, movingAverage, resample } from "./resample";

/** About 30 Hz with jitter, like the webcam. */
const cameraTimes = [0, 31, 67, 99, 133, 170, 199, 236, 268, 300];

describe("resample", () => {
  it("keeps both endpoints exactly and spaces the rest evenly at about 60 Hz", () => {
    const samples = cameraTimes.map((t) => [t, 1 + t / 100]);
    const { samples: rows, rateHz } = resample(samples);
    expect(rows[0]).toEqual([0, 1]);
    expect(rows.at(-1)).toEqual([300, 4]);
    expect(rows).toHaveLength(19); // 0.3 s at 60 Hz, plus one.
    expect(rateHz).toBeCloseTo(60);
    const steps = rows.slice(1).map((row, index) => row[0] - rows[index][0]);
    steps.forEach((step) => expect(step).toBeCloseTo(1000 / 60));
  });

  it("interpolates linearly, so a straight line stays exact", () => {
    const samples = cameraTimes.map((t) => [t, 2 * t - 5]);
    for (const [t, value] of resample(samples).samples) expect(value).toBeCloseTo(2 * t - 5, 9);
  });

  it("resamples [t, x, y] points, keeping the end points", () => {
    const points = [
      [0, 0, 0],
      [40, 0.2, 0.1],
      [100, 0.5, 0.5],
    ];
    const { samples: rows } = resample(points, 60);
    expect(rows[0]).toEqual([0, 0, 0]);
    expect(rows.at(-1)).toEqual([100, 0.5, 0.5]);
    expect(rows[1][1]).toBeCloseTo((0.2 * 1000) / 60 / 40);
    expect(rows.every((row) => row.length === 3)).toBe(true);
  });

  it("drops repeated or backward times and broken values", () => {
    const { samples: rows } = resample([
      [0, 0],
      [0, 5],
      [50, 1],
      [40, 9],
      [60, Number.NaN],
      [100, 2],
    ]);
    expect(rows[0]).toEqual([0, 0]);
    expect(rows.at(-1)).toEqual([100, 2]);
    expect(Math.max(...rows.map((row) => row[1]))).toBeLessThanOrEqual(2);
  });

  it("gives nothing for fewer than two usable samples", () => {
    expect(resample([])).toEqual({ samples: [], rateHz: 0 });
    expect(resample([[5, 1]])).toEqual({ samples: [], rateHz: 0 });
  });
});

describe("movingAverage", () => {
  it("leaves a constant alone and averages the centred window", () => {
    expect(movingAverage([3, 3, 3, 3], 3)).toEqual([3, 3, 3, 3]);
    expect(movingAverage([0, 3, 6, 9], 3)).toEqual([1.5, 3, 6, 7.5]);
  });

  it("does not shift a symmetric peak in time", () => {
    const pulse = [0, 0, 1, 4, 9, 4, 1, 0, 0];
    const smooth = movingAverage(pulse, 5);
    expect(smooth.indexOf(Math.max(...smooth))).toBe(4);
  });
});

describe("butterworthLowPass", () => {
  const rate = 60;
  const sine = (hz: number, count = 240) =>
    Array.from({ length: count }, (_, t) => Math.sin((2 * Math.PI * hz * t) / rate));
  const amplitude = (values: number[]) =>
    Math.max(...values.slice(60, -60).map((value) => Math.abs(value)));

  it("passes a steady level unchanged", () => {
    butterworthLowPass([2, 2, 2, 2, 2], 6, rate).forEach((value) => expect(value).toBeCloseTo(2));
  });

  it("keeps slow movement and removes fast tremor-like noise", () => {
    expect(amplitude(butterworthLowPass(sine(1), 6, rate))).toBeGreaterThan(0.95);
    expect(amplitude(butterworthLowPass(sine(20), 6, rate))).toBeLessThan(0.05);
  });

  it("does not shift a peak in time (zero phase)", () => {
    const bump = Array.from({ length: 121 }, (_, t) => Math.exp(-(((t - 60) / 8) ** 2)));
    const smooth = butterworthLowPass(bump, 4, rate);
    expect(smooth.indexOf(Math.max(...smooth))).toBe(60);
  });

  it("refuses a cut-off at or above half the rate", () => {
    expect(() => butterworthLowPass([1, 2], 30, rate)).toThrow(RangeError);
    expect(() => butterworthLowPass([1, 2], 0, rate)).toThrow(RangeError);
    expect(butterworthLowPass([], 5, rate)).toEqual([]);
  });
});
