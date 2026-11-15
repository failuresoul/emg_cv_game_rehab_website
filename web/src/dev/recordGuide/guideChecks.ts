// Development only (the guided recorder): the set-up checks before recording, and whether the
// affected arm and hand are in view during a step. Built on the session's camera check.
import type { Side } from "@/types/api";
import { shoulderWidthPx } from "@/vision/geometry";
import { selectAffectedHand } from "@/vision/hand";
import { isLandmarkVisible, POSE } from "@/vision/landmarks";
import { evaluateSetupChecks } from "@/vision/setupChecks";
import type { VisionResult } from "@/vision/visionEngine";

/** Shoulder width as a share of the frame width: closer is wider. */
export const MIN_SHOULDER_SHARE = 0.16;
export const MAX_SHOULDER_SHARE = 0.45;

export type DistanceState = "ok" | "tooFar" | "tooClose" | "unknown";

export interface GuideChecks {
  cameraOn: boolean;
  shouldersVisible: boolean;
  handVisible: boolean;
  distance: DistanceState;
  enoughLight: boolean;
}

export function distanceState(result: VisionResult | null): DistanceState {
  if (!result?.pose) return "unknown";
  const width = shoulderWidthPx(result.pose, result.frameWidth, result.frameHeight);
  if (width === null || result.frameWidth <= 0) return "unknown";
  const share = width / result.frameWidth;
  if (share < MIN_SHOULDER_SHARE) return "tooFar";
  if (share > MAX_SHOULDER_SHARE) return "tooClose";
  return "ok";
}

/** True if the affected arm (its wrist) and the affected hand are both seen. */
export function armAndHandVisible(result: VisionResult | null, side: Side): boolean {
  if (!result?.pose) return false;
  const wrist = result.pose[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  return isLandmarkVisible(wrist) && selectAffectedHand(result, side) !== null;
}

export function evaluateGuideChecks(result: VisionResult | null, side: Side): GuideChecks {
  const setup = evaluateSetupChecks(result, side);
  return {
    cameraOn: setup.cameraOn,
    shouldersVisible: setup.upperBodyVisible,
    handVisible: armAndHandVisible(result, side),
    distance: distanceState(result),
    enoughLight: setup.enoughLight,
  };
}

export function allChecksPass(checks: GuideChecks): boolean {
  return (
    checks.cameraOn &&
    checks.shouldersVisible &&
    checks.handVisible &&
    checks.distance === "ok" &&
    checks.enoughLight
  );
}
