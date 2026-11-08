import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";

import { computeHandMeasures, selectAffectedHand } from "./hand";
import { HAND, POSE } from "./landmarks";
import type { DetectedHand } from "./visionEngine";

const WIDTH = 640;
const HEIGHT = 480;
// Shoulders 0.2 of the width apart: one shoulder width is 128 px.
const SHOULDER_WIDTH_PX = 0.2 * WIDTH;

/**
 * A raw camera image of a person facing it: their own left is on the right of the image. Each
 * wrist can be placed, and hidden by giving it low visibility.
 */
function pose(
  leftWrist = { x: 0.7, y: 0.6 },
  rightWrist = { x: 0.3, y: 0.6 },
  wristVisibility = 1,
) {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  landmarks[POSE.LEFT_SHOULDER] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
  landmarks[POSE.RIGHT_SHOULDER] = { x: 0.4, y: 0.3, z: 0, visibility: 1 };
  landmarks[POSE.LEFT_WRIST] = { ...leftWrist, z: 0, visibility: wristVisibility };
  landmarks[POSE.RIGHT_WRIST] = { ...rightWrist, z: 0, visibility: wristVisibility };
  return landmarks;
}

/** An image-only hand whose wrist is at this point. */
function handAt(x: number, y: number, handedness: string | null = null): DetectedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y: y - 0.05, z: 0, visibility: 0 }));
  landmarks[HAND.WRIST] = { x, y, z: 0, visibility: 0 };
  return { landmarks, worldLandmarks: null, handedness };
}

const select = (hands: DetectedHand[], side: "left" | "right", poseLandmarks = pose()) =>
  selectAffectedHand({ hands, pose: poseLandmarks, frameWidth: WIDTH, frameHeight: HEIGHT }, side);

describe("selectAffectedHand", () => {
  it("picks the hand nearest the affected wrist, whatever its handedness says", () => {
    // MediaPipe calls both hands "Left" here; only the position matters.
    const near = handAt(0.71, 0.6, "Left");
    const far = handAt(0.3, 0.6, "Left");

    expect(select([far, near], "left")).toBe(near);
    expect(select([far, near], "right")).toBe(far);
  });

  it("treats a hand more than half a shoulder width away as not visible", () => {
    const offset = (0.55 * SHOULDER_WIDTH_PX) / WIDTH;

    expect(select([handAt(0.7 + offset, 0.6)], "left")).toBeNull();
  });

  it("accepts a hand just under half a shoulder width away", () => {
    const offset = (0.45 * SHOULDER_WIDTH_PX) / WIDTH;

    expect(select([handAt(0.7 + offset, 0.6)], "left")).not.toBeNull();
  });

  it("returns null with no hands, or when the affected wrist is hidden", () => {
    expect(select([], "left")).toBeNull();
    expect(select([handAt(0.7, 0.6)], "left", pose(undefined, undefined, 0.2))).toBeNull();
  });

  it("returns null without a pose to compare with", () => {
    expect(
      selectAffectedHand(
        { hands: [handAt(0.7, 0.6)], pose: null, frameWidth: WIDTH, frameHeight: HEIGHT },
        "left",
      ),
    ).toBeNull();
  });
});

const PALM_M = 0.08;

/**
 * A world-landmark hand: wrist at the origin, middle knuckle one palm length up (y is down), and
 * fingertips fanned out at `tipPalms` palm lengths from the wrist. The thumb tip can be moved.
 */
function worldHand(tipPalms: number, thumbTip?: Landmark): DetectedHand {
  const world: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  world[HAND.MIDDLE_MCP] = { x: 0, y: -PALM_M, z: 0, visibility: 0 };
  const tips = [HAND.THUMB_TIP, HAND.INDEX_TIP, HAND.MIDDLE_TIP, HAND.RING_TIP, HAND.PINKY_TIP];
  tips.forEach((tip, index) => {
    const angle = ((index - 2) * 20 * Math.PI) / 180;
    world[tip] = {
      x: Math.sin(angle) * tipPalms * PALM_M,
      y: -Math.cos(angle) * tipPalms * PALM_M,
      z: 0,
      visibility: 0,
    };
  });
  if (thumbTip) world[HAND.THUMB_TIP] = thumbTip;
  return { landmarks: handAt(0.5, 0.5).landmarks, worldLandmarks: world, handedness: null };
}

