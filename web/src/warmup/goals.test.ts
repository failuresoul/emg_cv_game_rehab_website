import { describe, expect, it } from "vitest";

import type { WarmupResult } from "@/types/api";

import type { ExerciseResult } from "./exerciseRunner";
import { EXERCISES } from "./exercises";
import {
  changeVsLast,
  compensationLevel,
  encouragement,
  goalMove,
  goalReached,
  goalText,
  rowsFromResults,
  rowsFromSaved,
  shortGoal,
  type WarmupRow,
} from "./goals";
import { personaliseThresholds, type WarmupHistoryEntry } from "./personalise";

const FLEXION = EXERCISES.shoulder_flexion;
const ELBOW = EXERCISES.elbow_flexion;
const OPEN = EXERCISES.hand_open_close;
const THUMB = EXERCISES.thumb_opposition;

function entry(changes: Partial<WarmupHistoryEntry> = {}): WarmupHistoryEntry {
  return {
    fullReps: 10,
    targetReps: 10,
    compensationRate: 0,
    bestPeak: 120,
    thresholds: { low: 30, high: 80 },
    ...changes,
  };
}

describe("goalReached", () => {
  it("needs 90% of the target reps, like the server", () => {
    expect(goalReached(10, 10)).toBe(true);
    expect(goalReached(9, 10)).toBe(true);
    expect(goalReached(8, 10)).toBe(false);
    expect(goalReached(5, 5)).toBe(true);
    expect(goalReached(4, 5)).toBe(false);
  });

  it("is never reached for a skipped exercise or no target", () => {
    expect(goalReached(10, 10, true)).toBe(false);
    expect(goalReached(3, 0)).toBe(false);
  });
});

describe("goalMove", () => {
  it("follows the exercise's direction", () => {
    expect(goalMove(FLEXION, 85, 80)).toBe("harder");
    expect(goalMove(FLEXION, 75, 80)).toBe("easier");
    // Bending further means a smaller angle, and a closer touch a smaller distance.
    expect(goalMove(ELBOW, 65, 70)).toBe("harder");
    expect(goalMove(THUMB, 0.22, 0.25)).toBe("harder");
    expect(goalMove(FLEXION, 80, 80)).toBe("same");
  });
});

describe("goalText", () => {
  it("names the angle, the change and last time's reps", () => {
    const targets = personaliseThresholds(FLEXION, [entry()]);

    expect(goalText(FLEXION, targets.newHigh, targets)).toBe(
      "Today's goal: raise to 85° (up from 80°) — you did 10 of 10 last time",
    );
  });

  it("says when the target is lower or the same", () => {
    const lower = personaliseThresholds(FLEXION, [entry({ fullReps: 4 })]);
    const same = personaliseThresholds(FLEXION, [entry({ fullReps: 7 })]);

    expect(goalText(FLEXION, lower.newHigh, lower)).toContain("(down from 80°)");
    expect(goalText(FLEXION, same.newHigh, same)).toContain("(same as last time)");
  });

  it("asks to bend the elbow, and gives reach as a share of the arm", () => {
    const elbow = personaliseThresholds(ELBOW, [
      entry({ bestPeak: 50, thresholds: { low: 70, high: 140 } }),
    ]);
    const reach = EXERCISES.forward_reach;

    expect(goalText(ELBOW, elbow.newHigh, elbow)).toContain("bend to 65° (down from 70°)");
    expect(goalText(reach, 0.8, null)).toBe("Today's goal: reach 80% of your arm's length");
  });

  it("welcomes a first time", () => {
    const targets = personaliseThresholds(FLEXION, []);

    expect(goalText(FLEXION, targets.newHigh, targets)).toBe(
      "First time — we'll find your comfortable range",
    );
  });

  it("describes hand goals in words, never as a ratio", () => {
    const wider = personaliseThresholds(OPEN, [
      entry({ bestPeak: 1.9, thresholds: { low: 1.2, high: 1.6 } }),
    ]);
    const closer = personaliseThresholds(THUMB, [
      entry({ targetReps: 5, fullReps: 5, bestPeak: 0.1, thresholds: { low: 0.25, high: 0.4 } }),
    ]);

    const openText = goalText(OPEN, wider.newHigh, wider);
    const touchText = goalText(THUMB, closer.newHigh, closer);

    expect(openText).toContain("open your hand a little wider than last time");
    expect(touchText).toContain("a little more closely than last time");
    for (const text of [openText, touchText]) expect(text).not.toMatch(/\d\.\d/);
  });
});

describe("changeVsLast", () => {
  it("compares in the exercise's better direction, ignoring small noise", () => {
    expect(changeVsLast(FLEXION, 95, 90)).toBe("better");
    expect(changeVsLast(FLEXION, 91, 90)).toBe("same");
    expect(changeVsLast(FLEXION, 80, 90)).toBe("lower");
    expect(changeVsLast(ELBOW, 60, 70)).toBe("better");
    expect(changeVsLast(OPEN, 1.61, 1.6)).toBe("same");
    expect(changeVsLast(FLEXION, 90, null)).toBeNull();
  });
});

