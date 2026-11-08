import { describe, expect, it } from "vitest";

import { t } from "@/i18n";

import { EXERCISES, getTargets, getThresholds } from "./exercises";
import {
  personaliseThresholds,
  reasonSummary,
  reasonTexts,
  stepFor,
  type WarmupHistoryEntry,
} from "./personalise";

const FLEXION = EXERCISES.shoulder_flexion;
const ELBOW = EXERCISES.elbow_flexion;
const THUMB = EXERCISES.thumb_opposition;

function entry(changes: Partial<WarmupHistoryEntry> = {}): WarmupHistoryEntry {
  return {
    fullReps: 10,
    targetReps: 10,
    compensationRate: 0,
    bestPeak: 120,
    thresholds: { low: 30, high: 90 },
    ...changes,
  };
}

describe("personaliseThresholds", () => {
  it("uses the standard preset the first time", () => {
    const targets = personaliseThresholds(FLEXION, []);

    expect(targets).toMatchObject({
      low: 30,
      high: 90,
      preset: "standard",
      previousHigh: null,
      newHigh: 90,
      reason: "first_time",
      change: 0,
    });
  });

  it("raises by one step after 10/10 with little compensation", () => {
    const targets = personaliseThresholds(FLEXION, [entry({ compensationRate: 0.1 })]);

    expect(targets).toMatchObject({
      low: 30,
      high: 95,
      preset: "personal",
      previousHigh: 90,
      newHigh: 95,
      reason: "raised",
      limit: null,
      step: 5,
      change: 1,
    });
  });

  it("lowers by one step after 5/10", () => {
    const targets = personaliseThresholds(FLEXION, [entry({ fullReps: 5 })]);

    expect(targets.high).toBe(85);
    expect(targets.reason).toBe("lowered_reps");
  });

  it("lowers after a lot of compensation, even with 10/10", () => {
    const targets = personaliseThresholds(FLEXION, [entry({ compensationRate: 0.4 })]);

    expect(targets.high).toBe(85);
    expect(targets.reason).toBe("lowered_compensation");
  });

  it("keeps the target between the two rules", () => {
    // 7/10 is not enough to raise, and not few enough to lower.
    const targets = personaliseThresholds(FLEXION, [
      entry({ fullReps: 7, compensationRate: 0.25 }),
    ]);

    expect(targets.high).toBe(90);
    expect(targets.reason).toBe("kept");
    expect(targets.change).toBe(0);
  });

  it("does not raise with compensation between 0.2 and 0.3", () => {
    expect(personaliseThresholds(FLEXION, [entry({ compensationRate: 0.2 })]).reason).toBe("kept");
  });

  it("decides from the most recent result only", () => {
    const targets = personaliseThresholds(FLEXION, [
      entry({ fullReps: 10, thresholds: { low: 30, high: 85 } }),
      entry({ fullReps: 2 }),
    ]);

    expect(targets.previousHigh).toBe(85);
    expect(targets.high).toBe(90);
  });

  it("never goes past the best peak so far plus one step", () => {
    const targets = personaliseThresholds(FLEXION, [
      entry({ bestPeak: 86 }),
      entry({ bestPeak: 88 }),
    ]);

    // 95 would be the next step, but the best peak was 88.
    expect(targets.high).toBe(93);
    expect(targets.limit).toBe("best_peak");
    expect(targets.reason).toBe("raised");
  });

  it("says a limit set the target when it held the target below what was asked", () => {
    // Asked to raise 90 to 95, but the best peak was only 80, so the target comes down to 85.
    const targets = personaliseThresholds(FLEXION, [entry({ bestPeak: 80 })]);

    expect(targets.high).toBe(85);
    expect(targets.change).toBe(1);
    expect(targets.reason).toBe("limited");
    expect(reasonTexts(targets).map((text) => text.key)).toEqual([
      "warmup.reason.limited",
      "warmup.reason.limitBest",
    ]);
    expect(reasonSummary(targets)).toBe(
      "adjusted: 10/10 reps, 0% compensated; limited by best peak",
    );
  });

  it("never goes more than 15% past the standard target", () => {
    const targets = personaliseThresholds(FLEXION, [
      entry({ thresholds: { low: 30, high: 102 }, bestPeak: 140 }),
    ]);

    expect(targets.high).toBeCloseTo(103.5);
    expect(targets.limit).toBe("standard_max");
  });

  it("never goes below the gentle preset", () => {
    const targets = personaliseThresholds(FLEXION, [
      entry({ fullReps: 2, thresholds: { low: 30, high: 62 } }),
    ]);

    expect(targets.high).toBe(60);
    expect(targets.limit).toBe("gentle_floor");
    expect(targets.reason).toBe("lowered_reps");
  });

  it("keeps the floor even when the best peak is below it", () => {
    const targets = personaliseThresholds(FLEXION, [
      entry({ fullReps: 1, bestPeak: 40, thresholds: { low: 30, high: 60 } }),
    ]);

    expect(targets.high).toBe(60);
    expect(targets.limit).toBe("gentle_floor");
  });

  it("keeps at least a 25-degree gap between low and high", () => {
    // Shoulder abduction rests below 30, and its gentle target is 50: only 20 above.
    const targets = personaliseThresholds(EXERCISES.shoulder_abduction, [
      entry({ fullReps: 2, thresholds: { low: 30, high: 55 } }),
    ]);

    expect(targets.high).toBe(50);
    expect(targets.low).toBe(25);
  });

  it("keeps at least a 0.2 gap for ratios", () => {
    const reach = EXERCISES.forward_reach;
    const targets = personaliseThresholds(reach, [
      entry({ fullReps: 2, bestPeak: 0.9, thresholds: { low: 0.45, high: 0.65 } }),
    ]);

    expect(targets.high).toBe(0.65);
    expect(targets.high - targets.low).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });

  it("steps ratio measures by 0.05", () => {
    const aperture = EXERCISES.hand_open_close;
    const targets = personaliseThresholds(aperture, [
      entry({ bestPeak: 1.9, thresholds: { low: 1.2, high: 1.6 } }),
    ]);

    expect(stepFor(aperture)).toBe(0.05);
    expect(targets.high).toBe(1.65);
  });

  it("makes the elbow bend further to raise, and keeps its rest line", () => {
    const harder = personaliseThresholds(ELBOW, [
      entry({ bestPeak: 55, thresholds: { low: 70, high: 140 } }),
    ]);
    const easier = personaliseThresholds(ELBOW, [
      entry({ fullReps: 3, bestPeak: 85, thresholds: { low: 88, high: 140 } }),
    ]);

    expect(harder).toMatchObject({ low: 65, high: 140, previousHigh: 70, newHigh: 65 });
    // 93 would be easier than the gentle target of 90.
    expect(easier).toMatchObject({ low: 90, limit: "gentle_floor" });
  });

  it("makes the thumb's touch distance smaller to raise, and larger to lower", () => {
    const base = { thresholds: { low: 0.25, high: 0.4 }, targetReps: 5, bestPeak: 0.1 };
    const harder = personaliseThresholds(THUMB, [entry({ ...base, fullReps: 5 })]);
    const easier = personaliseThresholds(THUMB, [entry({ ...base, fullReps: 2 })]);

    expect(stepFor(THUMB)).toBe(0.03);
    expect(harder.low).toBeCloseTo(0.22);
    expect(easier.low).toBeCloseTo(0.28);
    // The release line keeps its 0.15 gap above the touch line.
    expect(harder.high).toBeCloseTo(0.37);
    expect(easier.high).toBeCloseTo(0.43);
  });

  it("limits the thumb by its best touch and by the gentle touch distance", () => {
    const tight = personaliseThresholds(THUMB, [
      entry({ fullReps: 5, targetReps: 5, bestPeak: 0.24, thresholds: { low: 0.25, high: 0.4 } }),
    ]);
    const loose = personaliseThresholds(THUMB, [
      entry({ fullReps: 0, targetReps: 5, bestPeak: 0.3, thresholds: { low: 0.34, high: 0.49 } }),
    ]);

    // 0.22 is harder than the closest touch so far (0.24) minus one step.
    expect(tight.low).toBeCloseTo(0.22);
    expect(tight.limit).toBeNull();
    expect(loose.low).toBeCloseTo(0.35);
    expect(loose.limit).toBe("gentle_floor");
  });

  it.each([
    ["first time", []],
    ["raised", [entry()]],
    ["lowered for reps", [entry({ fullReps: 5 })]],
    ["lowered for compensation", [entry({ compensationRate: 0.5 })]],
    ["kept", [entry({ fullReps: 7 })]],
    ["limited", [entry({ bestPeak: 80 })]],
  ])("gives a reason when %s", (_, history) => {
    const targets = personaliseThresholds(FLEXION, history);
    const texts = reasonTexts(targets);

    expect(texts.length).toBeGreaterThan(0);
    for (const { key, params } of texts) {
      const text = t(key, params);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[{}]/);
    }
    expect(reasonSummary(targets).length).toBeGreaterThan(0);
  });

  it("puts the numbers in the reason", () => {
    const targets = personaliseThresholds(FLEXION, [entry({ fullReps: 5 })]);

    expect(t(reasonTexts(targets)[0].key, reasonTexts(targets)[0].params)).toContain("5/10");
    expect(reasonSummary(targets)).toBe("lowered: 5/10 reps, 0% compensated");
    expect(reasonSummary(personaliseThresholds(FLEXION, []))).toBe("first time: standard target");
  });
});

describe("getTargets", () => {
  it("personalises only the personal preset", () => {
    const history = [entry()];

    expect(getThresholds(FLEXION, "standard", history)).toEqual({ low: 30, high: 90 });
    expect(getThresholds(FLEXION, "gentle", history)).toEqual({ low: 30, high: 60 });
    expect(getThresholds(FLEXION, "personal", history)).toEqual({ low: 30, high: 95 });
  });

  it("falls back to standard for a personal preset with no history", () => {
    const targets = getTargets(FLEXION, "personal", []);

    expect(targets.preset).toBe("standard");
    expect(targets.thresholds).toEqual({ low: 30, high: 90 });
    expect(targets.personalisation?.reason).toBe("first_time");
  });

  it("has no personalisation for a fixed preset", () => {
    expect(getTargets(FLEXION, "gentle", [entry()]).personalisation).toBeNull();
  });
});
