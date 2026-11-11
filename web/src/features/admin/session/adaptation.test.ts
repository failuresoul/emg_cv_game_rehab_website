import { describe, expect, it } from "vitest";

import type { AdaptationLogRow } from "@/types/api";

import { adaptationPoints, componentsIn, overrideKinds } from "./adaptation";

function log(trialNo: number, changes: Partial<AdaptationLogRow> = {}): AdaptationLogRow {
  return {
    trial_no: trialNo,
    engine: "L1",
    state_before: { d: { spatial: 0.4, precision: 0.5 } },
    state_after: { d: { spatial: 0.4, precision: 0.5 } },
    params: {},
    decision: "Kept the same difficulty.",
    safety_override: null,
    cue: null,
    trial:
      trialNo === 0
        ? null
        : {
            trial_no: trialNo,
            outcome: "success",
            failure_type: null,
            compensated: false,
            movement_ms: 900,
            completion_ms: null,
            activation_peak: 0.8,
          },
    level: 5,
    created_at: "2026-11-11T10:00:00Z",
    ...changes,
  };
}

describe("overrideKinds", () => {
  it("names each safety rule in the order it was applied", () => {
    expect(
      overrideKinds(
        "Compensation in 2 of the last 3 trials: no harder reach; 3 failures in a row: easier by 0.15; Signs of tiring: easier by 0.1",
      ),
    ).toEqual(["compensation", "failures", "tiring"]);
    expect(overrideKinds("Kept within the patient's maximum (0.6)")).toEqual(["bounds"]);
  });

  it("is empty without an override and ignores unknown parts", () => {
    expect(overrideKinds(null)).toEqual([]);
    expect(overrideKinds("")).toEqual([]);
    expect(overrideKinds("Something new")).toEqual([]);
  });
});

describe("adaptationPoints", () => {
  it("gives each decision's difficulty, level, outcome and flags in trial order", () => {
    const failure = log(2, {
      state_after: { d: { spatial: 0.32, precision: 0.5 } },
      level: 4,
      safety_override: "Signs of tiring: easier by 0.1",
      cue: "rest",
    });
    failure.trial = { ...failure.trial!, outcome: "reach_fail", failure_type: "reach_fail" };
    const points = adaptationPoints([failure, log(0), log(1, { level: 6 })]);

    expect(points.map((point) => point.trialNo)).toEqual([0, 1, 2]);
    expect(points[0]).toEqual({
      trialNo: 0,
      level: 5,
      spatial: 0.4,
      precision: 0.5,
      outcome: null,
      overrides: [],
    });
    expect(points[1]!.outcome).toBe("success");
    expect(points[1]!.level).toBe(6);
    expect(points[2]).toMatchObject({
      spatial: 0.32,
      level: 4,
      outcome: "failure",
      overrides: ["tiring"],
    });
  });

  it("shows no outcome for a stopped trial", () => {
    const stopped = log(1);
    stopped.trial = { ...stopped.trial!, outcome: "aborted" };
    expect(adaptationPoints([stopped])[0]!.outcome).toBeNull();
  });
});

describe("componentsIn", () => {
  it("lists the components used, in drawing order", () => {
    expect(
      componentsIn([
        log(0, { state_after: { d: { precision: 0.5, speed: 0.2 } } }),
        log(1, { state_after: { d: { spatial: 0.3 } } }),
      ]),
    ).toEqual(["spatial", "speed", "precision"]);
    expect(componentsIn([log(0, { state_after: {} })])).toEqual([]);
  });
});
