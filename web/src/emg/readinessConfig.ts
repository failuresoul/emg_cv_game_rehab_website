/**
 * Every threshold of the muscle-sensor check and calibration, in one place. Values for the
 * Advancer Muscle Sensor V3.0 envelope at the ESP32's pin (mV), sampled at 500 Hz.
 */
export const READINESS = {
  /** The PONG must come within this long of the PING. */
  pongTimeoutMs: 2000,
  /** Data rate over the last 2 s, samples per second. */
  rateWindowMs: 2000,
  minRateHz: 490,
  maxRateHz: 510,
  /** Counter gaps over the last 5 s, percent. */
  gapsWindowMs: 5000,
  maxGapsPct: 0.5,
  /** Electrode contact: the SD over 1 s must be above this (below is a flat line). */
  contactWindowMs: 1000,
  minContactSdMv: 2,
  /** No sample at or above the saturation level in the last 5 s. */
  saturationWindowMs: 5000,
  /** Relaxed and stable: over 2 s, SD and mean at or below these. */
  relaxedWindowMs: 2000,
  relaxedMaxSdMv: 40,
  relaxedMaxMeanMv: 800,
  /** Test squeeze: 2 s, peak at least this many times the relaxed mean, with an onset. */
  squeezeMs: 2000,
  squeezeMinRatio: 3,
  /** Checks 1-8 must stay green this long (once). */
  greenForMs: 2000,
} as const;

export const CALIBRATION = {
  restMs: 10_000,
  countdownMs: 3000,
  effortMs: 3000,
  pauseMs: 30_000,
  /** The pause between attempts in development builds. */
  pauseMsDevelopment: 10_000,
  attempts: 3,
  /** Each attempt's MVC is its highest mean over this long. */
  mvcWindowMs: 500,
  /** Attempts within this share of the largest (else one extra attempt). */
  maxAttemptSpread: 0.15,
  /** The MVC must be at least this many times the rest mean. */
  minMvcToRestRatio: 3,
} as const;
