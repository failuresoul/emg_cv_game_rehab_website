import { isLandmarkVisible, POSE } from "./landmarks";
import type { VisionResult } from "./visionEngine";

// Shoulder width as a share of the frame width.
const MIN_SHOULDER_WIDTH = 0.18;
const MAX_SHOULDER_WIDTH = 0.45;
// Average frame brightness on a 0-255 scale.
const MIN_BRIGHTNESS = 60;

export interface SetupChecks {
  cameraOn: boolean;
  handVisible: boolean;
  shouldersVisible: boolean;
  goodDistance: boolean;
  enoughLight: boolean;
}

export function evaluateSetupChecks(result: VisionResult | null): SetupChecks {
  const leftShoulder = result?.pose?.[POSE.LEFT_SHOULDER];
  const rightShoulder = result?.pose?.[POSE.RIGHT_SHOULDER];
  const shouldersVisible = isLandmarkVisible(leftShoulder) && isLandmarkVisible(rightShoulder);

  let goodDistance = false;
  if (shouldersVisible && leftShoulder && rightShoulder) {
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    goodDistance = shoulderWidth >= MIN_SHOULDER_WIDTH && shoulderWidth <= MAX_SHOULDER_WIDTH;
  }

  return {
    cameraOn: result !== null,
    handVisible: Boolean(result?.hand),
    shouldersVisible,
    goodDistance,
    enoughLight: (result?.brightness ?? 0) >= MIN_BRIGHTNESS,
  };
}
