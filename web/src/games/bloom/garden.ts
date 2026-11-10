import type { Point } from "@/vision/geometry";

import type { BloomPhase } from "./bloomMachine";

/** Gentle petal colours, used in turn. */
export const FLOWER_COLOURS = ["#F4A7B9", "#F2C94C", "#B9A6E0", "#F4B183", "#9AD0EC"] as const;

export interface GardenLayout {
  width: number;
  height: number;
  /** Space between planted flowers, in pixels. */
  spacing: number;
}

export interface PlantedFlower {
  /** Where the stem meets the soil, in canvas pixels. */
  base: Point;
  colour: string;
}

/** The garden's rows start this far above the bottom edge. */
const BOTTOM_MARGIN_SHARE = 0.06;
const EDGE_MARGIN_PX = 32;

/**
 * Where the first `count` planted flowers go: rows across the bottom of the screen, filled left to
 * right, the lowest row first. Each new row is shifted by half a space, as in a real bed.
 */
export function gardenSlots(
  count: number,
  { width, height, spacing }: GardenLayout,
): PlantedFlower[] {
  const usable = Math.max(spacing, width - 2 * EDGE_MARGIN_PX);
  const perRow = Math.max(1, Math.floor(usable / spacing));
  const bottom = height * (1 - BOTTOM_MARGIN_SHARE);
  const rowHeight = spacing * 0.7;
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    const shift = row % 2 === 1 ? spacing / 2 : 0;
    const rowWidth = (perRow - 1) * spacing;
    const left = (width - rowWidth) / 2;
    const x = Math.min(width - EDGE_MARGIN_PX, left + column * spacing + shift);
    return {
      base: { x, y: bottom - row * rowHeight },
      colour: FLOWER_COLOURS[index % FLOWER_COLOURS.length],
    };
  });
}

/**
 * How many flowers stand in the garden: one for each collected seed, with the newest planted once
 * its seed has landed in the basket.
 */
export function plantedCount(collected: number, phase: BloomPhase | null): number {
  return Math.max(0, collected - (phase === "COLLECTED" ? 1 : 0));
}
