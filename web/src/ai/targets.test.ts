import { describe, expect, it } from "vitest";

import type { EngineNextResponse, TrialCreate } from "@/types/api";

import { applyTarget, type EngineTarget, TARGET_GAMES, targetLocation, targetOf } from "./targets";
import { record } from "./testRecords";

const target = (changes: Partial<EngineTarget> = {}): EngineTarget => ({
  directionDeg: 90,
  side: null,
  distanceFrac: 0.85,
  sector: "D2R2",
  ...changes,
});

function answer(changes: Partial<EngineNextResponse>): EngineNextResponse {
  return {
    params: {},
    level: 5,
    cue: null,
    decision: "",
    safety_override: null,
    engine: "L2",
    ...changes,
  };
}

describe("targetOf", () => {
  it("reads L2's target, and nothing from engines that do not place targets", () => {
    expect(targetOf(answer({ direction_deg: 135, distance_frac: 0.6, sector: "D3R2" }))).toEqual({
      directionDeg: 135,
      side: null,
      distanceFrac: 0.6,
      sector: "D3R2",
    });
    expect(
      targetOf(answer({ side: "across", distance_frac: 0.5, sector: "across-R1" }))?.side,
    ).toBe("across");
    expect(targetOf(answer({}))).toBeNull();
    expect(targetOf(answer({ direction_deg: null, distance_frac: null }))).toBeNull();
  });
});

describe("applyTarget", () => {
  it("places the target in each game's own terms", () => {
    expect(
      applyTarget("reach_activate", { direction_index: 0, distance_frac: 0.7 }, target()),
    ).toMatchObject({
      direction_index: 2,
      direction_deg: 90,
      distance_frac: 0.85,
    });
    expect(
      applyTarget("balloon_pop", { height_frac: 0.55 }, target({ directionDeg: 135 })),
    ).toMatchObject({ direction_index: 3, direction_deg: 135, height_frac: 0.85 });
    expect(
      applyTarget(
        "fruit_catch",
        { target_side: 1, target_frac: 0.4 },
        target({ directionDeg: null, side: "across" }),
      ),
    ).toMatchObject({ target_side: -1, target_frac: 1, spread_frac: 0.85 });
    expect(
      applyTarget("pick_place", { carry_direction: 0 }, target({ directionDeg: 270 })),
    ).toMatchObject({
      carry_direction: 3,
      pick_distance_frac: 0.85,
    });
    expect(
      applyTarget("path_trace", { direction: 1 }, target({ directionDeg: 180 })),
    ).toMatchObject({
      direction: -1,
      path_length_frac: 0.85,
    });
  });

  it("leaves other games and missing directions alone", () => {
    const params = { open_demand: 0.6 };
    expect(applyTarget("bloom", params, target())).toBe(params);
    expect(applyTarget("reach_activate", params, target({ directionDeg: null }))).toBe(params);
    expect(TARGET_GAMES.has("bloom")).toBe(false);
  });
});

describe("targetLocation", () => {
  it("reports where each game's target was, the inverse of applyTarget", () => {
    const cases: [Parameters<typeof applyTarget>[0], EngineTarget][] = [
      ["reach_activate", target({ directionDeg: 45, distanceFrac: 0.5 })],
      ["balloon_pop", target({ directionDeg: 90, distanceFrac: 0.7 })],
      ["fruit_catch", target({ directionDeg: null, side: "out", distanceFrac: 0.6 })],
      ["pick_place", target({ directionDeg: 180, distanceFrac: 0.65 })],
      ["path_trace", target({ directionDeg: 0, distanceFrac: 0.8 })],
    ];
    for (const [gameId, placed] of cases) {
      const params = applyTarget(gameId, {}, placed);
      const trial = { ...record("success"), params } as TrialCreate;
      const location = targetLocation(gameId, trial);
      expect(location.distance_frac).toBeCloseTo(placed.distanceFrac);
      if (placed.side) expect(location.side).toBe(placed.side);
      else expect(location.direction_deg).toBe(placed.directionDeg);
    }
  });

  it("is empty for games without targets", () => {
    expect(targetLocation("bloom", record("success"))).toEqual({});
  });
});
