import { Target } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { REACH_ACTIVATE_PARAMS, REACH_ACTIVATE_TRIALS } from "./params";
import { createReachActivateGame } from "./reachActivateGame";

export const reachActivate: GameDefinition = {
  id: "reach_activate",
  nameKey: "game.reach_activate.name",
  descriptionKey: "game.reach_activate.description",
  movementKey: "game.reach_activate.movement",
  icon: Target,
  params: REACH_ACTIVATE_PARAMS,
  trialsDefault: REACH_ACTIVATE_TRIALS,
  estimatedMinutes: 5,
  create: createReachActivateGame,
  implemented: true,
};
