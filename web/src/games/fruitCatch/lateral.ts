import { reachInDirection, ringFor } from "@/games/shared/targetPlacement";

import type { Side } from "./params";

/** The basket moves along this line, just below the shoulder, in SW. */
export const BASKET_LINE_Y_SW = -0.3;
/** Fruits are drawn with this radius, in SW. */
export const FRUIT_RADIUS_SW = 0.13;

/**
 * How far the hand can go sideways at about shoulder height, along x: from the calibrated reach
 * across the body (180 degrees, negative x) to the outward reach (0 degrees, positive x).
 */
export interface LateralRange {
  min: number;
  max: number;
}

export function lateralRange(radii: readonly number[] | null): LateralRange {
  return { min: -reachInDirection(radii, 180), max: reachInDirection(radii, 0) };
}

/** The basket's centre: the fingertip's x, kept within the range. */
export function basketX(fingertipX: number, range: LateralRange): number {
  return Math.min(range.max, Math.max(range.min, fingertipX));
}

/**
 * Where a fruit falls, along x: out (positive) or across (negative), at targetFrac of the part of
 * that side's reach the spread uses.
 */
export function fruitX(
  side: Side,
  targetFrac: number,
  spreadFrac: number,
  range: LateralRange,
): number {
  const reach = side === "out" ? range.max : -range.min;
  const x = targetFrac * spreadFrac * reach;
  return side === "out" ? x : -x;
}

/** Whether a basket at basketCentre covers a fruit at x. */
export function covers(basketCentre: number, basketWidthSw: number, x: number): boolean {
  return Math.abs(x - basketCentre) <= basketWidthSw / 2;
}

/**
 * A sector for the reach map: the outward direction (D0) or across (D4), and a ring by how much of
 * that side's reach the fruit is at.
 */
export function fruitSector(side: Side, x: number, range: LateralRange): string {
  const reach = side === "out" ? range.max : -range.min;
  const share = reach > 0 ? Math.abs(x) / reach : 0;
  return `D${side === "out" ? 0 : 4}R${ringFor(share)}`;
}

/** How long a fruit takes to fall from fromY to toY at a steady speed, in ms. */
export function fallMs(fromY: number, toY: number, speedSwS: number): number {
  return speedSwS > 0 ? (Math.max(0, fromY - toY) / speedSwS) * 1000 : Infinity;
}
