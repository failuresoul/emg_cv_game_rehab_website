import { binFrequencies, magnitudeSpectrum, nextPowerOfTwo } from "./fft";
import { DEFAULT_RATE_HZ, resample, type Sample } from "./resample";

export interface SparcOptions {
  /** The speed profile is resampled to this rate first. */
  rateHz?: number;
  /** Zero-padding: the FFT has 2^(ceil(log2(points)) + padLevel) points. */
  padLevel?: number;
  /** The highest frequency considered. */
  cutoffHz?: number;
  /** The spectrum is cut at the last frequency whose normalised magnitude is at least this. */
  amplitudeThreshold?: number;
}

export const SPARC_DEFAULTS: Required<SparcOptions> = {
  rateHz: DEFAULT_RATE_HZ,
  padLevel: 4,
  cutoffHz: 10,
  amplitudeThreshold: 0.05,
};

export interface SparcResult {
  /** The smoothness: always ≤ 0, and closer to 0 is smoother. */
  sparc: number;
  /** The frequency where the spectrum was cut. */
  cutoffHz: number;
  fftSize: number;
  /** The rate the speed profile was resampled to. */
  rateHz: number;
  resampledCount: number;
}

/**
 * SPARC, the spectral arc length of a speed profile: a measure of movement smoothness that does
 * not depend on the movement's size or duration.
 *
 * Balasubramanian S, Melendez-Calderon A, Roby-Brami A, Burdet E (2015). "On the analysis of
 * movement smoothness." Journal of NeuroEngineering and Rehabilitation 12:112.
 * https://doi.org/10.1186/s12984-015-0090-9
 *
 * Steps, as in the paper's reference code:
 * 1. Resample the speed profile to 60 Hz (linear interpolation, endpoints kept).
 * 2. Zero-pad to 2^(ceil(log2(points)) + 4) points and take the magnitude spectrum.
 * 3. Normalise the magnitude by its value at 0 Hz.
 * 4. Keep frequencies up to the last one (at most 10 Hz) whose normalised magnitude is ≥ 0.05.
 * 5. SPARC is minus the arc length of that curve, with frequency normalised to 0–1.
 *
 * Returns null for fewer than three samples or a profile with no movement (zero at 0 Hz). The
 * shared test vectors (shared/test-vectors/sparc.json) pin the results for the server's Python
 * version.
 */
export function sparcDetails(
  speed: readonly Sample[],
  options: SparcOptions = {},
): SparcResult | null {
  const { rateHz, padLevel, cutoffHz, amplitudeThreshold } = { ...SPARC_DEFAULTS, ...options };
  const { samples, rateHz: actualRate } = resample(speed, rateHz);
  if (samples.length < 3) return null;
  const values = samples.map((row) => row[1]);

  const fftSize = 2 ** (Math.log2(nextPowerOfTwo(values.length)) + padLevel);
  const magnitude = magnitudeSpectrum(values, fftSize);
  const dc = magnitude[0];
  if (!(dc > 0)) return null;
  const normalised = magnitude.map((value) => value / dc);
  const frequencies = binFrequencies(fftSize, actualRate);

  let last = 0;
  for (let k = 0; k < fftSize && frequencies[k] <= cutoffHz; k++) {
    if (normalised[k] >= amplitudeThreshold) last = k;
  }
  if (last === 0) return null;

  const span = frequencies[last] - frequencies[0];
  let arc = 0;
  for (let k = 1; k <= last; k++) {
    arc += Math.hypot(
      (frequencies[k] - frequencies[k - 1]) / span,
      normalised[k] - normalised[k - 1],
    );
  }
  return {
    sparc: -arc,
    cutoffHz: frequencies[last],
    fftSize,
    rateHz: actualRate,
    resampledCount: values.length,
  };
}

/** SPARC of a speed profile of [t_ms, speed] rows; null if it cannot be measured. */
export function sparc(speed: readonly Sample[], options: SparcOptions = {}): number | null {
  return sparcDetails(speed, options)?.sparc ?? null;
}
