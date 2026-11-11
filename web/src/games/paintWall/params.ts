import type { GameParams, ParamSpec } from "@/games/shared/types";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import { DEFAULT_ELBOW_RANGE, type ElbowRange, elbowRangeFromWarmup } from "./elbowRange";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step" | "component">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
  component: "fixed",
});

export const PAINT_WALL_PARAMS: readonly ParamSpec[] = [
  {
    name: "required_range_frac",
    component: "spatial",
    labelKey: "param.requiredRangeFrac",
    min: 0.5,
    max: 1.0,
    step: 0.05,
    default: 0.75,
    unit: "share",
    harder: "higher",
  },
  {
    name: "sweeps_needed",
    component: "activation",
    labelKey: "param.sweepsNeeded",
    min: 2,
    max: 5,
    step: 1,
    default: 3,
    unit: "count",
    harder: "higher",
  },
  {
    name: "time_limit_ms",
    component: "speed",
    labelKey: "param.timeLimitMs",
    min: 15000,
    max: 40000,
    step: 1000,
    default: 30000,
    unit: "ms",
    harder: "lower",
  },
  // The patient's own elbow range, from the warm-up (personalDefaults). Not a difficulty: it is
  // what the wall's bottom and top mean, so it is saved with every stripe.
  {
    name: "elbow_bent_deg",
    component: "fixed",
    labelKey: "param.elbowBentDeg",
    min: 20,
    max: 150,
    step: 1,
    default: DEFAULT_ELBOW_RANGE.bentDeg,
    unit: "deg",
    harder: null,
  },
  {
    name: "elbow_straight_deg",
    component: "fixed",
    labelKey: "param.elbowStraightDeg",
    min: 50,
    max: 180,
    step: 1,
    default: DEFAULT_ELBOW_RANGE.straightDeg,
    unit: "deg",
    harder: null,
  },
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 2000, unit: "ms", harder: null }),
];

/** One trial is one stripe of the wall. */
export const PAINT_WALL_TRIALS = 8;

export interface PaintWallParams {
  requiredRangeFrac: number;
  sweepsNeeded: number;
  timeLimitMs: number;
  range: ElbowRange;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  PAINT_WALL_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one stripe's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): PaintWallParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const bentDeg = value("elbow_bent_deg");
  // A range the wrong way round, or too narrow to paint with, falls back to the defaults.
  const range =
    value("elbow_straight_deg") - bentDeg >= 10
      ? { bentDeg, straightDeg: value("elbow_straight_deg") }
      : { ...DEFAULT_ELBOW_RANGE };
  return {
    requiredRangeFrac: Math.min(1, Math.max(0.3, value("required_range_frac"))),
    sweepsNeeded: Math.max(1, Math.round(value("sweeps_needed"))),
    timeLimitMs: value("time_limit_ms"),
    range,
    restMs: value("rest_ms"),
  };
}

type ElbowWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

/** Starting settings from the patient's latest elbow flexion warm-up: their own elbow range. */
export function paintWallDefaults(results: readonly ElbowWarmupResult[]): GameParams {
  const range = elbowRangeFromWarmup(results);
  if (range.origin === "default") return {};
  return {
    elbow_bent_deg: Math.round(range.bentDeg * 10) / 10,
    elbow_straight_deg: Math.round(range.straightDeg * 10) / 10,
  };
}
