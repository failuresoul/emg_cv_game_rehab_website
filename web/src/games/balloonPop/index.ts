import { PartyPopper } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { createBalloonPopGame } from "./balloonPopGame";
import { BALLOON_POP_PARAMS, BALLOON_POP_TRIALS } from "./params";

export const balloonPop: GameDefinition = {
  id: "balloon_pop",
  nameKey: "game.balloon_pop.name",
  descriptionKey: "game.balloon_pop.description",
  movementKey: "game.balloon_pop.movement",
  icon: PartyPopper,
  params: BALLOON_POP_PARAMS,
  trialsDefault: BALLOON_POP_TRIALS,
  estimatedMinutes: 4,
  create: createBalloonPopGame,
  implemented: true,
};
