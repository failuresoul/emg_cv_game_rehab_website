import type { GameParams, ParamSpec } from "@/games/shared/types";
import { PATH_SHAPES, type PathShape } from "@/metrics/paths";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step" | "component">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
  component: "fixed",
});

export const PATH_TRACE_PARAMS: readonly ParamSpec[] = [
  // Settings are numbers: the shape is its place in PATH_SHAPES. The provider chooses it.
  {
    name: "shape_index",
    component: "fixed",
    labelKey: "param.shape",
    min: 0,
    max: PATH_SHAPES.length - 1,
    step: 1,
    default: 0,
    unit: "count",
    harder: null,
  },
  {
    name: "path_length_frac",
    component: "spatial",
    labelKey: "param.pathLengthFrac",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    default: 0.6,
    unit: "share",
    harder: "higher",
  },
  {
    name: "guide_speed_sw_s",
    component: "speed",
    labelKey: "param.guideSpeedSwS",
    min: 0.15,
    max: 0.6,
    step: 0.05,
    default: 0.25,
    unit: "sw_per_s",
    harder: "higher",
  },
  {
    name: "corridor_width_sw",
    component: "precision",
    labelKey: "param.corridorWidthSw",
    min: 0.2,
    max: 0.6,
    step: 0.05,
    default: 0.4,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "ring_frac",
    component: "spatial",
    labelKey: "param.ringFrac",
    min: 0.5,
    max: 0.9,
    step: 0.05,
    default: 0.7,
    unit: "share",
    harder: "higher",
  },
  // 1 outward (the path starts nearer the body), −1 inward. The provider alternates it.
  {
    name: "direction",
    component: "fixed",
    labelKey: "param.pathDirection",
    min: -1,
    max: 1,
    step: 2,
    default: 1,
    unit: "count",
    harder: null,
  },
  fixed({
    name: "start_hold_ms",
    labelKey: "param.startHoldMs",
    default: 500,
    unit: "ms",
    harder: "higher",
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 2000, unit: "ms", harder: null }),
];

export const PATH_TRACE_TRIALS = 10;

export interface PathTraceParams {
  shape: PathShape;
  pathLengthFrac: number;
  guideSpeedSwS: number;
  corridorWidthSw: number;
  ringFrac: number;
  /** True when the path runs away from the body. */
  outward: boolean;
  startHoldMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  PATH_TRACE_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): PathTraceParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const index = Math.round(value("shape_index"));
  return {
    shape: PATH_SHAPES[((index % PATH_SHAPES.length) + PATH_SHAPES.length) % PATH_SHAPES.length],
    pathLengthFrac: value("path_length_frac"),
    guideSpeedSwS: Math.max(0.01, value("guide_speed_sw_s")),
    corridorWidthSw: Math.max(0.01, value("corridor_width_sw")),
    ringFrac: value("ring_frac"),
    outward: value("direction") >= 0,
    startHoldMs: value("start_hold_ms"),
    restMs: value("rest_ms"),
  };
}
