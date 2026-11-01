import type { Point } from "@/vision/geometry";

import type { DemoKeyframe } from "./exercises";

const lerp = (a: number, b: number, share: number) => a + (b - a) * share;
const lerpPoint = (a: Point, b: Point, share: number): Point => ({
  x: lerp(a.x, b.x, share),
  y: lerp(a.y, b.y, share),
});

/** The pose at a time from 0 to 1, between the keyframes on either side. */
export function poseAt(frames: readonly DemoKeyframe[], time: number): DemoKeyframe {
  const clamped = Math.min(1, Math.max(0, time));
  const nextIndex = frames.findIndex((frame) => frame.time >= clamped);
  if (nextIndex <= 0) return frames[0];

  const before = frames[nextIndex - 1];
  const after = frames[nextIndex];
  const share = (clamped - before.time) / (after.time - before.time);
  return {
    time: clamped,
    shoulder: lerpPoint(before.shoulder, after.shoulder, share),
    elbow: lerpPoint(before.elbow, after.elbow, share),
    wrist: lerpPoint(before.wrist, after.wrist, share),
  };
}

export interface GaugePoint {
  x: number;
  y: number;
}

/** A point on a semicircle: 0 degrees on the left, 90 at the top and 180 on the right. */
export function gaugePoint(
  degrees: number,
  centerX: number,
  centerY: number,
  radius: number,
): GaugePoint {
  const clamped = Math.min(180, Math.max(0, degrees));
  const radians = (clamped * Math.PI) / 180;
  return { x: centerX - radius * Math.cos(radians), y: centerY - radius * Math.sin(radians) };
}

/** An SVG arc path between two angles on that semicircle. */
export function gaugeArc(
  fromDeg: number,
  toDeg: number,
  centerX: number,
  centerY: number,
  radius: number,
): string {
  const from = gaugePoint(fromDeg, centerX, centerY, radius);
  const to = gaugePoint(toDeg, centerX, centerY, radius);
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
}
