import type { GameParams, ParamSpec } from "@/games/shared/types";

/**
 * Which way the object is carried: from the pick place to the box, outward (away from the body),
 * inward (across towards it), up or down. A setting is a number, so this is its place in the list.
 */
export const CARRY_DIRECTIONS = ["outward", "inward", "up", "down"] as const;
export type CarryDirection = (typeof CARRY_DIRECTIONS)[number];

export const PICK_PLACE_PARAMS: readonly ParamSpec[] = [
  {
    name: "object_radius_sw",
    component: "precision",
    labelKey: "param.objectRadiusSw",
    min: 0.2,
    max: 0.5,
    step: 0.01,
    default: 0.35,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "pick_distance_frac",
    component: "spatial",
    labelKey: "param.pickDistanceFrac",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    default: 0.6,
    unit: "share",
    harder: "higher",
  },
  {
    name: "place_distance_frac",
    component: "spatial",
    labelKey: "param.placeDistanceFrac",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    default: 0.7,
    unit: "share",
    harder: "higher",
  },
  {
    name: "box_size_sw",
    component: "precision",
    labelKey: "param.boxSizeSw",
    min: 0.4,
    max: 0.9,
    step: 0.05,
    default: 0.7,
    unit: "sw",
    harder: "lower",
  },
  {
    name: "carry_angle_deg",
    component: "spatial",
    labelKey: "param.carryAngleDeg",
    min: 45,
    max: 180,
    step: 15,
    default: 90,
    unit: "deg",
    harder: "higher",
  },
  {
    name: "time_limit_ms",
    component: "speed",
    labelKey: "param.timeLimitMs",
    min: 8000,
    max: 20000,
    step: 500,
    default: 15000,
    unit: "ms",
    harder: "lower",
  },
  // The carry's direction, as its place in CARRY_DIRECTIONS. The provider chooses it.
  {
    name: "carry_direction",
    component: "fixed",
    labelKey: "param.carryDirection",
    min: 0,
    max: CARRY_DIRECTIONS.length - 1,
    step: 1,
    default: 0,
    unit: "count",
    harder: null,
  },
  {
    name: "rest_ms",
    component: "fixed",
    labelKey: "param.restMs",
    min: 1500,
    max: 1500,
    step: 0,
    default: 1500,
    unit: "ms",
    harder: null,
  },
];

export const PICK_PLACE_TRIALS = 12;

export interface PickPlaceParams {
  objectRadiusSw: number;
  pickDistanceFrac: number;
  placeDistanceFrac: number;
  boxSizeSw: number;
  carryAngleDeg: number;
  timeLimitMs: number;
  carry: CarryDirection;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  PICK_PLACE_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): PickPlaceParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const count = CARRY_DIRECTIONS.length;
  const index = Math.round(value("carry_direction"));
  return {
    objectRadiusSw: Math.max(0.01, value("object_radius_sw")),
    pickDistanceFrac: value("pick_distance_frac"),
    placeDistanceFrac: value("place_distance_frac"),
    boxSizeSw: Math.max(0.01, value("box_size_sw")),
    carryAngleDeg: Math.min(180, Math.max(0, value("carry_angle_deg"))),
    timeLimitMs: Math.max(1000, value("time_limit_ms")),
    carry: CARRY_DIRECTIONS[((index % count) + count) % count],
    restMs: value("rest_ms"),
  };
}
