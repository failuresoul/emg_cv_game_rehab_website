import { Spline } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { PATH_TRACE_PARAMS, PATH_TRACE_TRIALS } from "./params";
import { createPathTraceGame } from "./pathTraceGame";

export const pathTrace: GameDefinition = {
  id: "path_trace",
  nameKey: "game.path_trace.name",
  descriptionKey: "game.path_trace.description",
  movementKey: "game.path_trace.movement",
  icon: Spline,
  params: PATH_TRACE_PARAMS,
  trialsDefault: PATH_TRACE_TRIALS,
  estimatedMinutes: 4,
  create: createPathTraceGame,
  implemented: true,
};