describe("computeHandMeasures", () => {
  it("gives about 1.0 for a fist and 1.8 for an open hand", () => {
    const fist = computeHandMeasures(worldHand(1), WIDTH, HEIGHT);
    const open = computeHandMeasures(worldHand(1.8), WIDTH, HEIGHT);

    expect(fist?.handApertureRatio).toBeCloseTo(1, 5);
    expect(open?.handApertureRatio).toBeCloseTo(1.8, 5);
    expect(open?.source).toBe("3d");
  });

  it("measures the thumb to each finger in palm lengths", () => {
    // The thumb tip on the index fingertip.
    const base = worldHand(1.8);
    const indexTip = base.worldLandmarks?.[HAND.INDEX_TIP];
    const hand = worldHand(1.8, indexTip);
    const measures = computeHandMeasures(hand, WIDTH, HEIGHT);

    const middleTip = hand.worldLandmarks?.[HAND.MIDDLE_TIP];
    const expectedMiddle =
      indexTip && middleTip
        ? Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y) / PALM_M
        : NaN;
    expect(measures?.thumbFingerDistances[0]).toBeCloseTo(0, 5);
    expect(measures?.thumbFingerDistances[1]).toBeCloseTo(expectedMiddle, 5);
    expect(measures?.thumbFingerDistances[3]).toBeGreaterThan(
      measures?.thumbFingerDistances[1] ?? 0,
    );
  });

  it("does not depend on how far the hand is from the camera", () => {
    const near = worldHand(1.5);
    const far: DetectedHand = {
      ...near,
      worldLandmarks:
        near.worldLandmarks?.map((point) => ({ ...point, x: point.x * 3, y: point.y * 3 })) ?? null,
    };

    expect(computeHandMeasures(far, WIDTH, HEIGHT)?.handApertureRatio).toBeCloseTo(
      computeHandMeasures(near, WIDTH, HEIGHT)?.handApertureRatio ?? NaN,
      5,
    );
  });

  it("falls back to image landmarks, correcting the aspect ratio", () => {
    // Palm 0.1 of the height (48 px) upward; every fingertip 0.075 of the width (48 px) sideways.
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    landmarks[HAND.MIDDLE_MCP] = { x: 0.5, y: 0.4, z: 0, visibility: 0 };
    for (const tip of [
      HAND.THUMB_TIP,
      HAND.INDEX_TIP,
      HAND.MIDDLE_TIP,
      HAND.RING_TIP,
      HAND.PINKY_TIP,
    ]) {
      landmarks[tip] = { x: 0.575, y: 0.5, z: 0, visibility: 0 };
    }

    const measures = computeHandMeasures(
      { landmarks, worldLandmarks: null, handedness: null },
      WIDTH,
      HEIGHT,
    );

    expect(measures?.source).toBe("2d");
    expect(measures?.handApertureRatio).toBeCloseTo(1, 5);
  });

  it("returns null with no hand, too few landmarks or no palm", () => {
    expect(computeHandMeasures(null, WIDTH, HEIGHT)).toBeNull();
    expect(
      computeHandMeasures(
        {
          landmarks: handAt(0.5, 0.5).landmarks.slice(0, 5),
          worldLandmarks: null,
          handedness: null,
        },
        WIDTH,
        HEIGHT,
      ),
    ).toBeNull();
    const flat = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    expect(
      computeHandMeasures(
        { landmarks: handAt(0.5, 0.5).landmarks, worldLandmarks: flat, handedness: null },
        WIDTH,
        HEIGHT,
      ),
    ).toBeNull();
  });
});
