import {
  keepOnScreen,
  reachInDirection,
  type ScreenBounds,
  sectorName,
  type Transform,
} from "@/games/shared/targetPlacement";
import type { Point } from "@/vision/geometry";

/** How far the balloon sways sideways while it waits, in SW, and how long one sway takes. */
export const SWAY_SW = 0.04;
export const SWAY_PERIOD_MS = 3000;

export interface BalloonPlacement {
  /** Where the balloon waits, in the body frame. */
  centreSw: Point;
  /** Where it starts: just below the bottom of the screen, under its target. */
  startSw: Point;
  radiusSw: number;
  directionDeg: number;
  directionIndex: number;
  heightFrac: number;
  reachSw: number;
  sector: string;
  clamped: boolean;
}

export interface PlaceBalloonInput {
  directionDeg: number;
  directionIndex: number;
  heightFrac: number;
  radiusSw: number;
  reachRadiiSw: readonly number[] | null;
  transform: Transform;
  bounds: ScreenBounds;
}

/**
 * The balloon waits at heightFrac of the calibrated reach in its upward direction (interpolated
 * between calibrated directions), kept fully on screen. It rises from just below the screen.
 */
export function placeBalloon(input: PlaceBalloonInput): BalloonPlacement {
  const { directionDeg, directionIndex, heightFrac, radiusSw, transform, bounds } = input;
  const reachSw = reachInDirection(input.reachRadiiSw, directionDeg);
  const radians = (directionDeg * Math.PI) / 180;
  const distance = heightFrac * reachSw;
  const ideal = { x: distance * Math.cos(radians), y: distance * Math.sin(radians) };
  const { centreSw, clamped } = keepOnScreen(ideal, radiusSw, transform, bounds);
  const centrePx = transform.toScreen(centreSw);
  const radiusPx = radiusSw * transform.pixelsPerSw;
  // Below the bottom edge, with the string out of sight as well.
  const startSw = transform.toBody({ x: centrePx.x, y: bounds.height + radiusPx * 2.5 });
  return {
    centreSw,
    startSw,
    radiusSw,
    directionDeg,
    directionIndex,
    heightFrac,
    reachSw,
    sector: sectorName(directionIndex, heightFrac),
    clamped,
  };
}

const easeOut = (share: number) => 1 - (1 - share) ** 3;
const easeIn = (share: number) => share ** 2;

/**
 * Where the balloon is drawn, given how far it has risen (0–1), how long it has been waiting, and
 * how far it has floated away (0–1). The sway starts gently as it arrives.
 */
export function balloonPosition(
  placement: Pick<BalloonPlacement, "centreSw" | "startSw">,
  rise: number,
  waitedMs: number,
  floatAway = 0,
  floatHeightSw = 3,
): Point {
  const { centreSw, startSw } = placement;
  const up = easeOut(Math.min(1, Math.max(0, rise)));
  const sway = SWAY_SW * Math.sin((2 * Math.PI * Math.max(0, waitedMs)) / SWAY_PERIOD_MS);
  return {
    x: startSw.x + (centreSw.x - startSw.x) * up + sway,
    y: startSw.y + (centreSw.y - startSw.y) * up + easeIn(Math.max(0, floatAway)) * floatHeightSw,
  };
}
