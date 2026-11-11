import { describe, expect, it } from "vitest";

import type { GameId, TrialMetrics, TrialTimings } from "@/types/api";

import { record } from "./testRecords";
import { failureType, trialSummary } from "./trialSummary";

describe("failureType", () => {
  it("is null for a success or a stopped trial", () => {
    expect(failureType("reach_activate", record("success"))).toBeNull();
    expect(failureType("bloom", record("aborted"))).toBeNull();
  });

  it("keeps reach and activation failures as they are", () => {
    expect(failureType("reach_activate", record("reach_fail"))).toBe("reach_fail");
    expect(failureType("reach_activate", record("activation_fail"))).toBe("activation_fail");
    expect(failureType("path_trace", record("reach_fail"))).toBe("reach_fail");
  });

  it.each<[GameId, Partial<TrialMetrics>, Partial<TrialTimings>, string]>([
    // Balloon: floated away before it was touched, or touched but not squeezed.
    ["balloon_pop", {}, { enter: null }, "miss"],
    ["balloon_pop", {}, { enter: 1800 }, "activation_fail"],
    ["fruit_catch", {}, {}, "miss"],
    ["bloom", { failed_phase: "open" }, {}, "activation_fail"],
    ["finger_piano", {}, {}, "miss"],
    ["path_trace", { time_in_corridor_pct: 40 }, {}, "reach_fail"],
    // Paint the wall: no full sweep is too much range; some are not enough time.
    ["paint_wall", { full_sweeps: 0 }, {}, "reach_fail"],
    ["paint_wall", { full_sweeps: 2 }, {}, "miss"],
    // Pick and place: never grasped, or grasped but not placed in time.
    ["pick_place", { grasp_latency_ms: null }, {}, "reach_fail"],
    ["pick_place", { grasp_latency_ms: 600 }, {}, "miss"],
    ["grip_hold", { failed_phase: "relax" }, {}, "activation_fail"],
  ])("maps a %s miss to its kind of difficulty", (gameId, metrics, timings, expected) => {
    expect(failureType(gameId, record("miss", metrics, timings))).toBe(expected);
  });
});

describe("trialSummary", () => {
  it("sends the movement time where a game has one", () => {
    const summary = trialSummary(
      "reach_activate",
      record("activation_fail", { movement_ms: 1100, activation_peak: 0.42 }),
    );
    expect(summary).toEqual({
      trial_no: 3,
      outcome: "activation_fail",
      failure_type: "activation_fail",
      compensated: false,
      movement_ms: 1100,
      completion_ms: null,
      activation_peak: 0.42,
    });
  });

  it("sends the completion time and grip peak otherwise", () => {
    const flagged = {
      ...record("success", { peak_grip: 0.7 }, { end: 5200 }),
      compensation: { flagged: true, type: "trunk", max_values: {} },
    };
    expect(trialSummary("bloom", flagged)).toMatchObject({
      failure_type: null,
      compensated: true,
      movement_ms: null,
      completion_ms: 5200,
      activation_peak: 0.7,
    });
    expect(trialSummary("bloom", record("miss", { peak_openness: 0.4 })).activation_peak).toBe(0.4);
    expect(trialSummary("fruit_catch", record("miss", {}, { end: null })).completion_ms).toBeNull();
  });
});
