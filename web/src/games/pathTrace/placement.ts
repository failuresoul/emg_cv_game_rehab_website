import {
  buildPath,
  centroid,
  distanceToHullEdge,
  hullDiameter,
  type PathShape,
} from "@/metrics/paths";
import { type Point, pointInPolygon } from "@/vision/geometry";

/** Space between the path's points, in SW: about 30 to 100 points for usual paths. */
export const PATH_SPACING_SW = 0.02;
/** The server keeps at most this many points of a path target. */
export const MAX_TARGET_POINTS = 200;

export interface PathPlacementInput {
  shape: PathShape;
  /** The calibrated reach hull in SW (RAW), or the default one. */
  hull: readonly Point[];
  /** How long the path is, as a share of the reach diameter (the hull's longest span). */
  pathLengthFrac: number;
  /** How far out the path's middle is, as a share of the reach in that direction. */
  ringFrac: number;
  /** True for a path that runs outward (towards +x), false for inward. */
  outward: boolean;
}

export interface PathPlacement {
  points: Point[];
  /** The path's actual length: shorter than asked only if the longer one would not fit. */
  lengthSw: number;
  /** Where the path's middle is. */
  centreSw: Point;
}

/**
 * Where the path goes. Its middle is on the line from the shoulder through the middle of the
 * reach, `ringFrac` of the way to the edge of the reach. The shape runs across that line (along
 * the "ring" of the reach map), so it stays at about the same distance from the body, and it is
 * `pathLengthFrac` of the reach diameter long unless that would leave the reach. An outward path
 * starts on the body's side (smaller x) and ends farther out; an inward one the other way round.
 */
export function placePath({
  shape,
  hull,
  pathLengthFrac,
  ringFrac,
  outward,
}: PathPlacementInput): PathPlacement {
  const origin = { x: 0, y: 0 };
  const middle = centroid(hull);
  // A hull that does not hold the shoulder (an unusual calibration) is measured from its middle.
  const from = pointInPolygon(origin, hull) ? origin : middle;
  const rayDeg =
    Math.hypot(middle.x - from.x, middle.y - from.y) > 1e-6
      ? (Math.atan2(middle.y - from.y, middle.x - from.x) * 180) / Math.PI
      : 0;
  const edge = distanceToHullEdge(hull, from, rayDeg);
  const share = Math.min(0.95, Math.max(0.05, ringFrac));
  const radians = (rayDeg * Math.PI) / 180;
  const centreSw = {
    x: from.x + Math.cos(radians) * edge * share,
    y: from.y + Math.sin(radians) * edge * share,
  };

  let points = buildPath(shape, {
    hull,
    centre: centreSw,
    lengthSw: pathLengthFrac * hullDiameter(hull),
    rotationDeg: rayDeg - 90,
    spacingSw: PATH_SPACING_SW,
  });
  const runsOutward = points[points.length - 1].x >= points[0].x;
  if (runsOutward !== outward) points = [...points].reverse();
  const lengthSw = points
    .slice(1)
    .reduce(
      (total, point, index) =>
        total + Math.hypot(point.x - points[index].x, point.y - points[index].y),
      0,
    );
  return { points, lengthSw, centreSw };
}

/** The path for saving: at most 200 points, evenly picked, ends kept, in SW to 4 decimals. */
export function targetPoints(points: readonly Point[]): [number, number][] {
  // `|| 0` saves −0 as 0.
  const round = (value: number) => Math.round(value * 10000) / 10000 || 0;
  const count = Math.min(points.length, MAX_TARGET_POINTS);
  if (count < 2) return points.map((point) => [round(point.x), round(point.y)]);
  return Array.from({ length: count }, (_, index) => {
    const point = points[Math.round((index * (points.length - 1)) / (count - 1))];
    return [round(point.x), round(point.y)];
  });
}