describe("compensationLevel", () => {
  it("matches the personalisation thresholds", () => {
    expect(compensationLevel(0.1)).toBe("low");
    expect(compensationLevel(0.2)).toBe("some");
    expect(compensationLevel(0.3)).toBe("some");
    expect(compensationLevel(0.31)).toBe("high");
  });
});

function result(changes: Partial<ExerciseResult> = {}): ExerciseResult {
  return {
    exerciseId: "shoulder_flexion",
    preset: "personal",
    thresholds: { low: 30, high: 85 },
    personalisation: personaliseThresholds(FLEXION, [entry()]),
    reps: [],
    fullReps: 10,
    partialReps: 0,
    compensatedReps: 0,
    compensationRate: 0.1,
    bestPeak: 98,
    bestRawPeak: 100,
    meanDurationMs: 2500,
    activeTimeMs: 40_000,
    pausedTimeMs: 0,
    measureSource: "3d",
    trunkReference: "hip",
    skipped: false,
    ...changes,
  };
}

describe("rows", () => {
  it("come from today's results, compared with last time", () => {
    const [row] = rowsFromResults([result()], { shoulder_flexion: entry({ bestPeak: 90 }) });

    expect(row).toEqual({
      exerciseId: "shoulder_flexion",
      preset: "personal",
      skipped: false,
      fullReps: 10,
      targetReps: 10,
      best: 100,
      target: 85,
      previousTarget: 80,
      firstTime: false,
      goalReached: true,
      compensationRate: 0.1,
      change: "better",
    });
  });

  it("have no change for a skipped exercise", () => {
    const [row] = rowsFromResults([result({ skipped: true, fullReps: 0 })], {
      shoulder_flexion: entry(),
    });

    expect(row.change).toBeNull();
    expect(row.goalReached).toBe(false);
  });

  it("come from a saved session, using the target line for each direction", () => {
    const saved: WarmupResult = {
      id: 1,
      session_id: 2,
      created_at: "2026-11-09T10:00:00Z",
      exercise_id: "elbow_flexion",
      preset: "standard",
      thresholds: { low: 70, high: 140, unit: "deg" },
      personalisation: { previous_high: null, new_high: 70, reason: "first time: standard target" },
      full_reps: 9,
      partial_reps: 1,
      target_reps: 10,
      best_peak: 62,
      mean_duration_ms: 2000,
      active_time_ms: 30_000,
      paused_time_ms: 0,
      measure_source: "3d",
      trunk_reference: "hip",
      compensated_reps: 0,
      compensation_rate: 0,
      reps: [],
      skipped: false,
    };

    const [row] = rowsFromSaved([saved]);

    expect(row.target).toBe(70);
    expect(row.firstTime).toBe(true);
    expect(row.goalReached).toBe(true);
    expect(row.change).toBeNull();
  });
});

describe("shortGoal", () => {
  const row = (changes: Partial<WarmupRow>): WarmupRow => ({
    exerciseId: "hand_open_close",
    preset: "personal",
    skipped: false,
    fullReps: 10,
    targetReps: 10,
    best: 1.7,
    target: 1.65,
    previousTarget: 1.6,
    firstTime: false,
    goalReached: true,
    compensationRate: 0,
    change: null,
    ...changes,
  });

  it("gives angles in degrees and hands in words", () => {
    expect(shortGoal(row({ exerciseId: "shoulder_flexion", target: 85 }))).toBe("85°");
    expect(shortGoal(row({}))).toBe("A little wider");
    expect(shortGoal(row({ target: 1.6 }))).toBe("Same as last time");
    expect(shortGoal(row({ firstTime: true }))).toBe("Comfortable range");
    expect(shortGoal(row({ preset: "gentle", previousTarget: null }))).toBe("Easier setting");
    expect(
      shortGoal(row({ exerciseId: "thumb_opposition", target: 0.22, previousTarget: 0.25 })),
    ).toBe("A little closer");
  });
});

describe("encouragement", () => {
  const row = (changes: Partial<WarmupRow>): WarmupRow => ({
    exerciseId: "shoulder_flexion",
    preset: "personal",
    skipped: false,
    fullReps: 10,
    targetReps: 10,
    best: 90,
    target: 85,
    previousTarget: 80,
    firstTime: false,
    goalReached: true,
    compensationRate: 0,
    change: null,
    ...changes,
  });
  const missed = { goalReached: false, fullReps: 3 };

  it("praises every goal reached", () => {
    expect(encouragement([row({}), row({})]).key).toBe("encourage.allGoals");
  });

  it("notices doing better than last time", () => {
    const rows = [row({ ...missed, change: "better" }), row({ ...missed, change: "better" })];

    expect(encouragement(rows)).toEqual({ key: "encourage.better", params: { count: 2 } });
  });

  it("counts most goals reached", () => {
    const rows = [row({}), row({}), row(missed), row(missed)];

    expect(encouragement(rows)).toEqual({ key: "encourage.most", params: { count: 2, total: 4 } });
  });

  it("thanks for any effort, and for joining in with nothing done", () => {
    expect(encouragement([row(missed), row(missed), row({})]).key).toBe("encourage.effort");
    expect(encouragement([row({ skipped: true })]).key).toBe("encourage.thanks");
    expect(encouragement([]).key).toBe("encourage.thanks");
  });
});
