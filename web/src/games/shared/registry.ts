import { balloonPop } from "@/games/balloonPop";
import { bloom } from "@/games/bloom";
import { fingerPiano } from "@/games/fingerPiano";
import { gripHold } from "@/games/gripHold";
import { paintWall } from "@/games/paintWall";
import { pathTrace } from "@/games/pathTrace";
import { pickPlace } from "@/games/pickPlace";
import { fruitCatch } from "@/games/fruitCatch";
import { reachActivate } from "@/games/reachActivate";
import type { GameId } from "@/types/api";

import type { GameDefinition, ParamSpec } from "./types";

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

export const GAMES: Readonly<Record<GameId, GameDefinition>> = {
  reach_activate: reachActivate,
  balloon_pop: balloonPop,
  fruit_catch: fruitCatch,
  bloom,
  finger_piano: fingerPiano,
  path_trace: pathTrace,
  paint_wall: paintWall,
  pick_place: pickPlace,
  grip_hold: gripHold,
};

export function isGameId(value: string | undefined): value is GameId {
  return value !== undefined && (GAME_IDS as readonly string[]).includes(value);
}

/** Every setting at its default. */
export function defaultParams(specs: readonly ParamSpec[]): Record<string, number> {
  return Object.fromEntries(specs.map((spec) => [spec.name, spec.default]));
}
