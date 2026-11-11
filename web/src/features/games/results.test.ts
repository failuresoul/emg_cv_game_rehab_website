import { describe, expect, it } from "vitest";

import type { GameRun, GameRunDetail, TrialRead } from "@/types/api";

import {
  bestOfSuccesses,
  DETAIL_HIGHEST_POPPED,
  bestFinger,
  DETAIL_BEST_FINGER,
  DETAIL_BEST_OPENNESS,
  DETAIL_NOTE_HIT_RATE,
  DETAIL_WIDEST_CATCH,
  allMeasures,
  DETAIL_BEST_RANGE_DEG,
  DETAIL_BEST_SPARC,
  DETAIL_BEST_STEADINESS,
  DETAIL_MEAN_RELAXATION_MS,
  DETAIL_MEAN_TRANSPORT_MS,
  DETAIL_TOTAL_DROPS,
  DETAIL_MEAN_IN_CORRIDOR,
  DETAIL_TOTAL_STARS,
  extraMeasures,
  fingerHitRates,
  fingerTallies,
  finishedRuns,
  mainMeasure,
  inBandSeries,
  pickPlaceMarkers,
  opennessSeries,
  meanReachSeconds,
  movementSeries,
  percent,
  rangeSeries,
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

  it("is the flowers grown for Bloom, with the best openness beside it", () => {
    const withDetails = { ...summary!, successes: 11, details: { [DETAIL_BEST_OPENNESS]: 0.874 } };
    expect(mainMeasure("bloom", withDetails)).toEqual({
      labelKey: "measure.flowersGrown",
      value: { key: "measure.count", params: { value: 11 } },
    });
    expect(extraMeasures("bloom", withDetails)).toEqual([
      {
        labelKey: "measure.bestOpenness",
        value: { key: "measure.percent", params: { value: 87 } },
      },
    ]);
    expect(mainMeasure("bloom", null).value).toBeNull();
    expect(extraMeasures("bloom", summary)[0].value).toBeNull();
  });

  it("is the hit rate for Finger piano, with the best finger beside it", () => {
    const withDetails = {
      ...summary!,
      details: { [DETAIL_NOTE_HIT_RATE]: 0.8, [DETAIL_BEST_FINGER]: "ring" },
    };
    expect(mainMeasure("finger_piano", withDetails)).toEqual({
      labelKey: "measure.hitRate",
      value: { key: "measure.ofNotes", params: { value: 80 } },
    });
    expect(extraMeasures("finger_piano", withDetails)).toEqual([
      { labelKey: "measure.bestFinger", value: { key: "warmup.sequence.ring", params: {} } },
    ]);
    const unknown = { ...summary!, details: { [DETAIL_BEST_FINGER]: "thumb" } };
    expect(extraMeasures("finger_piano", unknown)[0].value).toBeNull();
  });

  it("is the stars for Path trace, with time in the corridor and best smoothness beside them", () => {
    const withDetails = {
      ...summary!,
      details: {
        [DETAIL_TOTAL_STARS]: 22,
        [DETAIL_MEAN_IN_CORRIDOR]: 81.46,
        [DETAIL_BEST_SPARC]: -1.4567,
      },
    };
    expect(allMeasures("path_trace", withDetails)).toEqual([
      { labelKey: "measure.stars", value: { key: "measure.count", params: { value: 22 } } },
      {
        labelKey: "measure.meanInCorridor",
        value: { key: "measure.percent", params: { value: 81 } },
      },
      {
        labelKey: "measure.bestSmoothness",
        value: { key: "measure.number", params: { value: -1.46 } },
      },
    ]);
    expect(allMeasures("path_trace", summary).map((measure) => measure.value)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("is the stripes finished for Paint the wall, with the best elbow range beside them", () => {
    const withDetails = { ...summary!, successes: 6, details: { [DETAIL_BEST_RANGE_DEG]: 78.6 } };
    expect(allMeasures("paint_wall", withDetails)).toEqual([
      {
        labelKey: "measure.stripesFinished",
        value: { key: "measure.count", params: { value: 6 } },
      },
      {
        labelKey: "measure.bestElbowRange",
        value: { key: "measure.degrees", params: { value: 79 } },
      },
    ]);
  });

  it("is the objects placed for Pick and place, with the drops and average carry time", () => {
    const withDetails = {
      ...summary!,
      successes: 10,
      details: { [DETAIL_TOTAL_DROPS]: 3, [DETAIL_MEAN_TRANSPORT_MS]: 2349 },
    };
    expect(allMeasures("pick_place", withDetails)).toEqual([
      { labelKey: "measure.objectsPlaced", value: { key: "measure.count", params: { value: 10 } } },
      { labelKey: "measure.drops", value: { key: "measure.count", params: { value: 3 } } },
      {
        labelKey: "measure.meanTransport",
        value: { key: "game.results.seconds", params: { value: 2.3 } },
      },
    ]);
    expect(extraMeasures("pick_place", summary).map((measure) => measure.value)).toEqual([
      null,
      null,
    ]);
  });

  it("is the holds completed for Grip and hold, with the steadiest hold and relax time", () => {
    const withDetails = {
      ...summary!,
      successes: 7,
      details: { [DETAIL_BEST_STEADINESS]: 0.0318, [DETAIL_MEAN_RELAXATION_MS]: 840 },
    };
    expect(allMeasures("grip_hold", withDetails)).toEqual([
      { labelKey: "measure.holdsCompleted", value: { key: "measure.count", params: { value: 7 } } },
      {
        labelKey: "measure.bestSteadiness",
        value: { key: "measure.wobble", params: { value: 3.2 } },
      },
      {
        labelKey: "measure.meanRelaxation",
        value: { key: "game.results.seconds", params: { value: 0.8 } },
      },
    ]);
    expect(mainMeasure("grip_hold", null).value).toBeNull();
  });

  it("has no extra figures for the reaching games", () => {
    expect(extraMeasures("reach_activate", summary)).toEqual([]);
    expect(extraMeasures("balloon_pop", summary)).toEqual([]);
    expect(allMeasures("fruit_catch", summary)).toHaveLength(1);
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

describe("Finger piano figures", () => {
  const trial = (outcome: TrialRead["outcome"], perFinger: TrialRead["metrics"]["per_finger"]) => ({
    outcome,
    metrics: { per_finger: perFinger },
  });

  it("adds up each finger's hits and notes over the melodies, leaving out stopped ones", () => {
    const tallies = fingerTallies([
      trial("success", { index: { hits: 2, attempts: 2 }, ring: { hits: 1, attempts: 2 } }),
      trial("miss", { index: { hits: 0, attempts: 1 }, middle: { hits: 1, attempts: 1 } }),
      trial("aborted", { little: { hits: 1, attempts: 1 } }),
      trial("miss", null),
    ]);
    expect(tallies).toEqual([
      { finger: "index", hits: 2, attempts: 3 },
      { finger: "middle", hits: 1, attempts: 1 },
      { finger: "ring", hits: 1, attempts: 2 },
    ]);
  });

  it("picks the finger with the best hit rate, then the one with more notes played", () => {
    expect(
      bestFinger([
        { finger: "index", hits: 2, attempts: 3 },
        { finger: "middle", hits: 1, attempts: 1 },
        { finger: "ring", hits: 2, attempts: 2 },
      ]),
    ).toBe("ring");
    expect(
      bestFinger([
        { finger: "index", hits: 1, attempts: 2 },
        { finger: "little", hits: 2, attempts: 4 },
      ]),
    ).toBe("little");
    expect(bestFinger([{ finger: "index", hits: 0, attempts: 3 }])).toBeNull();
    expect(bestFinger([])).toBeNull();
  });

  it("reads each finger's hit rate from the summary, in finger order", () => {
    const summary = {
      successes: 1,
      success_rate: 0.5,
      mean_movement_ms: null,
      mean_path_efficiency: null,
      compensated_trials: 0,
      details: { hit_rate_ring: 0.5, hit_rate_index: 1, hit_rate_little: null },
    };
    expect(fingerHitRates(summary)).toEqual([
      { finger: "index", rate: 1 },
      { finger: "ring", rate: 0.5 },
    ]);
    expect(fingerHitRates(null)).toEqual([]);
  });
});

describe("opennessSeries", () => {
  it("gives each turn's peak openness and demand as percentages, in turn order", () => {
    const trial = (
      trialNo: number,
      outcome: TrialRead["outcome"],
      peak: number | null,
      demand?: number,
    ) =>
      ({
        trial_no: trialNo,
        outcome,
        metrics: { peak_openness: peak },
        params: demand === undefined ? {} : { open_demand: demand },
      }) as unknown as TrialRead;
    expect(
      opennessSeries([
        trial(2, "miss", 0.55, 0.75),
        trial(1, "success", 0.812, 0.7),
        trial(3, "aborted", 0.2, 0.75),
        trial(4, "miss", null),
      ]),
    ).toEqual([
      { trialNo: 1, peak: 81, demand: 70 },
      { trialNo: 2, peak: 55, demand: 75 },
      { trialNo: 4, peak: null, demand: null },
    ]);
  });
});

describe("rangeSeries", () => {
  it("gives each stripe's elbow range and the range it asked for, in stripe order", () => {
    const trial = (
      trialNo: number,
      outcome: TrialRead["outcome"],
      range: number | null,
      params: Record<string, number>,
    ) =>
      ({
        trial_no: trialNo,
        outcome,
        metrics: { achieved_range_deg: range },
        params,
      }) as unknown as TrialRead;
    const personal = { required_range_frac: 0.75, elbow_bent_deg: 70, elbow_straight_deg: 150 };
    expect(
      rangeSeries([
        trial(2, "miss", 48.24, { ...personal, required_range_frac: 0.8 }),
        trial(1, "success", 66.66, personal),
        trial(3, "aborted", 10, personal),
        trial(4, "miss", null, {}),
      ]),
    ).toEqual([
      { trialNo: 1, range: 66.7, target: 60 },
      { trialNo: 2, range: 48.2, target: 64 },
      { trialNo: 4, range: null, target: null },
    ]);
  });
});

describe("pickPlaceMarkers", () => {
  it("gives each trial's object and box positions, in trial order", () => {
    const base = trial(1);
    const target = { kind: "pick_place", pick: [0.2, 0.8], place: [1, 0.4] } as const;
    const markers = pickPlaceMarkers({
      id: 7,
      trials: [
        {
          ...base,
          trial_no: 2,
          outcome: "miss",
          target: { kind: "pick_place", pick: [0.3, 0.7], place: [0.9, -0.1] },
        },
        { ...base, trial_no: 1, target: { ...target, pick: [0.2, 0.8], place: [1, 0.4] } },
        { ...base, trial_no: 3, target: { kind: "bloom" } },
      ],
    });
    expect(markers).toEqual([
      {
        key: "7-1",
        pick: { x: 0.2, y: 0.8 },
        place: { x: 1, y: 0.4 },
        outcome: "success",
        compensated: base.compensation.flagged,
      },
      {
        key: "7-2",
        pick: { x: 0.3, y: 0.7 },
        place: { x: 0.9, y: -0.1 },
        outcome: "miss",
        compensated: base.compensation.flagged,
      },
    ]);
  });
});

describe("inBandSeries", () => {
  it("gives the time in the band per hold, without stopped holds", () => {
    const base = trial(1);
    const series = inBandSeries([
      {
        ...base,
        trial_no: 2,
        outcome: "miss",
        metrics: { ...base.metrics, time_in_band_pct: 41.26 },
      },
      { ...base, trial_no: 1, metrics: { ...base.metrics, time_in_band_pct: 88 } },
      {
        ...base,
        trial_no: 3,
        outcome: "aborted",
        metrics: { ...base.metrics, time_in_band_pct: 5 },
      },
      { ...base, trial_no: 4, metrics: { ...base.metrics, time_in_band_pct: null } },
    ]);
    expect(series).toEqual([
      { trialNo: 1, inBand: 88, outcome: "success" },
      { trialNo: 2, inBand: 41.3, outcome: "miss" },
      { trialNo: 4, inBand: null, outcome: "success" },
    ]);
  });
});
