import { Piano } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { FINGER_PIANO_PARAMS, FINGER_PIANO_TRIALS, fingerPianoDefaults } from "./params";

export const fingerPiano: GameDefinition = {
  id: "finger_piano",
  nameKey: "game.finger_piano.name",
  descriptionKey: "game.finger_piano.description",
  movementKey: "game.finger_piano.movement",
  icon: Piano,
  params: FINGER_PIANO_PARAMS,
  trialsDefault: FINGER_PIANO_TRIALS,
  estimatedMinutes: 4,
  load: () => import("./fingerPianoGame").then((module) => module.createFingerPianoGame),
  implemented: true,
  // No reaching: the hand only has to be visible, and only the trunk is checked, as in the warm-up.
  compensationExercise: "thumb_opposition",
  showCursor: false,
  showGripMeter: false,
  personalDefaults: fingerPianoDefaults,
};
