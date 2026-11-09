import { Apple } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { createFruitCatchGame } from "./fruitCatchGame";
import { FRUIT_CATCH_PARAMS, FRUIT_CATCH_TRIALS } from "./params";

export const fruitCatch: GameDefinition = {
  id: "fruit_catch",
  nameKey: "game.fruit_catch.name",
  descriptionKey: "game.fruit_catch.description",
  movementKey: "game.fruit_catch.movement",
  icon: Apple,
  params: FRUIT_CATCH_PARAMS,
  trialsDefault: FRUIT_CATCH_TRIALS,
  estimatedMinutes: 4,
  create: createFruitCatchGame,
  implemented: true,
};
