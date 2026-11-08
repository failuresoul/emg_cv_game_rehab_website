import type { Side } from "@/types/api";

import { median } from "./geometry";
import { POSE } from "./landmarks";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** A zero vector has no direction, so it stays zero. */
export function normalise(v: Vec3): Vec3 {
  const length = norm(v);
  return length === 0 ? v : { x: v.x / length, y: v.y / length, z: v.z / length };
}

/** In degrees, from 0 to 180. NaN if either vector has no length. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const lengths = norm(a) * norm(b);
  if (lengths === 0) return NaN;
  const cosine = Math.min(1, Math.max(-1, dot(a, b) / lengths));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function projectOntoPlane(v: Vec3, normal: Vec3): Vec3 {
  const unit = normalise(normal);
  const along = dot(v, unit);
  return { x: v.x - along * unit.x, y: v.y - along * unit.y, z: v.z - along * unit.z };
}

const MIN_VISIBILITY = 0.5;
// MediaPipe's axes match the image: x to the right, y down, z away from the camera.
const WORLD_DOWN: Vec3 = { x: 0, y: 1, z: 0 };
// Close to the trunk axis, a tiny movement swings the direction wildly, so it means nothing.
const MIN_ANGLE_FROM_TRUNK_AXIS_DEG = 15;

export type AngleSource = "3d" | "2d";
export type TrunkReference = "hip" | "vertical";

export interface AngleMeasure {
  value: number;
  source: AngleSource;
  trunkReference: TrunkReference;
  /** The lowest visibility among the landmarks used. */
  confidence: number;
}

export interface JointAngles {
  armElevationDeg: AngleMeasure | null;
  elevationPlaneDeg: AngleMeasure | null;
  elbowFlexionDeg: AngleMeasure | null;
  /** How far the wrist is in front of the shoulder, as a share of arm length. 3D only. */
  forwardReachRatio: AngleMeasure | null;
}

const ARM_LENGTH_FRAMES = 30;

/**
 * Arm length (upper arm + forearm, in metres) as the median of the last 30 valid frames, so one
 * badly estimated frame does not change every reach ratio.
 */
export class ArmLengthTracker {
  private readonly lengths: number[] = [];

  add(length: number): number {
    if (Number.isFinite(length) && length > 0) {
      this.lengths.push(length);
      if (this.lengths.length > ARM_LENGTH_FRAMES) this.lengths.shift();
    }
    return this.value() ?? length;
  }

  value(): number | null {
    return this.lengths.length > 0 ? median(this.lengths) : null;
  }

  reset(): void {
    this.lengths.length = 0;
  }
}

interface LandmarkLike extends Vec3 {
  visibility?: number;
}

export interface JointAngleInput {
  pose: readonly LandmarkLike[] | null;
  poseWorld: readonly LandmarkLike[] | null;
  frameWidth: number;
  frameHeight: number;
}

/**
 * Measures the affected arm. World landmarks are used when available. Otherwise image landmarks
 * are used, scaled to pixels so that the camera's aspect ratio does not distort the angles.
 */
export function computeJointAngles(
  input: JointAngleInput,
  affectedSide: Side,
  armLengths: ArmLengthTracker = new ArmLengthTracker(),
): JointAngles {
  const { pose, poseWorld, frameWidth, frameHeight } = input;
  const useWorld = Boolean(poseWorld?.length);
  const source: AngleSource = useWorld ? "3d" : "2d";

  // Image and world landmarks describe the same detection; the image set carries visibility.
  const visibilityOf = (index: number): number =>
    pose?.[index]?.visibility ?? poseWorld?.[index]?.visibility ?? 1;
  const isVisible = (index: number): boolean => {
    const exists = useWorld ? poseWorld?.[index] : pose?.[index];
    return exists !== undefined && visibilityOf(index) >= MIN_VISIBILITY;
  };
  const positionOf = (index: number): Vec3 => {
    if (useWorld) return (poseWorld as readonly LandmarkLike[])[index];
    const landmark = (pose as readonly LandmarkLike[])[index];
    return { x: landmark.x * frameWidth, y: landmark.y * frameHeight, z: 0 };
  };

  const isLeft = affectedSide === "left";
  const shoulder = isLeft ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER;
  const elbow = isLeft ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW;
  const wrist = isLeft ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST;
  const hip = isLeft ? POSE.LEFT_HIP : POSE.RIGHT_HIP;

  const hipVisible = isVisible(hip);
  const trunkReference: TrunkReference = hipVisible ? "hip" : "vertical";

  const measure = (value: number, used: number[]): AngleMeasure | null =>
    Number.isFinite(value)
      ? {
          value,
          source,
          trunkReference,
          confidence: Math.min(...used.map(visibilityOf)),
        }
      : null;

  const empty = {
    armElevationDeg: null,
    elevationPlaneDeg: null,
    elbowFlexionDeg: null,
    forwardReachRatio: null,
  };
  if (!isVisible(shoulder) || !isVisible(elbow)) return empty;

  const shoulderPosition = positionOf(shoulder);
  const upperArm = subtract(positionOf(elbow), shoulderPosition);
  const trunkDown = hipVisible ? subtract(positionOf(hip), shoulderPosition) : WORLD_DOWN;
  const trunkLandmarks = hipVisible ? [shoulder, elbow, hip] : [shoulder, elbow];

  const elevation = angleBetween(upperArm, trunkDown);

  return {
    armElevationDeg: measure(elevation, trunkLandmarks),
    elevationPlaneDeg: useWorld
      ? measurePlane(elevation, upperArm, trunkDown, isLeft, positionOf, isVisible, (value) =>
          measure(value, [...trunkLandmarks, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER]),
        )
      : // A flat image has no depth, so it cannot tell forward from sideways.
        null,
    elbowFlexionDeg: isVisible(wrist)
      ? measure(
          angleBetween(
            subtract(shoulderPosition, positionOf(elbow)),
            subtract(positionOf(wrist), positionOf(elbow)),
          ),
          [shoulder, elbow, wrist],
        )
      : null,
    forwardReachRatio:
      useWorld && isVisible(wrist)
        ? measureForwardReach(shoulderPosition, positionOf(elbow), positionOf(wrist), trunkDown, {
            positionOf,
            isVisible,
            armLengths,
            toMeasure: (value) =>
              measure(value, [...trunkLandmarks, wrist, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER]),
          })
        : // A flat image has no depth, so it cannot tell how far forward the hand is.
          null,
  };
}

