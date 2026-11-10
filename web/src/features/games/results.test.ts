import { describe, expect, it } from "vitest";

import type { GameRun, GameRunDetail, TrialRead } from "@/types/api";

import {
  bestOfSuccesses,
  DETAIL_HIGHEST_POPPED,
  DETAIL_MEAN_TIME_TO_OPEN,
  DETAIL_WIDEST_CATCH,
  finishedRuns,
  mainMeasure,
  meanReachSeconds,
  movementSeries,
  percent,
  targetMarkers,
  totalScore,
} from "./results";

function run(changes: Partial<GameRun> = {}): GameRun {
  return {
    id: 1,
    session_id: 1,
    game_id: "reach_activate",
    engine: "L0",
    input_source: "cv_grip",
    params_initial: {},
    started_at: "2026-11-09T10:00:00Z",
    ended_at: "2026-11-09T10:05:00Z",
    status: "completed",
    trials_planned: 20,
    trials_done: 20,
    score: 1500,
    summary: {
      successes: 15,
      success_rate: 0.75,
      mean_movement_ms: 1234,
      mean_path_efficiency: 0.8,
      compensated_trials: 2,
    },
    ...changes,
  };
}

function trial(trialNo: number, changes: Partial<TrialRead> = {}): TrialRead {
  return {
    id: trialNo,
    game_run_id: 1,
    created_at: "2026-11-09T10:00:00Z",
    trial_no: trialNo,
    params: {},
    target: {
      x_sw: 0.5,
      y_sw: 0.25,
      radius_sw: 0.45,
      direction_deg: 45,
      distance_frac: 0.7,
      sector: "D1R2",
    },
    outcome: "success",
    timings: {
      spawn: 0,
      move_onset: 300,
      enter: 1500,
      dwell_done: 2000,
      activation_start: 2200,
      activation_done: 2400,
      end: 2400,
    },
    metrics: {
      reaction_ms: 300,
      movement_ms: 1200,
      path_length_sw: 1,
      straight_dist_sw: 0.9,
      path_efficiency: 0.9,
      peak_speed_sw_s: 1.2,
      activation_latency_ms: 200,
      activation_peak: 0.8,
    },
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: [],
    ...changes,
  };
}

describe("game results", () => {
  it("adds up the scores of finished runs only", () => {
    expect(
      totalScore([
        run({ score: 1000 }),
        run({ score: 250, status: "aborted" }),
        run({ status: "active", score: 99 }),
      ]),
    ).toBe(1250);
    expect(totalScore([run({ status: "active" })])).toBeNull();
    expect(totalScore([])).toBeNull();
  });

  it("adds up dashboard games, which are always finished", () => {
    expect(
      totalScore([
        { game_id: "reach_activate", score: 840, success_rate: 0.75 },
        { game_id: "bloom", score: null, success_rate: null },
      ]),
    ).toBe(840);
  });

  it("leaves runs still in progress out of the finished list", () => {
    expect(finishedRuns([run(), run({ status: "active" })])).toHaveLength(1);
  });

  it("gives the average reach time in seconds and the success rate in percent", () => {
    expect(meanReachSeconds(run())).toBe(1.2);
    expect(meanReachSeconds(run({ summary: null }))).toBeNull();
    expect(percent(0.756)).toBe(76);
    expect(percent(null)).toBeNull();
  });

  it("collects every trial's target with its outcome and compensation", () => {
    const detail: GameRunDetail = {
      ...run({ id: 7 }),
      trials: [
        trial(1),
        trial(2, {
          outcome: "reach_fail",
          compensation: { flagged: true, type: "lean", max_values: {} },
        }),
        trial(3, { target: null }),
      ],
    };
    expect(targetMarkers([detail])).toEqual([
      { key: "7-1", x: 0.5, y: 0.25, outcome: "success", compensated: false },
      { key: "7-2", x: 0.5, y: 0.25, outcome: "reach_fail", compensated: true },
    ]);
  });

  it("lists movement time per trial in order, in seconds", () => {
    const series = movementSeries([
      trial(2, { metrics: { ...trial(2).metrics, movement_ms: null }, outcome: "reach_fail" }),
      trial(1, { metrics: { ...trial(1).metrics, movement_ms: 1234 } }),
    ]);
    expect(series).toEqual([
      { trialNo: 1, seconds: 1.23, outcome: "success" },
      { trialNo: 2, seconds: null, outcome: "reach_fail" },
    ]);
  });
});

describe("mainMeasure", () => {
  const summary = run().summary;

  it("is the average reach time for Reach and squeeze", () => {
    expect(mainMeasure("reach_activate", summary)).toEqual({
      labelKey: "measure.meanReach",
      value: { key: "game.results.seconds", params: { value: 1.2 } },
    });
  });

  it("is the highest balloon popped, as a share of the reach, for Balloon pop", () => {
    const withDetails = { ...summary!, details: { [DETAIL_HIGHEST_POPPED]: 0.85 } };
    expect(mainMeasure("balloon_pop", withDetails)).toEqual({
      labelKey: "measure.highestBalloon",
      value: { key: "measure.ofReach", params: { value: 85 } },
    });
  });

  it("is the widest catch, as a share of the reach, for Fruit catch", () => {
    const withDetails = { ...summary!, details: { [DETAIL_WIDEST_CATCH]: 0.7 } };
    expect(mainMeasure("fruit_catch", withDetails).value?.params).toEqual({ value: 70 });
  });

  it("is the average time to open the hand, in seconds, for Bloom", () => {
    const withDetails = { ...summary!, details: { [DETAIL_MEAN_TIME_TO_OPEN]: 1460 } };
    expect(mainMeasure("bloom", withDetails)).toEqual({
      labelKey: "measure.meanTimeToOpen",
      value: { key: "game.results.seconds", params: { value: 1.5 } },
    });
    expect(mainMeasure("bloom", summary).value).toBeNull();
  });

  it("has no value when there is nothing to show yet", () => {
    expect(mainMeasure("balloon_pop", summary).value).toBeNull();
    expect(
      mainMeasure("fruit_catch", { ...summary!, details: { [DETAIL_WIDEST_CATCH]: null } }).value,
    ).toBeNull();
    expect(mainMeasure("reach_activate", null).value).toBeNull();
  });
});

describe("bestOfSuccesses", () => {
  it("takes the largest value among successful trials only", () => {
    expect(
      bestOfSuccesses([
        { outcome: "success", value: 0.55 },
        { outcome: "miss", value: 0.85 },
        { outcome: "success", value: 0.7 },
        { outcome: "success", value: null },
      ]),
    ).toBe(0.7);
    expect(bestOfSuccesses([{ outcome: "miss", value: 1 }])).toBeNull();
  });
});
