/**
 * The muscle-sensor check, like the camera check: nine items, each green or red with its
 * measured value and a hint when red. Pure: the page gathers the numbers (gatherReadiness) and
 * this decides.
 */

import type { TranslationKey } from "@/i18n";

import type { EmgEngine, EmgStatus } from "./engine";
import { OnsetDetector, SATURATION_MV, windowStats } from "./processing";
import { READINESS } from "./readinessConfig";

export type CheckId =
  | "webSerial"
  | "connected"
  | "responding"
  | "rate"
  | "gaps"
  | "contact"
  | "saturation"
  | "relaxed"
  | "squeeze";

export const CHECK_ORDER: readonly CheckId[] = [
  "webSerial",
  "connected",
  "responding",
  "rate",
  "gaps",
  "contact",
  "saturation",
  "relaxed",
  "squeeze",
];

/** Checks 1-8: the ones that must stay green for 2 s. */
export const STEADY_CHECKS: readonly CheckId[] = CHECK_ORDER.filter((id) => id !== "squeeze");

export interface CheckResult {
  id: CheckId;
  pass: boolean;
  /** The measured value, shown beside the label; null while unknown. */
  value: string | null;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
}

export interface SqueezeResult {
  pass: boolean;
  peakMv: number;
  /** Peak over the relaxed mean. */
  ratio: number;
  onset: boolean;
}

export interface ReadinessInput {
  simulated: boolean;
  webSerialSupported: boolean;
  connected: boolean;
  now: number;
  ping: { sentAt: number | null; answeredAt: number | null; version: string | null };
  rateHz: number | null;
  gapsPct: number | null;
  /** SD over the last second (mV); null without a second of signal. */
  contactSdMv: number | null;
  saturated: boolean | null;
  relaxed: { mean: number; sd: number } | null;
  squeeze: SqueezeResult | null;
}

const LABELS: Record<CheckId, { labelKey: TranslationKey; hintKey: TranslationKey }> = {
  webSerial: { labelKey: "emgCheck.webSerial", hintKey: "emgCheck.webSerial.hint" },
  connected: { labelKey: "emgCheck.connected", hintKey: "emgCheck.connected.hint" },
  responding: { labelKey: "emgCheck.responding", hintKey: "emgCheck.responding.hint" },
  rate: { labelKey: "emgCheck.rate", hintKey: "emgCheck.rate.hint" },
  gaps: { labelKey: "emgCheck.gaps", hintKey: "emgCheck.gaps.hint" },
  contact: { labelKey: "emgCheck.contact", hintKey: "emgCheck.contact.hint" },
  saturation: { labelKey: "emgCheck.saturation", hintKey: "emgCheck.saturation.hint" },
  relaxed: { labelKey: "emgCheck.relaxed", hintKey: "emgCheck.relaxed.hint" },
  squeeze: { labelKey: "emgCheck.squeeze", hintKey: "emgCheck.squeeze.hint" },
};

function result(id: CheckId, pass: boolean, value: string | null): CheckResult {
  return { id, pass, value, ...LABELS[id] };
}

const mv = (value: number) => `${Math.round(value)} mV`;

export function evaluateReadiness(input: ReadinessInput): CheckResult[] {
  const { ping } = input;
  const answered =
    ping.sentAt !== null &&
    ping.answeredAt !== null &&
    ping.answeredAt - ping.sentAt <= READINESS.pongTimeoutMs;
  const streaming = input.connected && input.rateHz !== null;
  return [
    result(
      "webSerial",
      input.simulated || input.webSerialSupported,
      input.simulated ? "simulated" : input.webSerialSupported ? "Web Serial" : null,
    ),
    result("connected", input.connected, null),
    result("responding", input.connected && answered, answered ? ping.version : null),
    result(
      "rate",
      streaming && input.rateHz! >= READINESS.minRateHz && input.rateHz! <= READINESS.maxRateHz,
      input.rateHz === null ? null : `${Math.round(input.rateHz)}/s`,
    ),
    result(
      "gaps",
      streaming && input.gapsPct !== null && input.gapsPct < READINESS.maxGapsPct,
      input.gapsPct === null ? null : `${input.gapsPct.toFixed(1)}%`,
    ),
    result(
      "contact",
      streaming && input.contactSdMv !== null && input.contactSdMv > READINESS.minContactSdMv,
      input.contactSdMv === null ? null : `SD ${input.contactSdMv.toFixed(1)} mV`,
    ),
    result(
      "saturation",
      streaming && input.saturated === false,
      input.saturated === null ? null : input.saturated ? "≥ 3000 mV" : "OK",
    ),
    result(
      "relaxed",
      streaming &&
        input.relaxed !== null &&
        input.relaxed.sd <= READINESS.relaxedMaxSdMv &&
        input.relaxed.mean <= READINESS.relaxedMaxMeanMv,
      input.relaxed === null ? null : `${mv(input.relaxed.mean)} ± ${input.relaxed.sd.toFixed(0)}`,
    ),
    result(
      "squeeze",
      input.squeeze?.pass === true,
      input.squeeze === null ? null : `${input.squeeze.ratio.toFixed(1)}×`,
    ),
  ];
}

