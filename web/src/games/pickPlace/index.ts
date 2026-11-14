import { Grab } from "lucide-react";

import type { GameDefinition } from "@/games/shared/types";

import { PICK_PLACE_PARAMS, PICK_PLACE_TRIALS } from "./params";

export const pickPlace: GameDefinition = {
  id: "pick_place",
  nameKey: "game.pick_place.name",
  descriptionKey: "game.pick_place.description",
  movementKey: "game.pick_place.movement",
  icon: Grab,
  params: PICK_PLACE_PARAMS,
  trialsDefault: PICK_PLACE_TRIALS,
  estimatedMinutes: 4,
  load: () => import("./pickPlaceGame").then((module) => module.createPickPlaceGame),
  implemented: true,
  // The game draws its own hand, open or closed with the pinch.
  showCursor: false,
  showGripMeter: false,
};
