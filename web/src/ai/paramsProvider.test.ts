import { describe, expect, it } from "vitest";

import { GAMES } from "@/games/shared/registry";
import type { TrialHistoryEntry } from "@/games/shared/types";

import {
  BALLOON_DIRECTIONS_DEG,
  BALLOON_HEIGHT_FRACS,
  DIRECTIONS_DEG,
  FixedProvider,
  FRUIT_TARGET_FRACS,
} from "./paramsProvider";

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
    expect(params).toEqual({
      open_demand: 0.7,
      open_hold_ms: 800,
      close_demand: 0.6,
      phase_time_limit_ms: 8000,
      close_hold_ms: 300,
      rest_ms: 1500,
    });
    expect(provider.engine).toBe("L0");
  });

  it("adds a direction only for games that place targets by direction", () => {
    const provider = new FixedProvider({ specsFor, seed: 1 });
    expect(provider.nextParams("bloom", [])).not.toHaveProperty("direction_deg");
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

/** Asks for one balloon after another and returns each one's direction and height. */
function balloons(provider: FixedProvider, count: number): string[] {
  const history: TrialHistoryEntry[] = [];
  const result: string[] = [];
  for (let trialNo = 1; trialNo <= count; trialNo++) {
    const params = provider.nextParams("balloon_pop", history);
    result.push(`${params.direction_deg}@${params.height_frac}`);
    history.push({
      trialNo,
      params,
      outcome: "success",
      metrics: {} as TrialHistoryEntry["metrics"],
    });
  }
  return result;
}

describe("FixedProvider for balloon_pop", () => {
  const all = BALLOON_DIRECTIONS_DEG.flatMap((deg) =>
    BALLOON_HEIGHT_FRACS.map((height) => `${deg}@${height}`),
  ).sort();

  it("gives every direction with every height once in each block of nine", () => {
    const order = balloons(new FixedProvider({ specsFor, seed: 11 }), 27);
    for (let block = 0; block < 3; block++) {
      expect(order.slice(block * 9, block * 9 + 9).sort()).toEqual(all);
    }
  });

  it("uses only the three upward directions and three heights", () => {
    const provider = new FixedProvider({ specsFor, seed: 5 });
    const params = provider.nextParams("balloon_pop", []);
    expect(BALLOON_DIRECTIONS_DEG).toContain(params.direction_deg);
    expect(BALLOON_HEIGHT_FRACS).toContain(params.height_frac);
    expect(params.direction_index).toBe(params.direction_deg / 45);
    // Every other setting at its default.
    expect(params).toMatchObject({ balloon_radius_sw: 0.45, hover_ms: 7000, squeeze_to_pop: 0 });
  });

  it("shuffles, never repeats across blocks, and repeats exactly for a seed", () => {
    const orders = [1, 2, 3].map((seed) =>
      balloons(new FixedProvider({ specsFor, seed }), 9).join(),
    );
    expect(new Set(orders).size).toBeGreaterThan(1);
    for (let seed = 0; seed < 100; seed++) {
      const order = balloons(new FixedProvider({ specsFor, seed }), 18);
      expect(order[9]).not.toBe(order[8]);
    }
    expect(balloons(new FixedProvider({ specsFor, seed: 4 }), 18)).toEqual(
      balloons(new FixedProvider({ specsFor, seed: 4 }), 18),
    );
  });

  it("keeps each game's order separate", () => {
    const provider = new FixedProvider({ specsFor, seed: 9 });
    const first = provider.nextParams("reach_activate", []);
    provider.nextParams("balloon_pop", []);
    expect(provider.nextParams("reach_activate", []).direction_index).toBe(first.direction_index);
  });
});

describe("FixedProvider for fruit_catch", () => {
  const fruit = (provider: FixedProvider, trialNo: number) =>
    provider.nextParams("fruit_catch", [], trialNo);

  it("alternates out and across, starting outward", () => {
    const provider = new FixedProvider({ specsFor, seed: 3 });
    const sides = Array.from({ length: 8 }, (_, i) => fruit(provider, i + 1).target_side);
    expect(sides).toEqual([1, -1, 1, -1, 1, -1, 1, -1]);
  });

  it("uses each side's three distances in every three fruits on that side", () => {
    const provider = new FixedProvider({ specsFor, seed: 8 });
    const trials = Array.from({ length: 12 }, (_, i) => fruit(provider, i + 1));
    for (const side of [1, -1]) {
      const fracs = trials
        .filter((params) => params.target_side === side)
        .map((p) => p.target_frac);
      expect(fracs.slice(0, 3).sort()).toEqual([...FRUIT_TARGET_FRACS]);
      expect(fracs.slice(3, 6).sort()).toEqual([...FRUIT_TARGET_FRACS]);
    }
  });

  it("gives a trial the same settings whenever it is asked, so overlapping fruit differ", () => {
    const provider = new FixedProvider({ specsFor, seed: 2 });
    // Fruit 2 is asked for before fruit 1 is logged: the history is still empty.
    const first = fruit(provider, 1);
    const second = fruit(provider, 2);
    expect(second.target_side).toBe(-first.target_side);
    expect(fruit(provider, 2)).toEqual(second);
  });
});
