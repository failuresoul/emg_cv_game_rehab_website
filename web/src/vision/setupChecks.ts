import type { Side } from "@/types/api";

import { isLandmarkVisible, POSE } from "./landmarks";
import type { VisionResult } from "./visionEngine";

// Average frame brightness on a 0-255 scale.
const MIN_BRIGHTNESS = 60;

export interface SetupChecks {
  cameraOn: boolean;
  upperBodyVisible: boolean;
  armVisible: boolean;
  enoughLight: boolean;
}

/** Only what tracking needs: the hand does not matter, and neither does exact distance. */
export function evaluateSetupChecks(result: VisionResult | null, side: Side | null): SetupChecks {
  const pose = result?.pose;
  const elbow = side === "right" ? POSE.RIGHT_ELBOW : POSE.LEFT_ELBOW;
  const wrist = side === "right" ? POSE.RIGHT_WRIST : POSE.LEFT_WRIST;

  return {
    cameraOn: result !== null,
    upperBodyVisible:
      isLandmarkVisible(pose?.[POSE.LEFT_SHOULDER]) &&
      isLandmarkVisible(pose?.[POSE.RIGHT_SHOULDER]),
    armVisible: isLandmarkVisible(pose?.[elbow]) && isLandmarkVisible(pose?.[wrist]),
    enoughLight: (result?.brightness ?? 0) >= MIN_BRIGHTNESS,
  };
}
