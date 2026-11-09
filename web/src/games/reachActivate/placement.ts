import {
  keepOnScreen,
  reachInDirection,
  type ScreenBounds,
  sectorName,
  type Transform,
} from "@/games/shared/targetPlacement";
import type { Point } from "@/vision/geometry";

export {
  keepOnScreen,
  reachInDirection,
  ringFor,
  type ScreenBounds,
  sectorName,
  type Transform,
} from "@/games/shared/targetPlacement";

export interface TargetPlacement {
  centreSw: Point;
  radiusSw: number;
  directionDeg: number;
  directionIndex: number;
  distanceFrac: number;
  /** The calibrated (or default) reach in this direction, in SW. */
  reachSw: number;
  sector: string;
  /** True when the target was moved to keep it on screen. */
  clamped: boolean;
}

export interface PlaceTargetInput {
  directionDeg: number;
  directionIndex: number;
  distanceFrac: number;
  radiusSw: number;
  /** The calibration's reach radii for 0, 45 … 315 degrees, or null. */
  reachRadiiSw: readonly number[] | null;
  transform: Transform;
  bounds: ScreenBounds;
}

/** The target's centre: from the affected shoulder, distanceFrac of the reach in its direction. */
export function placeTarget(input: PlaceTargetInput): TargetPlacement {
  const { directionDeg, directionIndex, distanceFrac, radiusSw } = input;
  const reachSw = reachInDirection(input.reachRadiiSw, directionDeg);
  const radians = (directionDeg * Math.PI) / 180;
  const distance = distanceFrac * reachSw;
  const ideal = { x: distance * Math.cos(radians), y: distance * Math.sin(radians) };
  const { centreSw, clamped } = keepOnScreen(ideal, radiusSw, input.transform, input.bounds);
  return {
    centreSw,
    radiusSw,
    directionDeg,
    directionIndex,
    distanceFrac,
    reachSw,
    sector: sectorName(directionIndex, distanceFrac),
    clamped,
  };
}
