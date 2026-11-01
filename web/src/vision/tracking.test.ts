import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";

import { HAND, POSE } from "./landmarks";
import { StableShoulderWidth, Tracker, type TrackerInput } from "./tracking";

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

function landmark(x: number, y: number, visibility = 1): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

/** Shoulders 160 px apart, with the person's own left on the image's right. */
function makePose(offsetX = 0, leftVisibility = 1): NormalizedLandmark[] {
  const pose = Array.from({ length: 33 }, () => landmark(0.5, 0.5));
  pose[POSE.LEFT_SHOULDER] = landmark(0.625 + offsetX, 0.5, leftVisibility);
  pose[POSE.RIGHT_SHOULDER] = landmark(0.375 + offsetX, 0.5);
  return pose;
}

function makeHand(x: number, y: number): NormalizedLandmark[] {
  const hand = Array.from({ length: 21 }, () => landmark(0, 0));
  hand[HAND.INDEX_TIP] = landmark(x, y);
  return hand;
}

function input(timestamp: number, overrides: Partial<TrackerInput> = {}): TrackerInput {
  return {
    timestamp,
    hand: null,
    pose: makePose(),
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    ...overrides,
  };
}

describe("StableShoulderWidth", () => {
  it("ignores single outliers", () => {
    const width = new StableShoulderWidth();
    for (let i = 0; i < 29; i++) width.add(160);

    expect(width.add(900)).toBe(160);
    expect(width.add(5)).toBe(160);
  });

  it("uses only the last 30 frames", () => {
    const width = new StableShoulderWidth();
    for (let i = 0; i < 30; i++) width.add(100);
    for (let i = 0; i < 30; i++) width.add(200);

    expect(width.value()).toBe(200);
  });

  it("has no value before the first valid frame", () => {
    expect(new StableShoulderWidth().value()).toBeNull();
  });
});

describe("Tracker", () => {
  it("gives the same +x for the same outward reach on both affected sides", () => {
    const left = new Tracker("left").process(input(0, { hand: [...makeHand(0.875, 0.5)] }));
    const right = new Tracker("right").process(input(0, { hand: [...makeHand(0.125, 0.5)] }));

    expect(left.fingertipRawSw?.x).toBeCloseTo(1);
    expect(left.fingertipRawSw?.y).toBeCloseTo(0);
    expect(right.fingertipRawSw?.x).toBeCloseTo(1);
    expect(right.fingertipRawSw?.y).toBeCloseTo(0);
  });

  it("reports +y when the fingertip is above the shoulder", () => {
    const state = new Tracker("left").process(input(0, { hand: makeHand(0.625, 0.25) }));

    expect(state.fingertipRawSw?.y).toBeCloseTo(0.75);
  });

  it("keeps the raw position separate from the smoothed cursor", () => {
    const tracker = new Tracker("left");
    tracker.process(input(0, { hand: makeHand(0.625, 0.5) }));

    const state = tracker.process(input(33, { hand: makeHand(0.875, 0.5) }));

    expect(state.fingertipRawSw?.x).toBeCloseTo(1);
    expect(state.fingertipSmoothSw?.x).toBeGreaterThan(0);
    expect(state.fingertipSmoothSw?.x).toBeLessThan(1);
  });

  it("marks the hand lost after 500 ms and never invents raw positions", () => {
    const tracker = new Tracker("left");
    tracker.process(input(1000, { hand: makeHand(0.7, 0.5) }));

    const brief = tracker.process(input(1499));
    expect(brief.handPresent).toBe(true);
    expect(brief.handLostMs).toBe(499);
    expect(brief.fingertipRawSw).toBeNull();
    expect(brief.fingertipSmoothSw).not.toBeNull();

    const lost = tracker.process(input(1500));
    expect(lost.handPresent).toBe(false);
    expect(lost.handLostMs).toBe(500);
    expect(lost.fingertipRawSw).toBeNull();
    expect(lost.fingertipSmoothSw).toBeNull();
  });

  it("jumps the cursor to the new position when the hand returns after being lost", () => {
    const tracker = new Tracker("left");
    tracker.process(input(0, { hand: makeHand(0.625, 0.5) }));
    tracker.process(input(600));

    const state = tracker.process(input(633, { hand: makeHand(0.875, 0.5) }));

    expect(state.handPresent).toBe(true);
    expect(state.handLostMs).toBe(0);
    expect(state.fingertipSmoothSw?.x).toBeCloseTo(1);
  });

  it("counts lost time from the start if the hand was never seen", () => {
    const tracker = new Tracker("left");
    tracker.process(input(1000));

    const state = tracker.process(input(1200));

    expect(state.handPresent).toBe(false);
    expect(state.handLostMs).toBe(200);
  });

  it("flags a bad pose, keeps the last frame and has no trunk position", () => {
    const tracker = new Tracker("left");
    const good = tracker.process(input(0));

    const hidden = tracker.process(input(33, { pose: makePose(0, 0.1) }));
    const missing = tracker.process(input(66, { pose: null }));

    expect(good.poseOk).toBe(true);
    expect(hidden.poseOk).toBe(false);
    expect(missing.poseOk).toBe(false);
    expect(hidden.frame).toEqual(good.frame);
    expect(hidden.trunkMidpointSw).toBeNull();
  });

  it("has no frame or fingertip until the shoulders are seen", () => {
    const state = new Tracker("left").process(input(0, { pose: null, hand: makeHand(0.5, 0.5) }));

    expect(state.frame).toBeNull();
    expect(state.shoulderWidthPx).toBeNull();
    expect(state.fingertipRawSw).toBeNull();
    expect(state.handPresent).toBe(true);
  });

  it("measures trunk movement from the task start, in the outward direction", () => {
    const left = new Tracker("left");
    const right = new Tracker("right");
    // 0.0625 of the frame width is 40 px, or 0.25 SW, toward the image's right.
    left.process(input(0));
    right.process(input(0));

    const leftMoved = left.process(input(33, { pose: makePose(0.0625) }));
    const rightMoved = right.process(input(33, { pose: makePose(0.0625) }));

    // That is outward for a left-affected patient and inward for a right-affected one.
    expect(leftMoved.trunkMidpointSw?.x).toBeCloseTo(0.25);
    expect(rightMoved.trunkMidpointSw?.x).toBeCloseTo(-0.25);
  });

  it("restarts the trunk position when a new task starts", () => {
    const tracker = new Tracker("left");
    tracker.process(input(0));
    tracker.process(input(33, { pose: makePose(0.0625) }));

    tracker.markTaskStart();
    const state = tracker.process(input(66, { pose: makePose(0.0625) }));

    expect(state.trunkMidpointSw).toEqual({ x: 0, y: 0 });
  });
});
