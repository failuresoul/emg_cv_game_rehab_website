import type { GameParams, ParamSpec } from "@/games/shared/types";

export const FRUIT_CATCH_PARAMS: readonly ParamSpec[] = [
  {
    name: "fall_speed_sw_s",
    labelKey: "param.fallSpeedSwS",
    min: 0.2,
    max: 0.8,
    step: 0.05,
    default: 0.35,
    unit: "sw_per_s",
    harder: "higher",
  },
  {
    name: "spread_frac",
    labelKey: "param.spreadFrac",
    min: 0.3,
    max: 1.0,
    step: 0.05,
    default: 0.7,
    unit: "share",
    harder: "higher",
  },
  {
    name: "basket_width_sw",
    labelKey: "param.basketWidthSw",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    default: 0.7,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "spawn_interval_ms",
    labelKey: "param.spawnIntervalMs",
    min: 2500,
    max: 6000,
    step: 250,
    default: 4000,
    unit: "ms",
    harder: "lower",
  },
  {
    name: "max_on_screen",
    labelKey: "param.maxOnScreen",
    min: 1,
    max: 2,
    step: 1,
    default: 1,
    unit: "count",
    harder: "higher",
  },
  // Where each fruit falls; the provider chooses them.
  {
    name: "target_side",
    labelKey: "param.targetSide",
    min: -1,
    max: 1,
    step: 2,
    default: 1,
    unit: "count",
    harder: null,
  },
  {
    name: "target_frac",
    labelKey: "param.targetFrac",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    default: 0.7,
    unit: "share",
    harder: "higher",
  },
];

export const FRUIT_CATCH_TRIALS = 20;

export type Side = "out" | "across";

export interface FruitCatchParams {
  fallSpeedSwS: number;
  spreadFrac: number;
  basketWidthSw: number;
  spawnIntervalMs: number;
  maxOnScreen: number;
  side: Side;
  /** How far towards the end of the spread on its side, 0–1. */
  targetFrac: number;
}

const DEFAULTS = Object.fromEntries(
  FRUIT_CATCH_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one fruit's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): FruitCatchParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  return {
    fallSpeedSwS: value("fall_speed_sw_s"),
    spreadFrac: value("spread_frac"),
    basketWidthSw: value("basket_width_sw"),
    spawnIntervalMs: value("spawn_interval_ms"),
    maxOnScreen: Math.max(1, Math.round(value("max_on_screen"))),
    side: value("target_side") < 0 ? "across" : "out",
    targetFrac: value("target_frac"),
  };
}
