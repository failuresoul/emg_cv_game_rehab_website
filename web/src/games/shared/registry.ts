import { Hand } from "lucide-react";

import { balloonPop } from "@/games/balloonPop";
import { bloom } from "@/games/bloom";
import { fingerPiano } from "@/games/fingerPiano";
import { paintWall } from "@/games/paintWall";
import { pathTrace } from "@/games/pathTrace";
import { pickPlace } from "@/games/pickPlace";
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
  bloom,
  finger_piano: fingerPiano,
  path_trace: pathTrace,
  paint_wall: paintWall,
  pick_place: pickPlace,
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
