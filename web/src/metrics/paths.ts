import { distance, type Point, pointInPolygon } from "@/vision/geometry";

export type PathShape = "line" | "arc" | "s_curve" | "circle_part";

export const PATH_SHAPES: readonly PathShape[] = ["line", "arc", "s_curve", "circle_part"];

/** Points per unit of the shape templates, before the path is evenly respaced. */
const TEMPLATE_STEPS = 200;
/** Steps of the search for the largest size that fits the hull. */
const FIT_ITERATIONS = 30;

/**
 * Each shape drawn in a box from −1 to 1, centred on 0, as a dense list of points:
 * - line: a gentle diagonal, outward and slightly up;
 * - arc: a third of a circle, bulging upwards;
 * - s_curve: one full sine wave across;
 * - circle_part: three quarters of a circle, starting outward and turning anticlockwise.
 */
function template(shape: PathShape): Point[] {
  const at = (share: number): Point => {
    switch (shape) {
      case "line":
        return { x: -1 + 2 * share, y: -0.3 + 0.6 * share };
      case "arc": {
        const angle = (Math.PI * (210 - 240 * share)) / 180;
        return { x: Math.cos(angle) * 1.15, y: Math.sin(angle) * 1.15 - 0.4 };
      }
      case "s_curve":
        return { x: -1 + 2 * share, y: 0.5 * Math.sin(2 * Math.PI * share) };
      case "circle_part": {
        const angle = 1.5 * Math.PI * share;
        return { x: Math.cos(angle), y: Math.sin(angle) };
      }
    }
  };
  return Array.from({ length: TEMPLATE_STEPS + 1 }, (_, step) => at(step / TEMPLATE_STEPS));
}

/** The total length of a path, in its units. */
export function pathLength(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
  return total;
}

/** The point `along` units from the start of the path, kept to the path's ends. */
export function pointAtDistance(path: readonly Point[], along: number): Point {
  if (path.length === 0) throw new RangeError("the path is empty");
  if (!(along > 0)) return { ...path[0] };
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const step = distance(path[i - 1], path[i]);
    if (travelled + step >= along && step > 0) {
      const share = (along - travelled) / step;
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * share,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * share,
      };
    }
    travelled += step;
  }
  return { ...path[path.length - 1] };
}

/** The path as points evenly `spacing` apart along it, from its start to its end. */
export function evenlySpaced(path: readonly Point[], spacing: number): Point[] {
  if (!(spacing > 0)) throw new RangeError(`spacing (${spacing}) must be above 0`);
  const length = pathLength(path);
  const steps = Math.max(1, Math.round(length / spacing));
  return Array.from({ length: steps + 1 }, (_, step) =>
    pointAtDistance(path, (length * step) / steps),
  );
}

export interface ClosestPoint {
  /** The nearest point on the path. */
  point: Point;
  /** How far the given point is from the path. */
  distance: number;
  /** How far along the path the nearest point is, from its start. */
  along: number;
}

/** The nearest point on the path (on any of its segments, not only at its points). */
export function closestPointOnPath(path: readonly Point[], point: Point): ClosestPoint {
  if (path.length === 0) throw new RangeError("the path is empty");
  let best: ClosestPoint = { point: { ...path[0] }, distance: distance(path[0], point), along: 0 };
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const share =
      lengthSq > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
        : 0;
    const nearest = { x: a.x + dx * share, y: a.y + dy * share };
    const gap = distance(nearest, point);
    const step = Math.sqrt(lengthSq);
    if (gap < best.distance)
      best = { point: nearest, distance: gap, along: travelled + step * share };
    travelled += step;
  }
  return best;
}

/** The distance from a point to the nearest point of the path. */
export function distanceToPath(path: readonly Point[], point: Point): number {
  return closestPointOnPath(path, point).distance;
}

export interface PathOptions {
  /** The patient's reach hull in SW (the calibration's hull_sw); the path stays inside it. */
  hull: readonly Point[];
  /** Space between the returned points, in SW. */
  spacingSw?: number;
  /** The path's size as a share of the largest that fits the hull, from 0 to 1. */
  sizeFrac?: number;
  /** Turns the shape about its centre, in degrees, anticlockwise. */
  rotationDeg?: number;
  /** Space kept between the path and the hull's edge, as a share of the largest size. */
  margin?: number;
  /** Where the shape's centre goes, in SW. The middle of the hull by default; it must be inside. */
  centre?: Point;
  /**
   * The path's length in SW, in place of `sizeFrac`. It is shortened only as far as needed to fit
   * the hull.
   */
  lengthSw?: number;
}

/** The middle of a polygon's corners: inside it whenever it is convex. */
export const centroid = (points: readonly Point[]): Point => ({
  x: points.reduce((total, point) => total + point.x, 0) / points.length,
  y: points.reduce((total, point) => total + point.y, 0) / points.length,
});

/**
 * How far from `from` the hull's edge is, going in `directionDeg`, for a point `from` inside a
 * convex hull. Found by halving the search.
 */
export function distanceToHullEdge(
  hull: readonly Point[],
  from: Point,
  directionDeg: number,
): number {
  const radians = (directionDeg * Math.PI) / 180;
  const at = (distanceSw: number) => ({
    x: from.x + Math.cos(radians) * distanceSw,
    y: from.y + Math.sin(radians) * distanceSw,
  });
  let low = 0;
  let high = 2 * Math.max(...hull.map((corner) => distance(corner, from)), 0);
  for (let step = 0; step < FIT_ITERATIONS; step++) {
    const middle = (low + high) / 2;
    if (pointInPolygon(at(middle), hull)) low = middle;
    else high = middle;
  }
  return low;
}

/** The longest distance between two corners of a hull: its reach diameter. */
export function hullDiameter(hull: readonly Point[]): number {
  let longest = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++)
      longest = Math.max(longest, distance(hull[i], hull[j]));
  }
  return longest;
}

/**
 * A path of the given shape inside the patient's reach, as points evenly spaced in SW. The shape is
 * centred on `centre` (the middle of the hull by default) and turned by `rotationDeg`. Its size is
 * `lengthSw` long, or `sizeFrac` of the largest size that fits, never more than fits (found by
 * halving the search: a convex hull holds every smaller copy about a centre inside it).
 */
export function buildPath(shape: PathShape, options: PathOptions): Point[] {
  const { hull, spacingSw = 0.02, sizeFrac = 0.8, rotationDeg = 0, margin = 0.05 } = options;
  if (hull.length < 3) throw new RangeError("the hull needs at least three corners");
  const centre = options.centre ?? centroid(hull);
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const shapePoints = template(shape).map(({ x, y }) => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }));
  const placed = (scale: number) =>
    shapePoints.map(({ x, y }) => ({ x: centre.x + x * scale, y: centre.y + y * scale }));
  const fits = (scale: number) => placed(scale).every((point) => pointInPolygon(point, hull));

  let low = 0;
  let high = Math.max(...hull.map((corner) => distance(corner, centre)));
  for (let step = 0; step < FIT_ITERATIONS; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  const largest = low * (1 - margin);
  const scale =
    options.lengthSw !== undefined
      ? Math.min(largest, Math.max(0, options.lengthSw) / pathLength(placed(1)))
      : largest * Math.min(1, Math.max(0, sizeFrac));
  return evenlySpaced(placed(scale), spacingSw);
}
