/**
 * The muscle-sensor check and calibration thresholds, by their familiar names. The values live in
 * one place, emgSettings.ts (defaults in emgSettings.json, changes on the admin's "EMG settings"
 * panel); these getters read them when a rule runs, so a change applies at once.
 */

import { EMG } from "./emgSettings";

export const READINESS = {
  /** The PONG must come within this long of the PING. */
  get pongTimeoutMs() {
    return EMG.pongTimeoutMs;
  },
  /** Data rate over the last 2 s, samples per second. */
  get rateWindowMs() {
    return EMG.rateWindowMs;
  },
  get minRateHz() {
    return EMG.minRateHz;
  },
  get maxRateHz() {
    return EMG.maxRateHz;
  },
  /** Counter gaps over the last 5 s, percent. */
  get gapsWindowMs() {
    return EMG.gapsWindowMs;
  },
  get maxGapsPct() {
    return EMG.maxGapsPct;
  },
  /** Electrode contact: the SD over 1 s must be above this (below is a flat line). */
  get contactWindowMs() {
    return EMG.contactWindowMs;
  },
  get minContactSdMv() {
    return EMG.minContactSdMv;
  },
  /** No sample at or above the saturation level in the last 5 s. */
  get saturationWindowMs() {
    return EMG.saturationWindowMs;
  },
  /** Relaxed and stable: over 2 s, SD and mean at or below these. */
  get relaxedWindowMs() {
    return EMG.relaxedWindowMs;
  },
  get relaxedMaxSdMv() {
    return EMG.relaxedMaxSdMv;
  },
  get relaxedMaxMeanMv() {
    return EMG.relaxedMaxMeanMv;
  },
  /** Test squeeze: 2 s, peak at least this many times the relaxed mean, with an onset. */
  get squeezeMs() {
    return EMG.squeezeMs;
  },
  get squeezeMinRatio() {
    return EMG.squeezeMinRatio;
  },
  /** Checks 1-8 must stay green this long (once). */
  get greenForMs() {
    return EMG.greenForMs;
  },
};

export const CALIBRATION = {
  get restMs() {
    return EMG.restMs;
  },
  get countdownMs() {
    return EMG.countdownMs;
  },
  get effortMs() {
    return EMG.effortMs;
  },
  get pauseMs() {
    return EMG.pauseMs;
  },
  /** The pause between attempts in development builds (not a setting). */
  pauseMsDevelopment: 10_000,
  get attempts() {
    return EMG.attempts;
  },
  /** Each attempt's MVC is its highest mean over this long. */
  get mvcWindowMs() {
    return EMG.mvcWindowMs;
  },
  /** Attempts within this share of the largest (else one extra attempt). */
  get maxAttemptSpread() {
    return EMG.maxAttemptSpread;
  },
  /** The MVC must be at least this many times the rest mean. */
  get minMvcToRestRatio() {
    return EMG.minMvcToRestRatio;
  },
};
