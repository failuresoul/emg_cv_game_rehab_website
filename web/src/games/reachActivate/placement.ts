import { DEFAULT_REACH_SW } from "@/games/shared/playArea";
import type { Point } from "@/vision/geometry";

/** The calibration's eight directions are 45 degrees apart, starting outward (+x). */
const DIRECTION_STEP_DEG = 45;
const DIRECTION_COUNT = 8;
/** Ring boundaries by distance fraction: R1 below 0.55, R2 up to 0.85, R3 beyond. */
const RING_2_FROM = 0.55;
const RING_3_ABOVE = 0.85;

/** Screen space the target must stay clear of, in pixels: the top bar, and room at the edges. */
export interface ScreenBounds {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Transform {
  toScreen(pointSw: Point): Point;
  toBody(pointPx: Point): Point;
  pixelsPerSw: number;
}

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

/**
 * The calibrated reach in any direction, interpolated linearly between the two nearest of the
 * eight measured directions. Uses the default reach when there is no calibration.
 */
export function reachInDirection(radii: readonly number[] | null, directionDeg: number): number {
  if (!radii || radii.length !== DIRECTION_COUNT || !radii.every((r) => r > 0)) {
    return DEFAULT_REACH_SW;
  }
  const deg = ((directionDeg % 360) + 360) % 360;
  const lower = Math.floor(deg / DIRECTION_STEP_DEG) % DIRECTION_COUNT;
  const upper = (lower + 1) % DIRECTION_COUNT;
  const share = (deg - lower * DIRECTION_STEP_DEG) / DIRECTION_STEP_DEG;
  return radii[lower] + (radii[upper] - radii[lower]) * share;
}

export function ringFor(distanceFrac: number): 1 | 2 | 3 {
  if (distanceFrac < RING_2_FROM) return 1;
  return distanceFrac <= RING_3_ABOVE ? 2 : 3;
}

/** For example "D3R2": direction index 3 (135 degrees), middle ring. */
export function sectorName(directionIndex: number, distanceFrac: number): string {
  return `D${directionIndex}R${ringFor(distanceFrac)}`;
}

/** Moves a target, if needed, so all of it lies inside the bounds. */
export function keepOnScreen(
  centreSw: Point,
  radiusSw: number,
  transform: Transform,
  bounds: ScreenBounds,
): { centreSw: Point; clamped: boolean } {
  const radiusPx = radiusSw * transform.pixelsPerSw;
  const centre = transform.toScreen(centreSw);
  const clamp = (value: number, min: number, max: number) =>
    // A target too big to fit is centred in the space there is.
    min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));
  const x = clamp(centre.x, bounds.left + radiusPx, bounds.width - bounds.right - radiusPx);
  const y = clamp(centre.y, bounds.top + radiusPx, bounds.height - bounds.bottom - radiusPx);
  if (x === centre.x && y === centre.y) return { centreSw, clamped: false };
  return { centreSw: transform.toBody({ x, y }), clamped: true };
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
