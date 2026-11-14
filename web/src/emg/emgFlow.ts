/**
 * The /session/emg page as a state machine: safety and placement -> sensor check -> calibration
 * (rest, then three maximum efforts) -> summary. Pure: the page sends the actions and runs the
 * timers; every rule is tested here.
 */

import {
  type AttemptResult,
  combineAttempts,
  type MvcResult,
  mvcStrongEnough,
  needsExtraAttempt,
  type RestResult,
} from "./calibration";
import type { CheckResult, SqueezeResult } from "./readiness";
import { CALIBRATION } from "./readinessConfig";
import type { EmgSourceKind } from "./stream";

export type EmgSite = "flexors" | "extensors";
export type Stage = "safety" | "check" | "calibrate" | "summary";
export const STAGES: readonly Stage[] = ["safety", "check", "calibrate", "summary"];

export interface SafetyAnswers {
  chargerUnplugged: boolean;
  batteriesFresh: boolean;
  electrodesOn: boolean;
}

export interface Attempt {
  peakMv: number;
  /** A short envelope trace for the summary's plot. */
  trace: number[];
}

export type CalibrationPhase =
  | { kind: "restReady" }
  | { kind: "rest"; startedAt: number }
  | { kind: "restFailed"; problem: RestResult["problem"] }
  | { kind: "attemptReady" }
  | { kind: "countdown"; startedAt: number }
  | { kind: "effort"; startedAt: number }
  | { kind: "attemptSaturated" }
  | { kind: "pause"; until: number }
  | { kind: "weak" }
  | { kind: "done" };

export interface FlowState {
  stage: Stage;
  site: EmgSite | null;
  safety: SafetyAnswers;
  /** Chosen at the safety stage in development, or by connecting in the check. */
  source: EmgSourceKind | null;
  squeeze: SqueezeResult | null;
  /** The checks as they were when the sensor became ready. */
  readiness: CheckResult[] | null;
  rest: RestResult | null;
  attempts: Attempt[];
  extraUsed: boolean;
  saturatedAttempts: number;
  phase: CalibrationPhase;
  mvc: MvcResult | null;
}

export type FlowAction =
  | { type: "chooseSite"; site: EmgSite }
  /** The programme's default site: chosen only while nothing is, on the safety stage. */
  | { type: "suggestSite"; site: EmgSite | null }
  | { type: "answerSafety"; key: keyof SafetyAnswers; value: boolean }
  | { type: "continueToCheck"; simulated?: boolean }
  | { type: "connected"; source: EmgSourceKind }
  | { type: "squeezeTested"; result: SqueezeResult }
  | { type: "ready"; readiness: CheckResult[] }
  | { type: "startRest"; now: number }
  | { type: "restDone"; result: RestResult }
  | { type: "startAttempt"; now: number }
  | { type: "countdownDone"; now: number }
  | { type: "attemptDone"; result: AttemptResult; trace: number[]; now: number; pauseMs: number }
  | { type: "pauseDone" }
  | { type: "redoCalibration" }
  | { type: "back" };

export const INITIAL_FLOW: FlowState = {
  stage: "safety",
  site: null,
  safety: { chargerUnplugged: false, batteriesFresh: false, electrodesOn: false },
  source: null,
  squeeze: null,
  readiness: null,
  rest: null,
  attempts: [],
  extraUsed: false,
  saturatedAttempts: 0,
  phase: { kind: "restReady" },
  mvc: null,
};

/** The three safety answers are needed for a real sensor; the simulated one needs only a site. */
export function canLeaveSafety(state: FlowState, simulated = false): boolean {
  if (state.site === null) return false;
  if (simulated) return true;
  const { chargerUnplugged, batteriesFresh, electrodesOn } = state.safety;
  return chargerUnplugged && batteriesFresh && electrodesOn;
}

/** Stage C is only reachable once the sensor is ready (checks green and the squeeze passed). */
export function canCalibrate(state: FlowState): boolean {
  return state.readiness !== null;
}

/** The laptop on battery and fresh batteries, as reported (stored with the calibration). */
export function batteryOk(state: FlowState): boolean {
  return state.safety.chargerUnplugged && state.safety.batteriesFresh;
}

