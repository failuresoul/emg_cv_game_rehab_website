import { Flower2 } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { createBloomGame } from "./bloomGame";
import { BLOOM_PARAMS, BLOOM_TRIALS } from "./params";

export const bloom: GameDefinition = {
  id: "bloom",
  nameKey: "game.bloom.name",
  descriptionKey: "game.bloom.description",
  movementKey: "game.bloom.movement",
  icon: Flower2,
  params: BLOOM_PARAMS,
  trialsDefault: BLOOM_TRIALS,
  estimatedMinutes: 4,
  create: createBloomGame,
  implemented: true,
  // No reaching: the hand only has to be visible, and only the trunk is checked.
  compensationExercise: "hand_open_close",
  showCursor: false,
  showGripMeter: false,
};
