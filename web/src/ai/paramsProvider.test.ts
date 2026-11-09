import { describe, expect, it } from "vitest";

import { GAMES } from "@/games/shared/registry";
import type { TrialHistoryEntry } from "@/games/shared/types";

import { DIRECTIONS_DEG, FixedProvider } from "./paramsProvider";

const specsFor = (id: keyof typeof GAMES) => GAMES[id].params;

/** Asks for one trial after another, as a game does, and returns each trial's direction. */
function directions(provider: FixedProvider, count: number): number[] {
  const history: TrialHistoryEntry[] = [];
  const result: number[] = [];
  for (let trialNo = 1; trialNo <= count; trialNo++) {
    const params = provider.nextParams("reach_activate", history);
    result.push(params.direction_index);
    history.push({
      trialNo,
      params,
      outcome: "success",
      metrics: {} as TrialHistoryEntry["metrics"],
    });
  }
  return result;
}

describe("FixedProvider", () => {
  it("returns every setting at its default", () => {
    const provider = new FixedProvider({ specsFor, seed: 1 });
    const params = provider.nextParams("bloom", []);
    expect(params).toEqual({ demand: 0.5, hold_ms: 1500, rest_ms: 3000 });
    expect(provider.engine).toBe("L0");
  });

  it("adds a direction only for reach_activate", () => {
    const provider = new FixedProvider({ specsFor, seed: 1 });
    expect(provider.nextParams("balloon_pop", [])).not.toHaveProperty("direction_deg");
    const params = provider.nextParams("reach_activate", []);
    expect(params.distance_frac).toBe(0.7);
    expect(DIRECTIONS_DEG[params.direction_index]).toBe(params.direction_deg);
  });

  it("visits all eight directions in every block of eight trials", () => {
    const order = directions(new FixedProvider({ specsFor, seed: 42 }), 32);
    for (let block = 0; block < 4; block++) {
      const slice = order.slice(block * 8, block * 8 + 8);
      expect([...slice].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("shuffles the order, rather than going round in a circle", () => {
    const orders = [1, 2, 3, 4, 5].map((seed) =>
      directions(new FixedProvider({ specsFor, seed }), 8).join(","),
    );
    expect(orders).not.toContain("0,1,2,3,4,5,6,7");
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it("never repeats a direction from one block to the next", () => {
    for (let seed = 0; seed < 200; seed++) {
      const order = directions(new FixedProvider({ specsFor, seed }), 24);
      expect(order[8]).not.toBe(order[7]);
      expect(order[16]).not.toBe(order[15]);
    }
  });

  it("gives the same order for the same seed", () => {
    const first = directions(new FixedProvider({ specsFor, seed: 7 }), 16);
    const second = directions(new FixedProvider({ specsFor, seed: 7 }), 16);
    expect(first).toEqual(second);
  });

  it("gives the same direction when asked again for the same trial", () => {
    const provider = new FixedProvider({ specsFor, seed: 3 });
    const once = provider.nextParams("reach_activate", []);
    const again = provider.nextParams("reach_activate", []);
    expect(again.direction_index).toBe(once.direction_index);
  });
});
