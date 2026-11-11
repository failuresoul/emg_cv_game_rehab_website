import { describe, expect, it, vi } from "vitest";

import { FixedProvider } from "@/ai/paramsProvider";
import { createPlayArea } from "@/games/shared/playArea";
import { GAMES } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameParams } from "@/games/shared/types";
import { IDLE_PINCH } from "@/input/pinch";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import { createFruitCatchGame } from "./fruitCatchGame";

const STEP = 1000 / 60;

interface Simulation {
  /** The RAW fingertip at game time t; the smoothed cursor is kept far away to prove it is unused. */
  raw: (t: number) => Point | null;
}

function setUp(trialsPlanned: number, overrides: GameParams = {}) {
  let now = 0;
  let sim: Simulation = { raw: () => ({ x: 0, y: -0.3 }) };
  const logged: TrialCreate[] = [];
  const provider = new FixedProvider({ specsFor: (id) => GAMES[id].params, seed: 1 });
  const next = vi.fn((trialNo?: number) => ({
    ...provider.nextParams("fruit_catch", [], trialNo),
    ...overrides,
  }));
  const plop = vi.fn();
  const area = createPlayArea({
    width: 1600,
    height: 900,
    affectedSide: "right",
    hull: null,
    insets: { top: 72 },
  });

  const context: GameContext = {
    gameId: "fruit_catch",
    width: 1600,
    height: 900,
    trialsPlanned,
    toScreen: area.toScreen,
    toBody: area.toBody,
    pixelsPerSw: area.pixelsPerSw,
    getTracking: () => ({
      rawSw: sim.raw(now),
      smoothSw: { x: -5, y: -0.3 },
      handLost: false,
      handLostMs: 0,
      armElevationDeg: null,
      elbowFlexionDeg: null,
      timestamp: now,
    }),
    activation: { sourceId: "keyboard", getLevel: () => 0, isReady: () => true },
    hand: {
      getOpenness: () => 0,
      isOpennessReady: () => true,
      getTouch: () => null,
      isTouchReady: () => true,
      subscribeTouch: () => () => {},
      setTouchThreshold: () => {},
      getPinch: () => ({ ...IDLE_PINCH }),
      subscribePinch: () => () => {},
    },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: {
      prepare: () => {},
      countdown: () => {},
      tick: () => {},
      success: () => {},
      plop,
      finish: () => {},
      note: () => {},
      muted: () => {},
    },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: () => {},
  };

  const game = createFruitCatchGame(context);
  game.start();
  return {
    game,
    logged,
    next,
    plop,
    simulate: (value: Simulation) => {
      sim = value;
    },
    runUntil: (until: number) => {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        game.update(STEP, now);
      }
    },
  };
}

describe("fruit_catch game", () => {
  it("catches a fruit when the RAW fingertip puts the basket under it", () => {
    const sim = setUp(1, { target_frac: 0.7 });
    // The first fruit falls outward: 0.7 of the spread, 0.7 of a 1.2 SW reach = 0.588 SW.
    sim.simulate({
      raw: (t) => ({ x: Math.min(0.6, Math.max(0, (t - 1000) / 1000) * 0.6), y: -0.3 }),
    });
    sim.runUntil(12000);

    expect(sim.logged).toHaveLength(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.metrics.side).toBe("out");
    expect(trial.target?.x_sw).toBeCloseTo(0.588);
    // 0.588 of a 1.2 SW reach is 49%: the inner ring.
    expect(trial.target?.sector).toBe("D0R1");
    expect(trial.metrics.lateral_path_efficiency).toBeGreaterThan(0.99);
    expect(trial.metrics.lateral_distance_sw).toBeCloseTo(0.588, 2);
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.caught", params: { n: 1 } }]);
    expect(sim.game.getSummary().score).toBe(100);
    expect(sim.game.isFinished()).toBe(true);
  });

  it("lets a fruit land softly when the basket is elsewhere", () => {
    const sim = setUp(1);
    sim.simulate({ raw: () => ({ x: -0.5, y: -0.3 }) });
    sim.runUntil(12000);

    expect(sim.logged[0].outcome).toBe("miss");
    expect(sim.plop).toHaveBeenCalledTimes(1);
    expect(sim.game.getSummary().score).toBe(0);
  });

  it("gives two fruits falling at once their own numbers and sides", () => {
    const sim = setUp(4, { max_on_screen: 2, spawn_interval_ms: 2500 });
    sim.simulate({ raw: () => ({ x: 0, y: -0.3 }) });
    sim.runUntil(4000);

    // The second fruit appeared before the first was logged.
    expect(sim.logged).toHaveLength(0);
    // The next fruit's settings are fetched ahead, so 3 may already have been asked for.
    expect(sim.next.mock.calls.map(([trialNo]) => trialNo).slice(0, 2)).toEqual([1, 2]);
    sim.runUntil(30000);
    expect(sim.logged.map((trial) => trial.trial_no)).toEqual([1, 2, 3, 4]);
    expect(sim.logged.map((trial) => trial.metrics.side)).toEqual([
      "out",
      "across",
      "out",
      "across",
    ]);
  });

  it("drops a fruit cut short by a pause and lets it fall again with the same number", () => {
    const sim = setUp(1, { target_frac: 0.7 });
    sim.simulate({ raw: () => ({ x: 0.588, y: -0.3 }) });
    sim.runUntil(2000);
    sim.game.pause();
    sim.game.resume();
    sim.runUntil(15000);

    expect(sim.logged).toHaveLength(1);
    expect(sim.logged[0].trial_no).toBe(1);
    expect(sim.logged[0].outcome).toBe("success");
    expect(sim.next.mock.calls.map(([trialNo]) => trialNo)).toEqual([1, 1]);
  });
});
