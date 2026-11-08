import type { Side } from "@/types/api";

import { type JointAngleInput, subtract, type Vec3 } from "./angles";
import { POSE } from "./landmarks";

const MIN_VISIBILITY = 0.5;

/**
 * The trunk's position in one frame, with +y up: in metres from world landmarks when available
 * (whose origin is between the hips), otherwise in image pixels. Distances are only turned into
 * shoulder widths against the baseline's width, so leaning towards a webcam, which makes the
 * shoulders look wider, does not change them.
 */
export interface PostureSample {
  shoulderMidpoint: Vec3;
  /** The distance between the shoulders. */
  shoulderWidth: number;
  /** The affected shoulder's height above the other one. */
  affectedShoulderRise: number;
  /** Shoulder midpoint to hip midpoint, or null if the hips are not visible. */
  trunkVector: Vec3 | null;
  /** Other shoulder to affected shoulder, flattened onto the frontal plane. */
  shoulderLine: Vec3;
  source: "3d" | "2d";
}

export function averageOf(points: readonly Vec3[]): Vec3 {
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
    z: points.reduce((total, point) => total + point.z, 0) / points.length,
  };
}

/** The trunk's posture, or null unless both shoulders are visible. */
export function computePosture(input: JointAngleInput, affectedSide: Side): PostureSample | null {
  const { pose, poseWorld, frameWidth, frameHeight } = input;
  const useWorld = Boolean(poseWorld?.length);
  const landmarks = useWorld ? poseWorld : pose;
  if (!landmarks) return null;

  // Image landmarks carry the visibility for both sets.
  const visible = (index: number) =>
    landmarks[index] !== undefined &&
    (pose?.[index]?.visibility ?? landmarks[index].visibility ?? 1) >= MIN_VISIBILITY;
  // Both in metres or pixels, with +y up.
  const at = (index: number): Vec3 => {
    const point = landmarks[index];
    return useWorld
      ? { x: point.x, y: -point.y, z: point.z }
      : { x: point.x * frameWidth, y: -point.y * frameHeight, z: 0 };
  };

  const isLeft = affectedSide === "left";
  const affected = isLeft ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER;
  const other = isLeft ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER;
  if (!visible(affected) || !visible(other)) return null;

  const affectedShoulder = at(affected);
  const otherShoulder = at(other);
  const line = subtract(affectedShoulder, otherShoulder);
  const width = Math.hypot(line.x, line.y, line.z);
  if (!Number.isFinite(width) || width <= 0) return null;

  const midpoint = averageOf([affectedShoulder, otherShoulder]);
  const hipsVisible = visible(POSE.LEFT_HIP) && visible(POSE.RIGHT_HIP);
  const hipMidpoint = hipsVisible ? averageOf([at(POSE.LEFT_HIP), at(POSE.RIGHT_HIP)]) : null;

  return {
    shoulderMidpoint: midpoint,
    shoulderWidth: width,
    affectedShoulderRise: line.y,
    trunkVector: hipMidpoint ? subtract(hipMidpoint, midpoint) : null,
    shoulderLine: { x: line.x, y: line.y, z: 0 },
    source: useWorld ? "3d" : "2d",
  };
}
