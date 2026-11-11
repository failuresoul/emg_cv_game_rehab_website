import type { TranslationKey } from "@/i18n";
import type { AdaptationLogRow, EngineCue } from "@/types/api";

/** The difficulty components, in the order they are drawn. */
export const COMPONENTS = ["spatial", "activation", "speed", "precision"] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_KEYS: Readonly<Record<Component, TranslationKey>> = {
  spatial: "adminAdaptation.component.spatial",
  activation: "adminAdaptation.component.activation",
  speed: "adminAdaptation.component.speed",
  precision: "adminAdaptation.component.precision",
};

export const CUE_KEYS: Readonly<Record<EngineCue, TranslationKey>> = {
  posture: "adminAdaptation.cue.posture",
  encourage: "adminAdaptation.cue.encourage",
  rest: "adminAdaptation.cue.rest",
  finish_soon: "adminAdaptation.cue.finishSoon",
  finish: "adminAdaptation.cue.finish",
};

/** Which safety rule stepped in, from the start of each part of a safety_override. */
export type OverrideKind = "bounds" | "compensation" | "failures" | "tiring";

export const OVERRIDE_KEYS: Readonly<Record<OverrideKind, TranslationKey>> = {
  bounds: "adminAdaptation.flag.bounds",
  compensation: "adminAdaptation.flag.compensation",
  failures: "adminAdaptation.flag.failures",
  tiring: "adminAdaptation.flag.tiring",
};

/** The rules named in a safety override, in the order they were applied. */
export function overrideKinds(override: string | null): OverrideKind[] {
  if (!override) return [];
  return override.split("; ").flatMap((part): OverrideKind[] => {
    if (part.startsWith("Kept within")) return ["bounds"];
    if (part.startsWith("Compensation")) return ["compensation"];
    if (/^\d+ failures in a row/.test(part)) return ["failures"];
    if (part.startsWith("Signs of tiring")) return ["tiring"];
    return [];
  });
}

export type PointOutcome = "success" | "failure" | null;

/** One point of the adaptation chart: after trial `trialNo`, each component's d and the level. */
export interface AdaptationPoint {
  trialNo: number;
  level: number;
  spatial?: number;
  activation?: number;
  speed?: number;
  precision?: number;
  /** The outcome of the trial the decision came after; null at the start or for a stopped one. */
  outcome: PointOutcome;
  overrides: OverrideKind[];
}

export function adaptationPoints(logs: readonly AdaptationLogRow[]): AdaptationPoint[] {
  return [...logs]
    .sort((a, b) => a.trial_no - b.trial_no)
    .map((log) => {
      const d = log.state_after.d ?? {};
      const outcome = log.trial?.outcome;
      const point: AdaptationPoint = {
        trialNo: log.trial_no,
        level: log.level,
        outcome:
          outcome === undefined || outcome === "aborted"
            ? null
            : outcome === "success"
              ? "success"
              : "failure",
        overrides: overrideKinds(log.safety_override),
      };
      for (const component of COMPONENTS) {
        if (typeof d[component] === "number") point[component] = d[component];
      }
      return point;
    });
}

/** The components a run's decisions used, in drawing order. */
export function componentsIn(logs: readonly AdaptationLogRow[]): Component[] {
  const found = new Set(logs.flatMap((log) => Object.keys(log.state_after.d ?? {})));
  return COMPONENTS.filter((component) => found.has(component));
}