/**
 * "Green for 2 s": true once checks 1-8 have all been green for READINESS.greenForMs without a
 * break. Like the camera check, it then stays true (squeezing turns "relaxed" red, as it should).
 */
export class GreenLatch {
  private since: number | null = null;
  private latched = false;

  update(allGreen: boolean, now: number): boolean {
    if (this.latched) return true;
    if (!allGreen) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = now;
    if (now - this.since >= READINESS.greenForMs) this.latched = true;
    return this.latched;
  }

  get isLatched(): boolean {
    return this.latched;
  }
}

export function steadyChecksGreen(results: readonly CheckResult[]): boolean {
  return results.filter((check) => STEADY_CHECKS.includes(check.id)).every((check) => check.pass);
}

/** Ready: checks 1-8 green for 2 s (once) and the test squeeze passed once. */
export function isSensorReady(latched: boolean, squeezePassed: boolean): boolean {
  return latched && squeezePassed;
}

/**
 * The test squeeze (or opening, for the extensors): over its 2 s, the smoothed envelope's peak
 * must reach 3 x the relaxed mean, and an onset (relaxed mean + 3 SD for 50 ms) must be seen.
 */
export function evaluateSqueeze(
  times: ArrayLike<number>,
  envelope: ArrayLike<number>,
  relaxed: { mean: number; sd: number },
): SqueezeResult {
  const detector = new OnsetDetector({ restMean: relaxed.mean, restSd: relaxed.sd });
  let onset = false;
  let peak = 0;
  for (let index = 0; index < envelope.length; index += 1) {
    const value = envelope[index]!;
    if (value > peak) peak = value;
    if (detector.push(times[index]!, value)?.type === "onset") onset = true;
  }
  const ratio = relaxed.mean > 0 ? peak / relaxed.mean : peak > 0 ? Infinity : 0;
  return { pass: onset && ratio >= READINESS.squeezeMinRatio, peakMv: peak, ratio, onset };
}

/** The numbers for evaluateReadiness, from the engine's last 5 s. */
export function gatherReadiness(
  engine: EmgEngine,
  status: EmgStatus,
  options: {
    simulated: boolean;
    webSerialSupported: boolean;
    now: number;
    squeeze: SqueezeResult | null;
  },
): ReadinessInput {
  const fs = engine.sampleRateHz;
  const signal = engine.recent(READINESS.saturationWindowMs / 1000);
  const samples = (ms: number) => Math.round((fs * ms) / 1000);
  const lastRaw = (ms: number) => signal.mv.subarray(Math.max(0, signal.mv.length - samples(ms)));
  const lastEnvelope = (ms: number) =>
    signal.envelope.subarray(Math.max(0, signal.envelope.length - samples(ms)));
  const enough = (values: ArrayLike<number>, ms: number) => values.length >= samples(ms) * 0.9;

  const rate = engine.arrivalStats(READINESS.rateWindowMs, options.now);
  const gaps = engine.arrivalStats(READINESS.gapsWindowMs, options.now);
  const contact = lastRaw(READINESS.contactWindowMs);
  const relaxedWindow = lastEnvelope(READINESS.relaxedWindowMs);
  let saturated: boolean | null = null;
  if (signal.mv.length > 0) {
    saturated = signal.mv.some((value) => value >= SATURATION_MV);
  }
  const relaxedStats = windowStats(relaxedWindow);
  return {
    simulated: options.simulated,
    webSerialSupported: options.webSerialSupported,
    connected: status.connected,
    now: options.now,
    ping: engine.getPing(),
    rateHz: status.connected && rate.received > 0 ? rate.rateHz : status.connected ? 0 : null,
    gapsPct: gaps.received > 0 ? gaps.gapsPct : null,
    contactSdMv: enough(contact, READINESS.contactWindowMs) ? windowStats(contact).sd : null,
    saturated,
    relaxed: enough(relaxedWindow, READINESS.relaxedWindowMs)
      ? { mean: relaxedStats.mean, sd: relaxedStats.sd }
      : null,
    squeeze: options.squeeze,
  };
}
