import { Hand } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { createGripHoldGame } from "./gripHoldGame";
import { GRIP_HOLD_PARAMS, GRIP_HOLD_TRIALS } from "./params";

export const gripHold: GameDefinition = {
  id: "grip_hold",
  nameKey: "game.grip_hold.name",
  descriptionKey: "game.grip_hold.description",
  movementKey: "game.grip_hold.movement",
  icon: Hand,
  params: GRIP_HOLD_PARAMS,
  trialsDefault: GRIP_HOLD_TRIALS,
  estimatedMinutes: 4,
  create: createGripHoldGame,
  implemented: true,
  // No reaching: the hand only has to be visible, and only the trunk is checked.
  compensationExercise: "hand_open_close",
  // The kite's height is the grip level, so the shell's cursor and squeeze meter are not needed.
  showCursor: false,
  showGripMeter: false,
};
