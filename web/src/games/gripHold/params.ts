import type { GameParams, ParamSpec } from "@/games/shared/types";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step" | "component">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
  component: "fixed",
});

export const GRIP_HOLD_PARAMS: readonly ParamSpec[] = [
  {
    name: "band_center",
    component: "activation",
    labelKey: "param.bandCenter",
    min: 0.3,
    max: 0.8,
    step: 0.05,
    default: 0.5,
    unit: "level",
    harder: "higher",
  },
  {
    name: "band_width",
    component: "precision",
    labelKey: "param.bandWidth",
    min: 0.1,
    max: 0.35,
    step: 0.05,
    default: 0.3,
    unit: "level",
    harder: "lower",
  },
  {
    name: "hold_ms",
    component: "activation",
    labelKey: "param.holdMs",
    min: 2000,
    max: 8000,
    step: 500,
    default: 3000,
    unit: "ms",
    harder: "higher",
  },
  {
    name: "time_limit_ms",
    component: "speed",
    labelKey: "param.timeLimitMs",
    min: 10000,
    max: 20000,
    step: 1000,
    default: 15000,
    unit: "ms",
    harder: "lower",
  },
  fixed({
    name: "relax_below",
    labelKey: "param.relaxBelow",
    default: 0.15,
    unit: "level",
    harder: "lower",
  }),
  fixed({
    name: "relax_within_ms",
    labelKey: "param.relaxWithinMs",
    default: 3000,
    unit: "ms",
    harder: "lower",
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 2000, unit: "ms", harder: null }),
];

export const GRIP_HOLD_TRIALS = 8;

export interface GripHoldParams {
  /** The band of grip levels to hold, from 0 to 1: its middle and its full width. */
  bandCenter: number;
  bandWidth: number;
  /** Time to spend inside the band, in total: it pauses, not restarts, outside the band. */
  holdMs: number;
  /** Time allowed for the hold. */
  timeLimitMs: number;
  /** After the hold, the level must fall below this within relaxWithinMs. */
  relaxBelow: number;
  relaxWithinMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  GRIP_HOLD_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): GripHoldParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  return {
    bandCenter: Math.min(1, Math.max(0, value("band_center"))),
    bandWidth: Math.min(1, Math.max(0.01, value("band_width"))),
    holdMs: Math.max(1, value("hold_ms")),
    timeLimitMs: Math.max(1, value("time_limit_ms")),
    relaxBelow: value("relax_below"),
    relaxWithinMs: Math.max(1, value("relax_within_ms")),
    restMs: value("rest_ms"),
  };
}

/** The band's lower and upper levels, kept within 0–1. */
export function bandLimits({
  bandCenter,
  bandWidth,
}: Pick<GripHoldParams, "bandCenter" | "bandWidth">): {
  low: number;
  high: number;
} {
  return {
    low: Math.max(0, bandCenter - bandWidth / 2),
    high: Math.min(1, bandCenter + bandWidth / 2),
  };
}
