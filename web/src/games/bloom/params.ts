import type { GameParams, ParamSpec } from "@/games/shared/types";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
});

export const BLOOM_PARAMS: readonly ParamSpec[] = [
  {
    name: "open_demand",
    labelKey: "param.openDemand",
    min: 0.5,
    max: 0.95,
    step: 0.05,
    default: 0.7,
    unit: "level",
    harder: "higher",
  },
  {
    name: "open_hold_ms",
    labelKey: "param.openHoldMs",
    min: 300,
    max: 2500,
    step: 100,
    default: 800,
    unit: "ms",
    harder: "higher",
  },
  {
    name: "close_demand",
    labelKey: "param.closeDemand",
    min: 0.4,
    max: 0.9,
    step: 0.05,
    default: 0.6,
    unit: "level",
    harder: "higher",
  },
  {
    name: "phase_time_limit_ms",
    labelKey: "param.phaseTimeLimitMs",
    min: 4000,
    max: 10000,
    step: 500,
    default: 8000,
    unit: "ms",
    harder: "lower",
  },
  fixed({
    name: "close_hold_ms",
    labelKey: "param.closeHoldMs",
    default: 300,
    unit: "ms",
    harder: "higher",
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 1500, unit: "ms", harder: null }),
];

export const BLOOM_TRIALS = 15;

export interface BloomParams {
  /** Openness to reach, from 0 to 1. */
  openDemand: number;
  /** How long the hand must stay that open. */
  openHoldMs: number;
  /** Grip level to reach to collect the seed, from 0 to 1. */
  closeDemand: number;
  closeHoldMs: number;
  /** Time allowed for each phase, opening and closing. */
  phaseTimeLimitMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  BLOOM_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): BloomParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  return {
    openDemand: value("open_demand"),
    openHoldMs: value("open_hold_ms"),
    closeDemand: value("close_demand"),
    closeHoldMs: value("close_hold_ms"),
    phaseTimeLimitMs: value("phase_time_limit_ms"),
    restMs: value("rest_ms"),
  };
}
