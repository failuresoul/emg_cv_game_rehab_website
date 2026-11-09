import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import type { Side } from "@/types/api";
import { type BodyFrame, type Point, toBodyFrame, toPixel } from "@/vision/geometry";
import { isLandmarkVisible, POSE } from "@/vision/landmarks";
import { POSE_CONNECTIONS } from "@/vision/SkeletonCanvas";

const SKELETON_COLOR = "rgba(232, 242, 241, 0.18)";
const AFFECTED_ARM_COLOR = "rgba(242, 201, 76, 0.28)";
const LINE_SW = 0.06;
// Made once, not every frame.
const LEFT_ARM: readonly number[] = [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW, POSE.LEFT_WRIST];
const RIGHT_ARM: readonly number[] = [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST];

export interface SkeletonLayerInput {
  pose: readonly NormalizedLandmark[] | null;
  frame: BodyFrame | null;
  frameWidth: number;
  frameHeight: number;
  affectedSide: Side;
  toScreen: (pointSw: Point) => Point;
  pixelsPerSw: number;
}

/**
 * The body, faint, behind the game. It is drawn through the play area like the cursor, so the
 * skeleton's hand and the cursor line up.
 */
export function drawSkeletonLayer(context: CanvasRenderingContext2D, input: SkeletonLayerInput) {
  const { pose, frame, frameWidth, frameHeight, affectedSide, toScreen, pixelsPerSw } = input;
  if (!pose || !frame) return;
  const screen = (landmark: NormalizedLandmark) =>
    toScreen(toBodyFrame(toPixel(landmark, frameWidth, frameHeight), frame));
  const affectedArm = affectedSide === "left" ? LEFT_ARM : RIGHT_ARM;

  context.save();
  context.lineCap = "round";
  context.lineWidth = Math.max(4, LINE_SW * pixelsPerSw);
  for (const [start, end] of POSE_CONNECTIONS) {
    if (!isLandmarkVisible(pose[start]) || !isLandmarkVisible(pose[end])) continue;
    const onArm = affectedArm.includes(start) && affectedArm.includes(end);
    context.strokeStyle = onArm ? AFFECTED_ARM_COLOR : SKELETON_COLOR;
    const from = screen(pose[start]);
    const to = screen(pose[end]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}
