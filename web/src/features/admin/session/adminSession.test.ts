import { describe, expect, it } from "vitest";

import type { TrialRead } from "@/types/api";

import { stripX } from "./FruitStrip";
import { outcomeLabelKey } from "./outcomes";
import { columnsFor, compensationText } from "./trialColumns";

const RANGE = { min: -0.6, max: 1.3 };

describe("stripX", () => {
  it("puts outward on the right for a right-affected patient, as in the mirror view", () => {
    expect(stripX(RANGE.min, RANGE, "right", 640, 40)).toBe(40);
    expect(stripX(RANGE.max, RANGE, "right", 640, 40)).toBe(600);
    expect(stripX(0, RANGE, "right", 640, 40)).toBeCloseTo(40 + (0.6 / 1.9) * 560);
  });

  it("puts outward on the left for a left-affected patient", () => {
    expect(stripX(RANGE.max, RANGE, "left", 640, 40)).toBe(40);
    expect(stripX(RANGE.min, RANGE, "left", 640, 40)).toBe(600);
  });
});

describe("trial table columns", () => {
  const keys = (gameId: Parameters<typeof columnsFor>[0]) =>
    columnsFor(gameId).map((column) => column.key);

  it("shows each game's own measures", () => {
    expect(keys("reach_activate")).toContain("adminSession.column.latency");
    expect(keys("balloon_pop")).toContain("adminSession.column.armElevation");
    expect(keys("balloon_pop")).toContain("adminSession.column.height");
    expect(keys("fruit_catch")).toEqual(
      expect.arrayContaining([
        "adminSession.column.side",
        "adminSession.column.lateralDistance",
        "adminSession.column.lateralEfficiency",
        "adminSession.column.overshoot",
      ]),
    );
    expect(keys("fruit_catch")).not.toContain("adminSession.column.sector");
  });

  it("falls back to the reaching columns for other games", () => {
    expect(keys("grip_hold")).toEqual(keys("reach_activate"));
  });

  it("shows the hand measures for Bloom", () => {
    expect(keys("bloom")).toEqual([
      "adminSession.column.timeToOpen",
      "adminSession.column.peakOpenness",
      "adminSession.column.holdStability",
      "adminSession.column.timeToClose",
      "adminSession.column.outcome",
      "adminSession.column.failedPhase",
      "adminSession.column.compensated",
    ]);
  });

  it("shows the notes for Finger piano", () => {
    expect(keys("finger_piano")).toEqual([
      "adminSession.column.melody",
      "adminSession.column.notesHit",
      "adminSession.column.wrongFinger",
      "adminSession.column.missedNotes",
      "adminSession.column.timingError",
      "adminSession.column.outcome",
      "adminSession.column.compensated",
    ]);
  });

  it("shows the tracing measures for Path trace and the elbow measures for Paint the wall", () => {
    expect(keys("path_trace")).toEqual([
      "adminSession.column.shape",
      "adminSession.column.inCorridor",
      "adminSession.column.trackingError",
      "adminSession.column.lag",
      "adminSession.column.sparc",
      "adminSession.column.outcome",
      "adminSession.column.compensated",
    ]);
    expect(keys("paint_wall")).toEqual([
      "adminSession.column.elbowRange",
      "adminSession.column.sweeps",
      "adminSession.column.meanSweep",
      "adminSession.column.angularSparc",
      "adminSession.column.upperArm",
      "adminSession.column.outcome",
      "adminSession.column.compensated",
    ]);
  });

  it("names compensation in words", () => {
    const trial = (flagged: boolean, type: string | null) =>
      ({ compensation: { flagged, type, max_values: {} } }) as unknown as TrialRead;
    expect(compensationText(trial(false, null))).toBe("No");
    expect(compensationText(trial(true, "trunk+lean"))).toBe("Trunk moved, Trunk leaned");
    expect(compensationText(trial(true, "wobble"))).toBe("wobble");
  });
});

describe("outcome labels", () => {
  it("uses each game's own words", () => {
    expect(outcomeLabelKey("balloon_pop", "success")).toBe("outcome.popped");
    expect(outcomeLabelKey("balloon_pop", "miss")).toBe("outcome.miss");
    expect(outcomeLabelKey("fruit_catch", "success")).toBe("outcome.caught");
    expect(outcomeLabelKey("fruit_catch", "miss")).toBe("outcome.notCaught");
    expect(outcomeLabelKey("reach_activate", "reach_fail")).toBe("outcome.reachFail");
  });
});
