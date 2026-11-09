import type { GameParams, ParamSpec } from "@/games/shared/types";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
});

export const REACH_ACTIVATE_PARAMS: readonly ParamSpec[] = [
  {
    name: "distance_frac",
    labelKey: "param.distanceFrac",
    min: 0.4,
    max: 1.1,
    step: 0.05,
    default: 0.7,
    unit: "share",
    harder: "higher",
  },
  {
    name: "direction_deg",
    labelKey: "param.directionDeg",
    min: 0,
    max: 315,
    step: 45,
    default: 0,
    unit: "deg",
    harder: null,
  },
  {
    name: "target_radius_sw",
    labelKey: "param.targetRadiusSw",
    min: 0.25,
    max: 0.6,
    step: 0.01,
    default: 0.45,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "dwell_ms",
    labelKey: "param.dwellMs",
    min: 300,
    max: 1000,
    step: 50,
    default: 500,
    unit: "ms",
    harder: "higher",
  },
  {
    name: "activation_demand",
    labelKey: "param.activationDemand",
    min: 0.2,
    max: 0.9,
    step: 0.05,
    default: 0.5,
    unit: "level",
    harder: "higher",
  },
  fixed({
    name: "activation_hold_ms",
    labelKey: "param.activationHoldMs",
    default: 200,
    unit: "ms",
    harder: "higher",
  }),
  {
    name: "activation_window_ms",
    labelKey: "param.activationWindowMs",
    min: 1500,
    max: 4000,
    step: 250,
    default: 3000,
    unit: "ms",
    harder: "lower",
  },
  fixed({
    name: "reach_time_limit_ms",
    labelKey: "param.reachTimeLimitMs",
    default: 8000,
    unit: "ms",
    harder: "lower",
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 1500, unit: "ms", harder: null }),
];

export const REACH_ACTIVATE_TRIALS = 20;

export interface ReachActivateParams {
  distanceFrac: number;
  directionDeg: number;
  /** Which of the eight calibrated directions, 0 to 7, when the provider gives it. */
  directionIndex: number;
  targetRadiusSw: number;
  dwellMs: number;
  activationDemand: number;
  activationHoldMs: number;
  activationWindowMs: number;
  reachTimeLimitMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  REACH_ACTIVATE_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): ReachActivateParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const directionDeg = ((value("direction_deg") % 360) + 360) % 360;
  return {
    distanceFrac: value("distance_frac"),
    directionDeg,
    directionIndex: Number.isFinite(params.direction_index)
      ? params.direction_index
      : Math.round(directionDeg / 45) % 8,
    targetRadiusSw: value("target_radius_sw"),
    dwellMs: value("dwell_ms"),
    activationDemand: value("activation_demand"),
    activationHoldMs: value("activation_hold_ms"),
    activationWindowMs: value("activation_window_ms"),
    reachTimeLimitMs: value("reach_time_limit_ms"),
    restMs: value("rest_ms"),
  };
}
