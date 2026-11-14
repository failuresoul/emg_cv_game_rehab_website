import { Target } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { REACH_ACTIVATE_PARAMS, REACH_ACTIVATE_TRIALS } from "./params";

export const reachActivate: GameDefinition = {
  id: "reach_activate",
  nameKey: "game.reach_activate.name",
  descriptionKey: "game.reach_activate.description",
  movementKey: "game.reach_activate.movement",
  icon: Target,
  params: REACH_ACTIVATE_PARAMS,
  trialsDefault: REACH_ACTIVATE_TRIALS,
  estimatedMinutes: 4,
  load: () => import("./reachActivateGame").then((module) => module.createReachActivateGame),
  implemented: true,
  // The squeeze follows the flexors when the muscle sensor is calibrated there.
  emgSignal: "grip",
};
