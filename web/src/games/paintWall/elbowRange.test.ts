import { describe, expect, it } from "vitest";

import type { ExerciseResult } from "@/warmup/exerciseRunner";

import {
  angleAtHeight,
  brushHeight,
  DEFAULT_ELBOW_RANGE,
  elbowRangeFromWarmup,
  MIN_ELBOW_RANGE_DEG,
} from "./elbowRange";
import { paintWallDefaults, readParams } from "./params";

type ElbowResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

const elbow = (changes: Partial<ElbowResult> = {}): ElbowResult => ({
  exerciseId: "elbow_flexion",
  skipped: false,
  bestPeak: 55,
  thresholds: { low: 70, high: 140 },
  ...changes,
});

describe("elbowRangeFromWarmup", () => {
  it("takes the most bent from the best peak and the most straight from the high threshold", () => {
    expect(elbowRangeFromWarmup([elbow()])).toEqual({
      bentDeg: 55,
      straightDeg: 140,
      origin: "warmup",
    });
  });

  it("uses the latest elbow flexion result and ignores other exercises", () => {
    const range = elbowRangeFromWarmup([
      elbow({ bestPeak: 90 }),
      { ...elbow({ bestPeak: 20 }), exerciseId: "shoulder_flexion" },
      elbow({ bestPeak: 62, thresholds: { low: 80, high: 135 } }),
    ]);
    expect(range).toMatchObject({ bentDeg: 62, straightDeg: 135 });
  });

  it("keeps at least a 30° range for a patient who barely bent", () => {
    const range = elbowRangeFromWarmup([
      elbow({ bestPeak: 125, thresholds: { low: 110, high: 140 } }),
    ]);
    expect(range.straightDeg - range.bentDeg).toBeGreaterThanOrEqual(MIN_ELBOW_RANGE_DEG);
    expect(range.bentDeg).toBe(125);
  });

  it.each([
    ["no results", []],
    ["a skipped exercise", [elbow({ skipped: true })]],
    ["no recorded peak", [elbow({ bestPeak: null })]],
  ])("falls back to 70° and 150° with %s", (_, results) => {
    expect(elbowRangeFromWarmup(results)).toEqual({ ...DEFAULT_ELBOW_RANGE, origin: "default" });
  });

  it("becomes the game's starting settings, or none without a warm-up", () => {
    expect(paintWallDefaults([elbow()])).toEqual({ elbow_bent_deg: 55, elbow_straight_deg: 140 });
    expect(paintWallDefaults([])).toEqual({});
    expect(readParams({ elbow_bent_deg: 55, elbow_straight_deg: 140 }).range).toEqual({
      bentDeg: 55,
      straightDeg: 140,
    });
    // A range the wrong way round falls back to the defaults.
    expect(readParams({ elbow_bent_deg: 150, elbow_straight_deg: 70 }).range).toEqual(
      DEFAULT_ELBOW_RANGE,
    );
  });
});

describe("brushHeight", () => {
  it("puts a straight arm at the bottom and the patient's most bent at the top", () => {
    expect(brushHeight(150, DEFAULT_ELBOW_RANGE)).toBe(0);
    expect(brushHeight(70, DEFAULT_ELBOW_RANGE)).toBe(1);
    expect(brushHeight(110, DEFAULT_ELBOW_RANGE)).toBeCloseTo(0.5);
  });

  it("uses the patient's own range", () => {
    const range = { bentDeg: 100, straightDeg: 160 };
    expect(brushHeight(130, range)).toBeCloseTo(0.5);
    // With the default range the same angle would be lower on the wall.
    expect(brushHeight(130, DEFAULT_ELBOW_RANGE)).toBeCloseTo(0.25);
  });

  it("stays on the wall for angles past either end", () => {
    expect(brushHeight(175, DEFAULT_ELBOW_RANGE)).toBe(0);
    expect(brushHeight(40, DEFAULT_ELBOW_RANGE)).toBe(1);
    expect(brushHeight(Number.NaN, DEFAULT_ELBOW_RANGE)).toBe(0);
  });

  it("goes back from a height to the angle", () => {
    expect(angleAtHeight(0.75, DEFAULT_ELBOW_RANGE)).toBe(90);
    expect(brushHeight(angleAtHeight(0.3, DEFAULT_ELBOW_RANGE), DEFAULT_ELBOW_RANGE)).toBeCloseTo(
      0.3,
    );
  });
});
