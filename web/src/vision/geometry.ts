import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import type { Side } from "@/types/api";

import { isLandmarkVisible, POSE } from "./landmarks";

export interface Point {
  x: number;
  y: number;
}

/**
 * The body frame: origin at the affected shoulder and unit of one shoulder width (SW), with +x
 * away from the body midline on the affected side and +y up.
 * The axes stay level with the image, so leaning does not rotate "up".
 */
export interface BodyFrame {
  origin: Point;
  xAxis: Point;
  yAxis: Point;
  shoulderWidthPx: number;
}

export function toPixel(landmark: Point, frameWidth: number, frameHeight: number): Point {
  return { x: landmark.x * frameWidth, y: landmark.y * frameHeight };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Returns null unless both shoulders are visible. */
export function shoulderWidthPx(
  pose: readonly NormalizedLandmark[],
  frameWidth: number,
  frameHeight: number,
): number | null {
  const left = pose[POSE.LEFT_SHOULDER];
  const right = pose[POSE.RIGHT_SHOULDER];
  if (!isLandmarkVisible(left) || !isLandmarkVisible(right)) return null;
  return distance(toPixel(left, frameWidth, frameHeight), toPixel(right, frameWidth, frameHeight));
}

/** Both shoulders are in pixels. Outward is measured from the shoulders, so it also works if a
 * webcam mirrors its own image. */
export function createBodyFrame(
  leftShoulderPx: Point,
  rightShoulderPx: Point,
  affectedSide: Side,
  widthPx: number,
): BodyFrame {
  const origin = affectedSide === "left" ? leftShoulderPx : rightShoulderPx;
  const other = affectedSide === "left" ? rightShoulderPx : leftShoulderPx;
  return {
    origin,
    xAxis: { x: origin.x >= other.x ? 1 : -1, y: 0 },
    // Image y grows downward.
    yAxis: { x: 0, y: -1 },
    shoulderWidthPx: widthPx,
  };
}

export function toBodyFrame(pointPx: Point, frame: BodyFrame): Point {
  const dx = pointPx.x - frame.origin.x;
  const dy = pointPx.y - frame.origin.y;
  return {
    x: (dx * frame.xAxis.x + dy * frame.xAxis.y) / frame.shoulderWidthPx,
    y: (dx * frame.yAxis.x + dy * frame.yAxis.y) / frame.shoulderWidthPx,
  };
}

export function fromBodyFrame(pointSw: Point, frame: BodyFrame): Point {
  const scale = frame.shoulderWidthPx;
  return {
    x: frame.origin.x + (pointSw.x * frame.xAxis.x + pointSw.y * frame.yAxis.x) * scale,
    y: frame.origin.y + (pointSw.x * frame.xAxis.y + pointSw.y * frame.yAxis.y) * scale,
  };
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Monotone chain. Returns the corners counter-clockwise, without collinear points. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter(
    (point, index) =>
      index === 0 || point.x !== sorted[index - 1].x || point.y !== sorted[index - 1].y,
  );
  if (unique.length < 3) return unique;

  const halfHull = (ordered: readonly Point[]): Point[] => {
    const hull: Point[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }
    // The last point starts the other half.
    hull.pop();
    return hull;
  };

  return [...halfHull(unique), ...halfHull([...unique].reverse())];
}

/** Shoelace formula. Always positive, whichever way the corners run. */
export function polygonArea(polygon: readonly Point[]): number {
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

/** How far a point lies along a direction. 0 degrees is +x and 90 degrees is +y. */
export function projectOnDirection(point: Point, directionDeg: number): number {
  const radians = (directionDeg * Math.PI) / 180;
  return point.x * Math.cos(radians) + point.y * Math.sin(radians);
}
