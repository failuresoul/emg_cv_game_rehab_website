import { Flower2, Grab, Hand, Paintbrush, Piano, Spline } from "lucide-react";

import { balloonPop } from "@/games/balloonPop";
import { fruitCatch } from "@/games/fruitCatch";
import { reachActivate } from "@/games/reachActivate";
import type { GameId } from "@/types/api";

import type { GameContext, GameDefinition, GameInstance, ParamSpec } from "./types";

export const GAME_IDS: readonly GameId[] = [
  "reach_activate",
  "balloon_pop",
  "fruit_catch",
  "bloom",
  "finger_piano",
  "path_trace",
  "paint_wall",
  "pick_place",
  "grip_hold",
];

// Settings shared by several games, so each has one name and one label everywhere.
const demand: ParamSpec = {
  name: "demand",
  labelKey: "param.demand",
  min: 0.2,
  max: 0.9,
  step: 0.05,
  default: 0.5,
  unit: "level",
  harder: "higher",
};
const holdMs: ParamSpec = {
  name: "hold_ms",
  labelKey: "param.holdMs",
  min: 100,
  max: 3000,
  step: 50,
  default: 400,
  unit: "ms",
  harder: "higher",
};
const distanceFrac: ParamSpec = {
  name: "distance_frac",
  labelKey: "param.distanceFrac",
  min: 0.3,
  max: 1.0,
  step: 0.05,
  default: 0.7,
  unit: "share",
  harder: "higher",
};
const targetRadiusSw: ParamSpec = {
  name: "target_radius_sw",
  labelKey: "param.targetRadiusSw",
  min: 0.12,
  max: 0.4,
  step: 0.01,
  default: 0.25,
  unit: "sw",
  harder: "lower",
};
const reachTimeoutMs: ParamSpec = {
  name: "reach_timeout_ms",
  labelKey: "param.reachTimeoutMs",
  min: 3000,
  max: 15000,
  step: 500,
  default: 8000,
  unit: "ms",
  harder: "lower",
};
const restMs: ParamSpec = {
  name: "rest_ms",
  labelKey: "param.restMs",
  min: 1000,
  max: 8000,
  step: 500,
  default: 3000,
  unit: "ms",
  harder: "lower",
};

function notImplemented(id: GameId): (context: GameContext) => GameInstance {
  return () => {
    throw new Error(`The game "${id}" is not built yet`);
  };
}

export const GAMES: Readonly<Record<GameId, GameDefinition>> = {
  reach_activate: reachActivate,
  balloon_pop: balloonPop,
  fruit_catch: fruitCatch,
  bloom: {
    id: "bloom",
    nameKey: "game.bloom.name",
    descriptionKey: "game.bloom.description",
    movementKey: "game.bloom.movement",
    icon: Flower2,
    params: [demand, { ...holdMs, default: 1500 }, restMs],
    trialsDefault: 10,
    estimatedMinutes: 4,
    create: notImplemented("bloom"),
    implemented: false,
  },
  finger_piano: {
    id: "finger_piano",
    nameKey: "game.finger_piano.name",
    descriptionKey: "game.finger_piano.description",
    movementKey: "game.finger_piano.movement",
    icon: Piano,
    params: [
      {
        name: "finger_count",
        labelKey: "param.fingerCount",
        min: 2,
        max: 4,
        step: 1,
        default: 2,
        unit: "count",
        harder: "higher",
      },
      {
        name: "tempo_bpm",
        labelKey: "param.tempoBpm",
        min: 20,
        max: 60,
        step: 5,
        default: 30,
        unit: "bpm",
        harder: "higher",
      },
      {
        name: "touch_threshold",
        labelKey: "param.touchThreshold",
        min: 0.2,
        max: 0.5,
        step: 0.02,
        default: 0.35,
        unit: "share",
        harder: "lower",
      },
    ],
    trialsDefault: 16,
    estimatedMinutes: 5,
    create: notImplemented("finger_piano"),
    implemented: false,
  },
  path_trace: {
    id: "path_trace",
    nameKey: "game.path_trace.name",
    descriptionKey: "game.path_trace.description",
    movementKey: "game.path_trace.movement",
    icon: Spline,
    params: [
      {
        name: "path_width_sw",
        labelKey: "param.pathWidthSw",
        min: 0.1,
        max: 0.5,
        step: 0.02,
        default: 0.3,
        unit: "sw",
        harder: "lower",
      },
      distanceFrac,
      { ...reachTimeoutMs, name: "time_limit_ms", labelKey: "param.timeLimitMs", default: 12000 },
    ],
    trialsDefault: 8,
    estimatedMinutes: 5,
    create: notImplemented("path_trace"),
    implemented: false,
  },
  paint_wall: {
    id: "paint_wall",
    nameKey: "game.paint_wall.name",
    descriptionKey: "game.paint_wall.description",
    movementKey: "game.paint_wall.movement",
    icon: Paintbrush,
    params: [
      {
        name: "brush_radius_sw",
        labelKey: "param.brushRadiusSw",
        min: 0.08,
        max: 0.3,
        step: 0.01,
        default: 0.18,
        unit: "sw",
        harder: "lower",
      },
      {
        name: "coverage_goal",
        labelKey: "param.coverageGoal",
        min: 0.4,
        max: 0.95,
        step: 0.05,
        default: 0.7,
        unit: "share",
        harder: "higher",
      },
      {
        ...reachTimeoutMs,
        name: "time_limit_ms",
        labelKey: "param.timeLimitMs",
        min: 20000,
        max: 90000,
        step: 5000,
        default: 45000,
      },
    ],
    trialsDefault: 3,
    estimatedMinutes: 4,
    create: notImplemented("paint_wall"),
    implemented: false,
  },
  pick_place: {
    id: "pick_place",
    nameKey: "game.pick_place.name",
    descriptionKey: "game.pick_place.description",
    movementKey: "game.pick_place.movement",
    icon: Grab,
    params: [
      distanceFrac,
      { ...targetRadiusSw, name: "object_radius_sw", labelKey: "param.objectRadiusSw" },
      { ...targetRadiusSw, name: "place_radius_sw", labelKey: "param.placeRadiusSw", default: 0.3 },
      demand,
      reachTimeoutMs,
    ],
    trialsDefault: 12,
    estimatedMinutes: 6,
    create: notImplemented("pick_place"),
    implemented: false,
  },
  grip_hold: {
    id: "grip_hold",
    nameKey: "game.grip_hold.name",
    descriptionKey: "game.grip_hold.description",
    movementKey: "game.grip_hold.movement",
    icon: Hand,
    params: [demand, { ...holdMs, default: 2000, max: 10000, step: 250 }, restMs],
    trialsDefault: 8,
    estimatedMinutes: 4,
    create: notImplemented("grip_hold"),
    implemented: false,
  },
};

export function isGameId(value: string | undefined): value is GameId {
  return value !== undefined && (GAME_IDS as readonly string[]).includes(value);
}

/** Every setting at its default. */
export function defaultParams(specs: readonly ParamSpec[]): Record<string, number> {
  return Object.fromEntries(specs.map((spec) => [spec.name, spec.default]));
}
