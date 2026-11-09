import type { Side } from "@/types/api";
import type { Point } from "@/vision/geometry";

/** The reach hull fills this share of the screen height. */
export const PLAY_AREA_HEIGHT_SHARE = 0.8;
/** ...unless that would make it wider than this share of the screen width. */
export const PLAY_AREA_MAX_WIDTH_SHARE = 0.9;
/** Used without a calibration: a reach of 1.2 shoulder widths all round. */
export const DEFAULT_REACH_SW = 1.2;
/** A hull smaller than this, in shoulder widths, is treated as this size, so targets stay sane. */
const MIN_EXTENT_SW = 0.5;

export interface PlayArea {
  width: number;
  height: number;
  /** Screen pixels per shoulder width. */
  pixelsPerSw: number;
  /** Where the affected shoulder (the body frame's origin) is on screen. */
  originPx: Point;
  /** +1 when the body's +x points right on screen, -1 when it points left. */
  xSign: 1 | -1;
  toScreen(pointSw: Point): Point;
  toBody(pointPx: Point): Point;
}

export interface PlayAreaOptions {
  width: number;
  height: number;
  affectedSide: Side;
  /** The calibrated reach hull in shoulder widths, or null for the default reach. */
  hull: readonly Point[] | null;
  /** Screen space covered by other things, such as a top bar, in pixels. The hull fits the rest. */
  insets?: { top?: number; bottom?: number };
}

function defaultHull(): Point[] {
  return Array.from({ length: 8 }, (_, index) => {
    const radians = (index * Math.PI) / 4;
    return { x: DEFAULT_REACH_SW * Math.cos(radians), y: DEFAULT_REACH_SW * Math.sin(radians) };
  });
}

/**
 * Maps the body frame to the screen, mirrored like SkeletonCanvas: the patient sees themselves as
 * in a mirror, so a left-affected patient's outward (+x) is to the screen's left. The reach hull,
 * with the shoulder itself, is centred and scaled to fill about 80% of the height left between
 * the insets (such as the top bar). That puts the shoulder towards the side of the screen opposite
 * the reach, leaving room to reach out.
 */
export function createPlayArea({
  width,
  height,
  affectedSide,
  hull,
  insets = {},
}: PlayAreaOptions): PlayArea {
  const top = insets.top ?? 0;
  const usableHeight = Math.max(1, height - top - (insets.bottom ?? 0));
  const points = [{ x: 0, y: 0 }, ...(hull && hull.length >= 3 ? hull : defaultHull())];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const extentX = Math.max(maxX - minX, MIN_EXTENT_SW);
  const extentY = Math.max(maxY - minY, MIN_EXTENT_SW);

  const pixelsPerSw = Math.max(
    Math.min(
      (PLAY_AREA_HEIGHT_SHARE * usableHeight) / extentY,
      (PLAY_AREA_MAX_WIDTH_SHARE * width) / extentX,
    ),
    Number.EPSILON,
  );
  const xSign: 1 | -1 = affectedSide === "left" ? -1 : 1;
  const centreSw = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const originPx = {
    x: width / 2 - xSign * centreSw.x * pixelsPerSw,
    // Screen y grows downward.
    y: top + usableHeight / 2 + centreSw.y * pixelsPerSw,
  };

  return {
    width,
    height,
    pixelsPerSw,
    originPx,
    xSign,
    toScreen: (point) => ({
      x: originPx.x + xSign * point.x * pixelsPerSw,
      y: originPx.y - point.y * pixelsPerSw,
    }),
    toBody: (point) => ({
      x: (xSign * (point.x - originPx.x)) / pixelsPerSw,
      y: (originPx.y - point.y) / pixelsPerSw,
    }),
  };
}
