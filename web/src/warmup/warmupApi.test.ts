import { describe, expect, it } from "vitest";

import type { WarmupResult } from "@/types/api";

import { ExerciseRunner, type ExerciseResult } from "./exerciseRunner";
import { ALL_EXERCISE_IDS, type ExerciseId, EXERCISES } from "./exercises";
import { personaliseThresholds, type WarmupHistoryEntry } from "./personalise";
import { cycles, FRAME_MS } from "./testSignals";
import { historiesBefore, saveRetryDelay, toHistoryEntry, toWarmupPayload } from "./warmupApi";

function result(changes: Partial<ExerciseResult> = {}): ExerciseResult {
  return {
    exerciseId: "shoulder_flexion",
    preset: "standard",
    thresholds: { low: 30, high: 90 },
    personalisation: null,
    reps: [
      {
        index: 1,
        startTs: 0,
        peakTs: 1000,
        endTs: 2500,
        durationMs: 2500,
        peakValue: 101,
        rawPeakValue: 104,
        reachedTarget: true,
        compensated: true,
        compensationTypes: ["trunk", "shoulder"],
        compensationMax: { trunkDisplacement: 0.2, trunkLeanDeg: 4, shoulderHike: 0.1 },
      },
    ],
    fullReps: 1,
    partialReps: 0,
    compensatedReps: 1,
    compensationRate: 1,
    bestPeak: 101,
    bestRawPeak: 104,
    meanDurationMs: 2500,
    activeTimeMs: 40_000,
    pausedTimeMs: 0,
    measureSource: "3d",
    trunkReference: "vertical",
    skipped: false,
    ...changes,
  };
}

describe("toWarmupPayload", () => {
  it("saves unfiltered peaks, the unit and the compensation of each rep", () => {
    const payload = toWarmupPayload(result());

    expect(payload).toMatchObject({
      exercise_id: "shoulder_flexion",
      preset: "standard",
      thresholds: { low: 30, high: 90, unit: "deg" },
      personalisation: null,
      target_reps: 10,
      best_peak: 104,
      trunk_reference: "vertical",
      compensated_reps: 1,
      compensation_rate: 1,
    });
    expect(payload.reps).toEqual([
      {
        index: 1,
        peak: 104,
        duration_ms: 2500,
        compensated: true,
        compensation_type: "trunk+shoulder",
      },
    ]);
  });

  it("saves the personalisation and its reason", () => {
    const personalisation = personaliseThresholds(EXERCISES.shoulder_flexion, [
      {
        fullReps: 10,
        targetReps: 10,
        compensationRate: 0.1,
        bestPeak: 120,
        thresholds: { low: 30, high: 90 },
      },
    ]);

    const payload = toWarmupPayload(
      result({ preset: "personal", thresholds: { low: 30, high: 95 }, personalisation }),
    );

    expect(payload.preset).toBe("personal");
    expect(payload.personalisation).toEqual({
      previous_high: 90,
      new_high: 95,
      reason: "raised: 10/10 reps, 10% compensated",
    });
  });

  it("uses the exercise's own unit and n/a for the trunk in hand exercises", () => {
    const payload = toWarmupPayload(
      result({
        exerciseId: "hand_open_close",
        thresholds: { low: 1.2, high: 1.6 },
        trunkReference: null,
        reps: [],
      }),
    );

    expect(payload.thresholds.unit).toBe("palm_ratio");
    expect(payload.trunk_reference).toBe("n/a");
    expect(payload.reps).toEqual([]);
  });

  it("gives no compensation type to an upright rep", () => {
    const [rep] = result().reps;
    const payload = toWarmupPayload(
      result({ reps: [{ ...rep, compensated: false, compensationTypes: [] }] }),
    );

    expect(payload.reps[0].compensation_type).toBeNull();
  });

  it("saves a real runner's result in a form the server accepts", () => {
    const runner = new ExerciseRunner(EXERCISES.thumb_opposition, "personal", { history: [] });
    runner.startCountdown(-3000);
    runner.update({ timestamp: 0, value: null, values: [0.9, 0.9, 0.9, 0.9] });
    runner.skip(FRAME_MS);
    const finished = runner.getResult();
    if (!finished) throw new Error("no result");

    const payload = toWarmupPayload(finished);

    expect(payload).toMatchObject({
      exercise_id: "thumb_opposition",
      preset: "standard",
      thresholds: { low: 0.25, unit: "palm_ratio" },
      personalisation: {
        previous_high: null,
        new_high: 0.25,
        reason: "first time: standard target",
      },
      target_reps: 5,
      skipped: true,
      trunk_reference: "n/a",
    });
    expect(payload.thresholds.low).toBeLessThan(payload.thresholds.high);
  });
});

describe("toHistoryEntry", () => {
  it("takes what personalisation needs from a saved result", () => {
    const saved = {
      ...toWarmupPayload(result()),
      id: 1,
      session_id: 2,
      created_at: "2026-11-09T10:00:00Z",
    } satisfies WarmupResult;

    expect(toHistoryEntry(saved)).toEqual({
      fullReps: 1,
      targetReps: 10,
      compensationRate: 1,
      bestPeak: 104,
      thresholds: { low: 30, high: 90 },
      sessionId: 2,
    });
  });
});

describe("historiesBefore", () => {
  it("leaves out the given session, so a warm-up is not compared with itself", () => {
    const today = { ...toHistoryEntry({ ...savedResult(), session_id: 7 }) };
    const before = { ...toHistoryEntry({ ...savedResult(), session_id: 6 }) };
    const histories = Object.fromEntries(
      ALL_EXERCISE_IDS.map((id) => [id, id === "shoulder_flexion" ? [today, before] : []]),
    ) as Record<ExerciseId, WarmupHistoryEntry[]>;

    expect(historiesBefore(histories, 7).shoulder_flexion).toEqual([before]);
    expect(historiesBefore(histories, null).shoulder_flexion).toEqual([today, before]);
  });
});

function savedResult(): WarmupResult {
  return { ...toWarmupPayload(result()), id: 1, session_id: 2, created_at: "2026-11-09T10:00:00Z" };
}

describe("ExerciseRunner with a personal target", () => {
  it("counts against the personalised threshold and records why", () => {
    const history = [
      {
        fullReps: 10,
        targetReps: 10,
        compensationRate: 0,
        bestPeak: 130,
        thresholds: { low: 30, high: 90 },
      },
    ];
    const runner = new ExerciseRunner(EXERCISES.shoulder_flexion, "personal", { history });
    runner.startCountdown(-3000);
    runner.update({ timestamp: 0, value: 10 });

    // Peaks of 93 would reach the standard 90, but not today's 95.
    for (const { value, timestamp } of cycles({ rest: 10, peak: 93, cycles: 2, startTs: 33 })) {
      runner.update({ timestamp, value });
    }

    expect(runner.currentThresholds).toEqual({ low: 30, high: 95 });
    expect(runner.fullReps).toBe(0);
    runner.skip(7000);
    expect(runner.getResult()).toMatchObject({
      preset: "personal",
      thresholds: { low: 30, high: 95 },
      partialReps: 2,
      personalisation: { previousHigh: 90, newHigh: 95, reason: "raised" },
    });
  });
});

describe("saveRetryDelay", () => {
  it("backs off 1, 2 and 4 seconds", () => {
    expect([0, 1, 2].map(saveRetryDelay)).toEqual([1000, 2000, 4000]);
  });
});
