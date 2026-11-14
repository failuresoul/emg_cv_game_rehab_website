import { Paintbrush } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { PAINT_WALL_PARAMS, PAINT_WALL_TRIALS, paintWallDefaults } from "./params";

export const paintWall: GameDefinition = {
  id: "paint_wall",
  nameKey: "game.paint_wall.name",
  descriptionKey: "game.paint_wall.description",
  movementKey: "game.paint_wall.movement",
  icon: Paintbrush,
  params: PAINT_WALL_PARAMS,
  trialsDefault: PAINT_WALL_TRIALS,
  estimatedMinutes: 4,
  load: () => import("./paintWallGame").then((module) => module.createPaintWallGame),
  implemented: true,
  // The elbow moves the brush: the fingertip cursor and the squeeze meter would only distract.
  compensationExercise: "elbow_flexion",
  showCursor: false,
  showGripMeter: false,
  personalDefaults: paintWallDefaults,
};
