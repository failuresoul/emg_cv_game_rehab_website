import type { TranslationKey } from "@/i18n";
import type { CalibrationCreate, PointPair, Side } from "@/types/api";
import { convexHull, median, type Point, polygonArea } from "@/vision/geometry";

export const DIRECTIONS_DEG = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export type DirectionDeg = (typeof DIRECTIONS_DEG)[number];

export const DIRECTION_KEYS: TranslationKey[] = [
  "calibrate.direction.0",
  "calibrate.direction.45",
  "calibrate.direction.90",
  "calibrate.direction.135",
  "calibrate.direction.180",
  "calibrate.direction.225",
  "calibrate.direction.270",
  "calibrate.direction.315",
];

// The server accepts radii in this range.
const MIN_RADIUS_SW = 0.2;
const MAX_RADIUS_SW = 3.0;
const SIMILAR_AREA_RATIO = 0.1;

export interface DirectionResult {
  /** Null if the direction was skipped without a measurement. */
  bestProjectionSw: number | null;
  maxTrunkSw: number;
  retries: number;
  flagged: boolean;
  shoulderWidthPx: number | null;
}

function directionPoint(deg: number, radius: number): Point {
  const radians = (deg * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

const toPair = (point: Point): PointPair => [point.x, point.y];

/** Reach points on their directions, for stored data that only keeps the radii. */
export function reachPointsFromRadii(radii: readonly number[]): PointPair[] {
  return radii.map((radius, index) => toPair(directionPoint(DIRECTIONS_DEG[index], radius)));
}

/**
 * Builds what the server stores. Each reach point lies on its direction at the measured radius,
 * so the radii and points always agree. A reach outside the accepted range is raised or lowered
 * to the limit and marked invalid, so that one difficult direction cannot block the whole map.
 * Returns null if the shoulders were never seen, because there is then no unit to measure in.
 */
export function buildCalibration(
  results: readonly DirectionResult[],
  affectedSide: Side,
): CalibrationCreate | null {
  const widths = results.flatMap((result) => result.shoulderWidthPx ?? []);
  if (widths.length === 0) return null;

  const radii = results.map((result) =>
    Math.min(MAX_RADIUS_SW, Math.max(MIN_RADIUS_SW, result.bestProjectionSw ?? MIN_RADIUS_SW)),
  );
  const points = radii.map((radius, index) => directionPoint(DIRECTIONS_DEG[index], radius));
  const hull = convexHull(points);

  return {
    affected_side: affectedSide,
    shoulder_width_px: median(widths),
    directions_deg: [...DIRECTIONS_DEG],
    reach_radii_sw: radii,
    reach_points_sw: points.map(toPair),
    hull_sw: hull.map(toPair),
    hull_area_sw2: polygonArea(hull),
    quality: {
      valid: results.map(
        ({ flagged, bestProjectionSw: best }) =>
          !flagged && best !== null && best >= MIN_RADIUS_SW && best <= MAX_RADIUS_SW,
      ),
      retries: results.reduce((total, result) => total + result.retries, 0),
      max_trunk_displacement_sw: Math.max(...results.map((result) => result.maxTrunkSw)),
    },
  };
}

export type AreaComparison = "similar" | "larger" | "smaller";

/** A difference over 10% counts as larger or smaller. */
export function compareArea(current: number, previous: number): AreaComparison {
  const change = (current - previous) / previous;
  if (change > SIMILAR_AREA_RATIO) return "larger";
  if (change < -SIMILAR_AREA_RATIO) return "smaller";
  return "similar";
}

const BROWSERS: [string, RegExp][] = [
  ["Edge", /Edg\/(\d+)/],
  ["Opera", /OPR\/(\d+)/],
  ["Chrome", /Chrome\/(\d+)/],
  ["Firefox", /Firefox\/(\d+)/],
  ["Safari", /Version\/(\d+).*Safari/],
];

export function browserName(userAgent: string): string {
  for (const [name, pattern] of BROWSERS) {
    const match = userAgent.match(pattern);
    if (match) return `${name} ${match[1]}`;
  }
  return "Unknown";
}
