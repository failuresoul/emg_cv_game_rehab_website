import type { GameParams, ParamSpec } from "@/games/shared/types";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
});

/** How a balloon is popped. Settings are numbers, so `squeeze_to_pop` holds it as 0 or 1. */
export type PopMode = "touch" | "touch_squeeze";

export const BALLOON_POP_PARAMS: readonly ParamSpec[] = [
  {
    name: "height_frac",
    labelKey: "param.heightFrac",
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
    min: 45,
    max: 135,
    step: 45,
    default: 90,
    unit: "deg",
    harder: null,
  },
  {
    name: "balloon_radius_sw",
    labelKey: "param.balloonRadiusSw",
    min: 0.3,
    max: 0.6,
    step: 0.01,
    default: 0.45,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "rise_ms",
    labelKey: "param.riseMs",
    min: 1500,
    max: 4000,
    step: 250,
    default: 2500,
    unit: "ms",
    harder: null,
  },
  {
    name: "hover_ms",
    labelKey: "param.hoverMs",
    min: 4000,
    max: 10000,
    step: 500,
    default: 7000,
    unit: "ms",
    harder: "lower",
  },
  {
    name: "squeeze_to_pop",
    labelKey: "param.squeezeToPop",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    unit: "count",
    harder: "higher",
  },
  // Used only when a squeeze is needed; the same as Reach and squeeze.
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
  fixed({
    name: "activation_window_ms",
    labelKey: "param.activationWindowMs",
    default: 3000,
    unit: "ms",
    harder: "lower",
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 1200, unit: "ms", harder: null }),
];

export const BALLOON_POP_TRIALS = 20;

export interface BalloonPopParams {
  heightFrac: number;
  directionDeg: number;
  /** Which of the eight calibrated directions: 1, 2 or 3 for 45, 90 and 135 degrees. */
  directionIndex: number;
  balloonRadiusSw: number;
  riseMs: number;
  hoverMs: number;
  popMode: PopMode;
  activationDemand: number;
  activationHoldMs: number;
  activationWindowMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  BALLOON_POP_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): BalloonPopParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const directionDeg = ((value("direction_deg") % 360) + 360) % 360;
  return {
    heightFrac: value("height_frac"),
    directionDeg,
    directionIndex: Number.isFinite(params.direction_index)
      ? params.direction_index
      : Math.round(directionDeg / 45) % 8,
    balloonRadiusSw: value("balloon_radius_sw"),
    riseMs: value("rise_ms"),
    hoverMs: value("hover_ms"),
    popMode: value("squeeze_to_pop") >= 1 ? "touch_squeeze" : "touch",
    activationDemand: value("activation_demand"),
    activationHoldMs: value("activation_hold_ms"),
    activationWindowMs: value("activation_window_ms"),
    restMs: value("rest_ms"),
  };
}
