import type { Side } from "@/types/api";

import type { AngleSource } from "./angles";
import { distance, shoulderWidthPx, toPixel } from "./geometry";
import { HAND, isLandmarkVisible, POSE, type VisibleLandmark } from "./landmarks";
import type { DetectedHand } from "./visionEngine";

/** A hand's wrist farther than this from the pose's wrist belongs to some other hand. */
const MAX_WRIST_GAP_SW = 0.5;
const HAND_LANDMARK_COUNT = 21;
const FINGERTIPS = [
  HAND.THUMB_TIP,
  HAND.INDEX_TIP,
  HAND.MIDDLE_TIP,
  HAND.RING_TIP,
  HAND.PINKY_TIP,
] as const;
/** Index, middle, ring and little finger, the order of a thumb opposition sequence. */
export const OPPOSITION_FINGERTIPS = [
  HAND.INDEX_TIP,
  HAND.MIDDLE_TIP,
  HAND.RING_TIP,
  HAND.PINKY_TIP,
] as const;

interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface HandSelectionInput {
  hands: readonly DetectedHand[];
  pose: readonly VisibleLandmark[] | null;
  frameWidth: number;
  frameHeight: number;
}

/**
 * The affected hand, chosen by where it is: MediaPipe's handedness is unreliable when the camera
 * mirrors its image. Null unless a hand's wrist is within half a shoulder width of the pose's
 * wrist on the affected side.
 */
export function selectAffectedHand(
  { hands, pose, frameWidth, frameHeight }: HandSelectionInput,
  affectedSide: Side,
): DetectedHand | null {
  if (!pose || hands.length === 0) return null;
  const poseWrist = pose[affectedSide === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  const widthPx = shoulderWidthPx(pose, frameWidth, frameHeight);
  if (!isLandmarkVisible(poseWrist) || widthPx === null || widthPx <= 0) return null;

  const wristPx = toPixel(poseWrist, frameWidth, frameHeight);
  let best: DetectedHand | null = null;
  let bestGap = Infinity;
  for (const hand of hands) {
    const handWrist = hand.landmarks[HAND.WRIST];
    if (!handWrist) continue;
    const gap = distance(toPixel(handWrist, frameWidth, frameHeight), wristPx) / widthPx;
    if (gap < bestGap) {
      best = hand;
      bestGap = gap;
    }
  }
  return bestGap <= MAX_WRIST_GAP_SW ? best : null;
}

export interface HandMeasures {
  /** Mean wrist-to-fingertip distance in palm lengths: about 1.0 for a fist, 1.8 for an open hand. */
  handApertureRatio: number;
  /** Thumb tip to the index, middle, ring and little fingertips, in palm lengths. */
  thumbFingerDistances: [number, number, number, number];
  source: AngleSource;
}

/**
 * Ratios of palm length (wrist to middle knuckle), so they do not depend on distance from the
 * camera. World landmarks are used when present; image landmarks are scaled to pixels otherwise,
 * so that the camera's aspect ratio does not distort them.
 */
export function computeHandMeasures(
  hand: DetectedHand | null,
  frameWidth: number,
  frameHeight: number,
): HandMeasures | null {
  if (!hand) return null;
  const world = hand.worldLandmarks;
  const useWorld = world !== null && world.length >= HAND_LANDMARK_COUNT;
  if (!useWorld && hand.landmarks.length < HAND_LANDMARK_COUNT) return null;

  const at = (index: number): Vec => {
    if (useWorld) return world[index];
    const point = hand.landmarks[index];
    return { x: point.x * frameWidth, y: point.y * frameHeight, z: 0 };
  };
  const gap = (a: number, b: number) => {
    const p = at(a);
    const q = at(b);
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };

  const palm = gap(HAND.WRIST, HAND.MIDDLE_MCP);
  if (!Number.isFinite(palm) || palm <= 0) return null;

  const aperture =
    FINGERTIPS.reduce((total, tip) => total + gap(HAND.WRIST, tip), 0) / FINGERTIPS.length / palm;
  const [index, middle, ring, little] = OPPOSITION_FINGERTIPS.map(
    (tip) => gap(HAND.THUMB_TIP, tip) / palm,
  );
  const values = [aperture, index, middle, ring, little];
  if (!values.every(Number.isFinite)) return null;

  return {
    handApertureRatio: aperture,
    thumbFingerDistances: [index, middle, ring, little],
    source: useWorld ? "3d" : "2d",
  };
}
