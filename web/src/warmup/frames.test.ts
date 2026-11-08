import { describe, expect, it } from "vitest";

import type { JointAngleState } from "@/vision/measures";

import { EXERCISES } from "./exercises";
import { displayValue, frameForExercise } from "./frames";

const quality = { source: "3d", trunkReference: "hip", confidence: 0.9 } as const;

function state(withHand = true): JointAngleState {
  return {
    timestamp: 1000,
    raw: {
      armElevationDeg: { value: 61, ...quality },
      elevationPlaneDeg: { value: 80, ...quality },
      elbowFlexionDeg: { value: 151, ...quality },
      forwardReachRatio: { value: 0.71, ...quality },
    },
    filtered: {
      armElevationDeg: 60,
      elevationPlaneDeg: 79,
      elbowFlexionDeg: 150,
      forwardReachRatio: 0.7,
    },
    hand: withHand
      ? {
          raw: { handApertureRatio: 1.51, thumbFingerDistances: [0.21, 0.6, 0.8, 1], source: "2d" },
          filtered: { handApertureRatio: 1.5, thumbFingerDistances: [0.2, 0.6, 0.8, 1] },
        }
      : { raw: null, filtered: { handApertureRatio: null, thumbFingerDistances: null } },
  };
}

describe("frameForExercise", () => {
  it("counts the filtered arm measure and keeps the raw one", () => {
    expect(frameForExercise(EXERCISES.forward_reach, state())).toEqual({
      timestamp: 1000,
      value: 0.7,
      rawValue: 0.71,
      planeDeg: 79,
      source: "3d",
      trunkReference: "hip",
    });
  });

  it("takes the hand's aperture for opening and closing, with no trunk reference", () => {
    const frame = frameForExercise(EXERCISES.hand_open_close, state());

    expect(frame.value).toBe(1.5);
    expect(frame.rawValue).toBe(1.51);
    expect(frame.source).toBe("2d");
    expect(frame.trunkReference).toBeNull();
  });

  it("takes all four thumb distances for opposition", () => {
    const frame = frameForExercise(EXERCISES.thumb_opposition, state());

    expect(frame.value).toBeNull();
    expect(frame.values).toEqual([0.2, 0.6, 0.8, 1]);
    expect(frame.rawValues).toEqual([0.21, 0.6, 0.8, 1]);
  });

  it("gives no measure when the hand is not visible", () => {
    expect(frameForExercise(EXERCISES.hand_open_close, state(false)).value).toBeNull();
    expect(frameForExercise(EXERCISES.thumb_opposition, state(false)).values).toBeNull();
  });

  it("shows no single value for a sequence", () => {
    expect(displayValue(EXERCISES.shoulder_flexion, state())).toBe(60);
    expect(displayValue(EXERCISES.thumb_opposition, state())).toBeNull();
  });
});
