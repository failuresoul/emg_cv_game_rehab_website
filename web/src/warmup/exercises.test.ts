import { describe, expect, it } from "vitest";

import { angleBetween } from "@/vision/angles";

import { EXERCISE_ORDER, EXERCISES, getThresholds } from "./exercises";

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
    const frames = EXERCISES[id].demoKeyframes;
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
      const { elbow } = EXERCISES[id].demoKeyframes[index];
      return angleBetween(vector(elbow.x, elbow.y), down);
    };
    const elbowAt = (index: number) => {
      const { shoulder, elbow, wrist } = EXERCISES.elbow_flexion.demoKeyframes[index];
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
