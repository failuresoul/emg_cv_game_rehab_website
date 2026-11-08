import { describe, expect, it } from "vitest";

import { angleBetween } from "@/vision/angles";

import { EXERCISE_ORDER, type ExerciseId, EXERCISES, getThresholds } from "./exercises";

function armFrames(id: ExerciseId) {
  const { demo } = EXERCISES[id];
  if (demo.kind !== "arm") throw new Error(`${id} has no arm demo`);
  return demo.keyframes;
}

describe("exercise definitions", () => {
  it("have the agreed thresholds", () => {
    const { shoulder_flexion: flexion, shoulder_abduction: abduction } = EXERCISES;
    const { elbow_flexion: elbow } = EXERCISES;

    expect(flexion.presets).toEqual({
      standard: { low: 30, high: 90 },
      gentle: { low: 30, high: 60 },
    });
    expect(abduction.presets).toEqual({
      standard: { low: 30, high: 80 },
      gentle: { low: 30, high: 50 },
    });
    expect(elbow.presets).toEqual({
      standard: { low: 70, high: 140 },
      gentle: { low: 90, high: 125 },
    });
  });

  it("have the agreed measures and planes", () => {
    expect(EXERCISES.shoulder_flexion.measure).toBe("armElevationDeg");
    expect(EXERCISES.shoulder_flexion.preferredPlane).toEqual({
      minDeg: 50,
      maxDeg: 130,
      feedback: "forward",
    });
    expect(EXERCISES.shoulder_abduction.preferredPlane).toEqual({
      minDeg: -30,
      maxDeg: 40,
      feedback: "sideways",
    });
    expect(EXERCISES.elbow_flexion.measure).toBe("elbowFlexionDeg");
    expect(EXERCISES.elbow_flexion.direction).toBe("down");
    expect(EXERCISES.elbow_flexion.tipKey).toBeDefined();
  });

  it.each(EXERCISE_ORDER)("%s has 10 reps, 90 seconds and 3 steps", (id) => {
    const exercise = EXERCISES[id];

    expect(exercise.id).toBe(id);
    expect(exercise.targetReps).toBe(10);
    expect(exercise.maxDurationSec).toBe(90);
    expect(exercise.instructionKeys).toHaveLength(3);
  });

  it.each(EXERCISE_ORDER)("%s has a demo that loops and keeps the arm's length", (id) => {
    const frames = armFrames(id);
    const first = frames[0];
    const last = frames[frames.length - 1];

    expect(first.time).toBe(0);
    expect(last.time).toBe(1);
    expect(last.wrist.x).toBeCloseTo(first.wrist.x);
    expect(last.wrist.y).toBeCloseTo(first.wrist.y);
    for (const { shoulder, elbow, wrist } of frames) {
      expect(Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)).toBeCloseTo(0.9);
      expect(Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y)).toBeCloseTo(0.8);
    }
  });

  it("demo movements go past the thresholds they teach", () => {
    const vector = (x: number, y: number) => ({ x, y, z: 0 });
    const down = vector(0, -1);
    const elevationAt = (id: "shoulder_flexion" | "shoulder_abduction", index: number) => {
      const { elbow } = armFrames(id)[index];
      return angleBetween(vector(elbow.x, elbow.y), down);
    };
    const elbowAt = (index: number) => {
      const { shoulder, elbow, wrist } = armFrames("elbow_flexion")[index];
      return angleBetween(
        vector(shoulder.x - elbow.x, shoulder.y - elbow.y),
        vector(wrist.x - elbow.x, wrist.y - elbow.y),
      );
    };

    expect(elevationAt("shoulder_flexion", 0)).toBeLessThan(30);
    expect(elevationAt("shoulder_flexion", 2)).toBeGreaterThan(90);
    expect(elevationAt("shoulder_abduction", 2)).toBeGreaterThan(80);
    expect(elbowAt(0)).toBeGreaterThan(140);
    expect(elbowAt(2)).toBeLessThan(70);
  });
});

describe("hand and reach exercises", () => {
  it("have the agreed measures and thresholds", () => {
    const { forward_reach: reach, hand_open_close: open, thumb_opposition: thumb } = EXERCISES;

    expect(reach.measure).toBe("forwardReachRatio");
    expect(reach.direction).toBe("up");
    expect(reach.presets).toEqual({
      standard: { low: 0.45, high: 0.8 },
      gentle: { low: 0.4, high: 0.65 },
    });
    expect(open.measure).toBe("handApertureRatio");
    expect(open.direction).toBe("up");
    expect(open.presets).toEqual({
      standard: { low: 1.2, high: 1.6 },
      gentle: { low: 1.15, high: 1.45 },
    });
    expect(thumb.counter).toBe("sequence");
    expect(thumb.measure).toBe("thumbFingerDistances");
    expect(thumb.targetReps).toBe(5);
    // Touch below low; let go above low + 0.15.
    expect(thumb.presets.standard.low).toBe(0.25);
    expect(thumb.presets.standard.high).toBeCloseTo(0.4);
    expect(thumb.presets.gentle.low).toBe(0.35);
    expect(thumb.presets.gentle.high).toBeCloseTo(0.5);
  });

  it("use a hysteresis suited to ratios", () => {
    for (const id of ["forward_reach", "hand_open_close"] as const) {
      const { hysteresis, presets } = EXERCISES[id];
      expect(hysteresis).toBeDefined();
      expect(hysteresis ?? Infinity).toBeLessThan((presets.gentle.high - presets.gentle.low) / 4);
    }
  });

  it.each(["hand_open_close", "thumb_opposition"] as const)(
    "%s has a looping hand demo with five fingers",
    (id) => {
      const { demo } = EXERCISES[id];
      if (demo.kind !== "hand") throw new Error(`${id} should have a hand demo`);
      const first = demo.keyframes[0];
      const last = demo.keyframes[demo.keyframes.length - 1];

      expect(first.time).toBe(0);
      expect(last.time).toBe(1);
      expect(last.tips).toEqual(first.tips);
      for (const frame of demo.keyframes) expect(frame.tips).toHaveLength(5);
    },
  );

  it("the opposition demo touches the thumb to each finger in turn", () => {
    const { demo } = EXERCISES.thumb_opposition;
    if (demo.kind !== "hand") throw new Error("thumb_opposition should have a hand demo");

    for (let finger = 1; finger <= 4; finger++) {
      const { tips } = demo.keyframes[finger];
      expect(tips[0]).toEqual(tips[finger]);
    }
  });

  it("the forward reach demo has an arm of constant length", () => {
    for (const { shoulder, elbow, wrist } of armFrames("forward_reach")) {
      expect(Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)).toBeCloseTo(0.9);
      expect(Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y)).toBeCloseTo(0.8);
    }
  });
});

describe("getThresholds", () => {
  it("returns the preset's values", () => {
    expect(getThresholds(EXERCISES.shoulder_flexion, "standard")).toEqual({ low: 30, high: 90 });
    expect(getThresholds(EXERCISES.elbow_flexion, "gentle")).toEqual({ low: 90, high: 125 });
  });

  it("ignores history for now", () => {
    expect(getThresholds(EXERCISES.shoulder_abduction, "gentle", [])).toEqual({
      low: 30,
      high: 50,
    });
  });
});