const restartCalibration = (state: FlowState): FlowState => ({
  ...state,
  rest: null,
  attempts: [],
  extraUsed: false,
  saturatedAttempts: 0,
  phase: { kind: "restReady" },
  mvc: null,
});

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "chooseSite":
      return { ...state, site: action.site };
    case "suggestSite":
      if (action.site === null || state.site !== null || state.stage !== "safety") return state;
      return { ...state, site: action.site };
    case "answerSafety":
      return { ...state, safety: { ...state.safety, [action.key]: action.value } };
    case "continueToCheck":
      if (!canLeaveSafety(state, action.simulated)) return state;
      return {
        ...state,
        stage: "check",
        // Going on without the simulated sensor forgets it, so the real one can be connected.
        source: action.simulated ? "simulated" : state.source === "simulated" ? null : state.source,
      };
    case "connected":
      // A real sensor needs the safety answers, even after choosing the simulated one.
      if (action.source === "serial" && !canLeaveSafety(state)) {
        return { ...state, stage: "safety", source: null, squeeze: null, readiness: null };
      }
      return { ...state, source: action.source };
    case "squeezeTested":
      // Passing once is enough.
      return state.squeeze?.pass ? state : { ...state, squeeze: action.result };
    case "ready":
      if (state.stage !== "check" || !state.squeeze?.pass) return state;
      return { ...restartCalibration(state), stage: "calibrate", readiness: action.readiness };
    case "startRest":
      if (state.phase.kind !== "restReady" && state.phase.kind !== "restFailed") return state;
      return { ...state, phase: { kind: "rest", startedAt: action.now } };
    case "restDone":
      if (state.phase.kind !== "rest") return state;
      if (action.result.problem !== null) {
        return {
          ...state,
          rest: null,
          phase: { kind: "restFailed", problem: action.result.problem },
        };
      }
      return { ...state, rest: action.result, phase: { kind: "attemptReady" } };
    case "startAttempt":
      if (state.phase.kind !== "attemptReady" && state.phase.kind !== "attemptSaturated")
        return state;
      return { ...state, phase: { kind: "countdown", startedAt: action.now } };
    case "countdownDone":
      if (state.phase.kind !== "countdown") return state;
      return { ...state, phase: { kind: "effort", startedAt: action.now } };
    case "attemptDone": {
      if (state.phase.kind !== "effort" || state.rest === null) return state;
      if (action.result.saturated) {
        // Not counted: turn the gain down and repeat this attempt.
        return {
          ...state,
          saturatedAttempts: state.saturatedAttempts + 1,
          phase: { kind: "attemptSaturated" },
        };
      }
      const attempts = [...state.attempts, { peakMv: action.result.peakMv, trace: action.trace }];
      const peaks = attempts.map((attempt) => attempt.peakMv);
      const extra = needsExtraAttempt(peaks, state.extraUsed);
      const finished =
        attempts.length >= CALIBRATION.attempts + (state.extraUsed ? 1 : 0) && !extra;
      if (!finished) {
        return {
          ...state,
          attempts,
          extraUsed: state.extraUsed || extra,
          phase: { kind: "pause", until: action.now + action.pauseMs },
        };
      }
      const mvc = combineAttempts(peaks);
      if (!mvcStrongEnough(mvc.mvc, state.rest.mean)) {
        return { ...state, attempts, mvc, phase: { kind: "weak" } };
      }
      return { ...state, attempts, mvc, stage: "summary", phase: { kind: "done" } };
    }
    case "pauseDone":
      if (state.phase.kind !== "pause") return state;
      return { ...state, phase: { kind: "attemptReady" } };
    case "redoCalibration":
      return { ...restartCalibration(state), stage: "calibrate" };
    case "back":
      if (state.stage === "check") return { ...state, stage: "safety" };
      if (state.stage === "calibrate")
        return { ...state, stage: "check", readiness: null, squeeze: null };
      if (state.stage === "summary") return { ...restartCalibration(state), stage: "calibrate" };
      return state;
  }
}

/** What to store: the quality of the calibration. */
export function qualityOf(state: FlowState, gapsPct: number): Record<string, unknown> {
  return {
    saturation: state.saturatedAttempts > 0,
    saturated_attempts: state.saturatedAttempts,
    gaps_pct: Math.round(gapsPct * 100) / 100,
    electrode_off: false,
    attempts_spread: state.mvc ? Math.round(state.mvc.spread * 1000) / 1000 : null,
    consistent: state.mvc?.consistent ?? null,
    extra_attempt: state.extraUsed,
  };
}

/** The readiness checks as stored: every check with its value. */
export function readinessRecord(checks: readonly CheckResult[] | null): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const check of checks ?? []) record[check.id] = { pass: check.pass, value: check.value };
  return record;
}
