import { describe, expect, it, vi } from "vitest";

import type { VisionResult } from "@/vision/visionEngine";

import { affectedHandMeasures } from "./cvApertureSource";

const measures = {
  handApertureRatio: 1.5,
  thumbFingerDistances: [0.2, 0.5, 0.7, 0.9] as [number, number, number, number],
  source: "3d" as const,
};

vi.mock("@/vision/hand", () => ({
  selectAffectedHand: vi.fn(() => null),
  computeHandMeasures: vi.fn(() => measures),
}));

const { computeHandMeasures, selectAffectedHand } = await import("@/vision/hand");

const frame = (): VisionResult => ({
  timestamp: 0,
  hand: null,
  hands: [],
  pose: null,
  poseWorld: null,
  fps: 30,
  delegate: "GPU",
  brightness: null,
  frameWidth: 640,
  frameHeight: 480,
});

describe("affectedHandMeasures", () => {
  it("works out each frame's hand once, however many sources ask", () => {
    const result = frame();
    // Grip, openness and touch all read the same frame.
    expect(affectedHandMeasures(result, "left")).toBe(measures);
    expect(affectedHandMeasures(result, "left")).toBe(measures);
    expect(affectedHandMeasures(result, "left")).toBe(measures);
    expect(computeHandMeasures).toHaveBeenCalledTimes(1);
    expect(selectAffectedHand).toHaveBeenCalledTimes(1);

    // A new frame, or the other side, is worked out afresh.
    affectedHandMeasures(frame(), "left");
    affectedHandMeasures(result, "right");
    expect(computeHandMeasures).toHaveBeenCalledTimes(3);
  });
});