/** Up, the person's left, and out of their chest, from the trunk and the shoulder line. */
function bodyAxes(
  trunkDown: Vec3,
  positionOf: (index: number) => Vec3,
): { up: Vec3; personsLeft: Vec3; forward: Vec3 } {
  const up = normalise({ x: -trunkDown.x, y: -trunkDown.y, z: -trunkDown.z });
  const personsLeft = normalise(
    projectOntoPlane(subtract(positionOf(POSE.LEFT_SHOULDER), positionOf(POSE.RIGHT_SHOULDER)), up),
  );
  // In these axes, the person's left crossed with up points out of their chest.
  return { up, personsLeft, forward: cross(personsLeft, up) };
}

/**
 * The wrist's distance in front of the shoulder, along the body's forward axis, divided by arm
 * length: about 0 with the arm down or out to the side, and 1 with it straight forward. Only the
 * forward part counts, so reaching sideways or hanging the arm straight down does not.
 */
function measureForwardReach(
  shoulder: Vec3,
  elbow: Vec3,
  wrist: Vec3,
  trunkDown: Vec3,
  helpers: {
    positionOf: (index: number) => Vec3;
    isVisible: (index: number) => boolean;
    armLengths: ArmLengthTracker;
    toMeasure: (value: number) => AngleMeasure | null;
  },
): AngleMeasure | null {
  const { positionOf, isVisible, armLengths, toMeasure } = helpers;
  if (!isVisible(POSE.LEFT_SHOULDER) || !isVisible(POSE.RIGHT_SHOULDER)) return null;

  const armLength = armLengths.add(norm(subtract(elbow, shoulder)) + norm(subtract(wrist, elbow)));
  if (!Number.isFinite(armLength) || armLength <= 0) return null;

  const { forward } = bodyAxes(trunkDown, positionOf);
  return toMeasure(dot(subtract(wrist, shoulder), forward) / armLength);
}

/** 0 is straight out to the side and 90 is straight forward, on either affected side. */
function measurePlane(
  elevation: number,
  upperArm: Vec3,
  trunkDown: Vec3,
  isLeft: boolean,
  positionOf: (index: number) => Vec3,
  isVisible: (index: number) => boolean,
  toMeasure: (value: number) => AngleMeasure | null,
): AngleMeasure | null {
  if (!isVisible(POSE.LEFT_SHOULDER) || !isVisible(POSE.RIGHT_SHOULDER)) return null;
  if (
    !Number.isFinite(elevation) ||
    elevation < MIN_ANGLE_FROM_TRUNK_AXIS_DEG ||
    elevation > 180 - MIN_ANGLE_FROM_TRUNK_AXIS_DEG
  ) {
    return null;
  }

  const { up, personsLeft, forward } = bodyAxes(trunkDown, positionOf);
  const outward = isLeft
    ? personsLeft
    : { x: -personsLeft.x, y: -personsLeft.y, z: -personsLeft.z };

  const flattened = projectOntoPlane(upperArm, up);
  const radians = Math.atan2(dot(flattened, forward), dot(flattened, outward));
  return toMeasure((radians * 180) / Math.PI);
}
