import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export const HAND = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
} as const;

export const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

const MIN_VISIBILITY = 0.5;

/** True if a pose landmark is inside the frame and the model is confident it can see it. */
export function isLandmarkVisible(landmark: NormalizedLandmark | undefined): boolean {
  if (!landmark) return false;
  const inFrame = landmark.x >= 0 && landmark.x <= 1 && landmark.y >= 0 && landmark.y <= 1;
  return inFrame && (landmark.visibility ?? 1) >= MIN_VISIBILITY;
}
