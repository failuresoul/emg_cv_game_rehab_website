import { describe, expect, it } from "vitest";

import type { VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import {
  apertureToLevel,
  CvGripSource,
  DEFAULT_GRIP_REFS,
  GRIP_SMOOTHING_ALPHA,
  gripRefsFromWarmup,
  MIN_GRIP_REF_GAP,
  type VisionFrameSource,
} from "./cvGripSource";

type HandResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

function handResult(changes: Partial<HandResult> = {}): HandResult {
  return {
    exerciseId: "hand_open_close",
    skipped: false,
    bestPeak: 1.8,
    thresholds: { low: 1.2, high: 1.6 },
    ...changes,
  };
}

/** A vision engine that sends frames only when the test asks. */
function fakeEngine() {
  const listeners = new Set<(result: VisionResult) => void>();
  const engine: VisionFrameSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { engine, listeners };
}

const emptyFrame: VisionResult = {
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
};

describe("apertureToLevel", () => {
  it("is 0 for an open hand and 1 for a fist with the default references", () => {
    expect(apertureToLevel(1.6)).toBe(0);
    expect(apertureToLevel(1.1)).toBe(1);
  });

  it("is in between for a half-closed hand", () => {
    expect(apertureToLevel(1.35)).toBeCloseTo(0.5);
    expect(apertureToLevel(1.5)).toBeCloseTo(0.2);
  });

  it("clamps a hand opened wider or closed tighter than the references", () => {
    expect(apertureToLevel(2.0)).toBe(0);
    expect(apertureToLevel(0.8)).toBe(1);
  });

  it("uses custom references", () => {
    const refs = { openRef: 1.4, closedRef: 1.0 };
    expect(apertureToLevel(1.4, refs)).toBe(0);
    expect(apertureToLevel(1.2, refs)).toBeCloseTo(0.5);
    expect(apertureToLevel(1.0, refs)).toBe(1);
  });

  it("is 0 rather than a wrong number for unusable references or values", () => {
    expect(apertureToLevel(1.2, { openRef: 1.1, closedRef: 1.1 })).toBe(0);
    expect(apertureToLevel(1.2, { openRef: 1.0, closedRef: 1.5 })).toBe(0);
    expect(apertureToLevel(Number.NaN)).toBe(0);
  });
});

describe("gripRefsFromWarmup", () => {
  it("takes open from the best peak and closed from the low threshold", () => {
    expect(gripRefsFromWarmup([handResult()])).toEqual({
      openRef: 1.8,
      closedRef: 1.2,
      origin: "warmup",
    });
  });

  it("uses the latest hand open-close result and ignores other exercises", () => {
    const refs = gripRefsFromWarmup([
      handResult({ bestPeak: 1.5 }),
      { ...handResult({ bestPeak: 2.5 }), exerciseId: "shoulder_flexion" },
      handResult({ bestPeak: 1.7, thresholds: { low: 1.15, high: 1.45 } }),
    ]);
    expect(refs).toEqual({ openRef: 1.7, closedRef: 1.15, origin: "warmup" });
  });

  it("keeps a usable range for a hand that barely opened", () => {
    const refs = gripRefsFromWarmup([handResult({ bestPeak: 1.25 })]);
    expect(refs.openRef).toBe(1.25);
    expect(refs.closedRef).toBeCloseTo(1.25 - MIN_GRIP_REF_GAP);
  });

  it.each([
    ["no results", []],
    ["a skipped exercise", [handResult({ skipped: true })]],
    ["no recorded peak", [handResult({ bestPeak: null })]],
  ])("falls back to the defaults with %s", (_, results) => {
    expect(gripRefsFromWarmup(results)).toEqual({ ...DEFAULT_GRIP_REFS, origin: "default" });
  });

  it("gives a level of 0 at the patient's own best opening and 1 at the low threshold", () => {
    const refs = gripRefsFromWarmup([handResult()]);
    expect(apertureToLevel(1.8, refs)).toBe(0);
    expect(apertureToLevel(1.5, refs)).toBeCloseTo(0.5);
    expect(apertureToLevel(1.2, refs)).toBe(1);
  });
});

describe("CvGripSource", () => {
  const create = () => new CvGripSource({ affectedSide: "left", engine: fakeEngine().engine });

  it("is not ready and reads 0 before the hand is seen", () => {
    const source = create();
    expect(source.isReady()).toBe(false);
    expect(source.getLevel()).toBe(0);
  });

  it("takes the first visible frame as it is, then smooths with alpha 0.5", () => {
    const source = create();
    source.pushAperture(1.35); // 0.5
    expect(source.isReady()).toBe(true);
    expect(source.getLevel()).toBeCloseTo(0.5);

    source.pushAperture(1.1); // 1
    expect(source.getLevel()).toBeCloseTo(GRIP_SMOOTHING_ALPHA * 1 + 0.5 * 0.5);
    source.pushAperture(1.1);
    expect(source.getLevel()).toBeCloseTo(0.875);
  });

  it("reads 0 and is not ready when the hand is lost, and starts afresh when it returns", () => {
    const source = create();
    source.pushAperture(1.1);
    source.pushAperture(null);
    expect(source.isReady()).toBe(false);
    expect(source.getLevel()).toBe(0);

    source.pushAperture(1.35);
    expect(source.getLevel()).toBeCloseTo(0.5);
  });

  it("uses custom references", () => {
    const source = new CvGripSource({
      affectedSide: "left",
      engine: fakeEngine().engine,
      refs: { openRef: 1.8, closedRef: 1.2 },
    });
    source.pushAperture(1.5);
    expect(source.getLevel()).toBeCloseTo(0.5);
  });

  it("tells listeners each new level", () => {
    const source = create();
    const levels: number[] = [];
    const unsubscribe = source.subscribe((level) => levels.push(level));
    source.pushAperture(1.6);
    source.pushAperture(null);
    unsubscribe();
    source.pushAperture(1.1);
    expect(levels).toEqual([0, 0]);
  });

  it("listens to the engine only between start and stop", () => {
    const { engine, listeners } = fakeEngine();
    const source = new CvGripSource({ affectedSide: "left", engine });
    source.start();
    source.start();
    expect(listeners.size).toBe(1);

    // No hand in the frame: not ready.
    source.pushAperture(1.1);
    listeners.forEach((listener) => listener(emptyFrame));
    expect(source.isReady()).toBe(false);
    expect(source.getLevel()).toBe(0);

    source.stop();
    expect(listeners.size).toBe(0);
  });
});
