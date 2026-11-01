import { describe, expect, it } from "vitest";

import { POSE } from "./landmarks";
import { evaluateSetupChecks } from "./setupChecks";
import type { VisionResult } from "./visionEngine";

function result(hidden: number[] = [], hand: VisionResult["hand"] = null): VisionResult {
  const pose = Array.from({ length: 33 }, (_, index) => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: hidden.includes(index) ? 0.1 : 1,
  }));
  return {
    timestamp: 0,
    hand,
    pose,
    poseWorld: null,
    fps: 30,
    delegate: "GPU",
    brightness: 120,
    frameWidth: 640,
    frameHeight: 480,
  };
}

describe("evaluateSetupChecks", () => {
  it("passes without any hand detection", () => {
    expect(evaluateSetupChecks(result(), "left")).toEqual({
      cameraOn: true,
      upperBodyVisible: true,
      armVisible: true,
      enoughLight: true,
    });
  });

  it("fails everything with no result", () => {
    expect(Object.values(evaluateSetupChecks(null, "left")).some(Boolean)).toBe(false);
  });

  it("looks only at the affected arm", () => {
    const leftHidden = result([POSE.LEFT_WRIST]);

    expect(evaluateSetupChecks(leftHidden, "left").armVisible).toBe(false);
    expect(evaluateSetupChecks(leftHidden, "right").armVisible).toBe(true);
  });

  it("needs the wrist but not the elbow", () => {
    expect(evaluateSetupChecks(result([POSE.LEFT_ELBOW]), "left").armVisible).toBe(true);
  });

  it("needs both shoulders in view", () => {
    expect(evaluateSetupChecks(result([POSE.RIGHT_SHOULDER]), "left").upperBodyVisible).toBe(false);
  });

  it("checks the light", () => {
    expect(evaluateSetupChecks({ ...result(), brightness: 20 }, "left").enoughLight).toBe(false);
  });
});
