import { describe, expect, it } from "vitest";

import { binFrequencies, fft, magnitudeSpectrum, nextPowerOfTwo } from "./fft";

/** A direct DFT, to check the FFT against. */
function dftMagnitude(values: readonly number[]): number[] {
  const n = values.length;
  return values.map((_, k) => {
    let re = 0;
    let im = 0;
    values.forEach((value, t) => {
      re += value * Math.cos((-2 * Math.PI * k * t) / n);
      im += value * Math.sin((-2 * Math.PI * k * t) / n);
    });
    return Math.hypot(re, im);
  });
}

describe("nextPowerOfTwo", () => {
  it("rounds up to a power of two", () => {
    expect([0, 1, 2, 3, 61, 64, 65, 1000].map(nextPowerOfTwo)).toEqual([
      1, 1, 2, 4, 64, 64, 128, 1024,
    ]);
  });
});

describe("magnitudeSpectrum", () => {
  it("peaks at the frequency of a pure sine", () => {
    const rate = 64;
    const sine = Array.from({ length: 64 }, (_, t) => Math.sin((2 * Math.PI * 5 * t) / rate));
    const spectrum = magnitudeSpectrum(sine);
    const frequencies = binFrequencies(spectrum.length, rate);
    const half = spectrum.slice(0, spectrum.length / 2);
    const peak = half.indexOf(Math.max(...half));
    expect(frequencies[peak]).toBe(5);
    // A whole number of cycles: all the energy is in that bin (n / 2 for amplitude 1).
    expect(spectrum[peak]).toBeCloseTo(32);
    expect(spectrum[4]).toBeCloseTo(0);
  });

  it("finds the peak of a sine that is not a whole number of bins after zero-padding", () => {
    const rate = 60;
    const sine = Array.from({ length: 61 }, (_, t) => Math.sin((2 * Math.PI * 3 * t) / rate));
    const spectrum = magnitudeSpectrum(sine, 1024);
    expect(spectrum).toHaveLength(1024);
    const frequencies = binFrequencies(1024, rate);
    const half = spectrum.slice(0, 512);
    // Within about one bin (60 / 1024 Hz): a short window spreads the peak a little.
    const peakHz = frequencies[half.indexOf(Math.max(...half))];
    expect(Math.abs(peakHz - 3)).toBeLessThan((1.5 * rate) / 1024);
  });

  it("matches a direct DFT, and zero-pads to the next power of two", () => {
    const values = [0.3, -1.2, 2.5, 0, 4.1, -0.7, 1.9];
    const spectrum = magnitudeSpectrum(values);
    expect(spectrum).toHaveLength(8);
    const expected = dftMagnitude([...values, 0]);
    spectrum.forEach((value, k) => expect(value).toBeCloseTo(expected[k], 10));
  });

  it("puts a constant signal's energy at 0 Hz", () => {
    const spectrum = magnitudeSpectrum([2, 2, 2, 2]);
    expect(spectrum[0]).toBe(8);
    expect(spectrum.slice(1).every((value) => Math.abs(value) < 1e-12)).toBe(true);
  });
});

describe("fft", () => {
  it("refuses lengths that are not a power of two", () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    expect(() => fft(new Float64Array(4), new Float64Array(2))).toThrow(RangeError);
  });
});
