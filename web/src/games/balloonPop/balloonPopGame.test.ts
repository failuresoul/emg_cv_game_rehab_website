import { describe, expect, it, vi } from "vitest";

import { createPlayArea } from "@/games/shared/playArea";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameParams } from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import { createBalloonPopGame } from "./balloonPopGame";

const STEP = 1000 / 60;
const RAW_OFFSET = { x: 0.01, y: -0.02 };
const PARAMS: GameParams = {
  height_frac: 0.7,
  direction_deg: 90,
  direction_index: 2,
  balloon_radius_sw: 0.45,
  rise_ms: 2500,
  hover_ms: 7000,
  squeeze_to_pop: 0,
  activation_demand: 0.5,
  activation_hold_ms: 200,
  activation_window_ms: 3000,
  rest_ms: 1200,
};
// Without a calibration the reach is 1.2 SW, so the balloon waits 0.84 SW above the shoulder.
const BALLOON_Y = 0.84;

interface Simulation {
  cursor: (t: number) => Point | null;
  level: (t: number) => number;
  elevation: (t: number) => number | null;
}

function setUp(params: GameParams = PARAMS) {
  let now = 0;
  let sim: Simulation = { cursor: () => ({ x: 0, y: -0.8 }), level: () => 0, elevation: () => 20 };
  const logged: TrialCreate[] = [];
  const next = vi.fn(() => ({ ...params }));
  // The same top-bar inset as the game shell.
  const area = createPlayArea({
    width: 1600,
    height: 900,
    affectedSide: "left",
    hull: null,
    insets: { top: 72 },
  });

  const context: GameContext = {
    gameId: "balloon_pop",
    width: 1600,
    height: 900,
    trialsPlanned: 1,
    toScreen: area.toScreen,
    toBody: area.toBody,
    pixelsPerSw: area.pixelsPerSw,
    getTracking: () => {
      const smooth = sim.cursor(now);
      return {
        smoothSw: smooth,
        rawSw: smooth && { x: smooth.x + RAW_OFFSET.x, y: smooth.y + RAW_OFFSET.y },
        handLost: smooth === null,
        handLostMs: 0,
        armElevationDeg: sim.elevation(now),
        timestamp: now,
      };
    },
    activation: { sourceId: "keyboard", getLevel: () => sim.level(now), isReady: () => true },
    hand: {
      getOpenness: () => 0,
      isOpennessReady: () => true,
      getTouch: () => null,
      isTouchReady: () => true,
      subscribeTouch: () => () => {},
      setTouchThreshold: () => {},
    },
    calibration: null,
    affectedSide: "left",
    rng: createRng(1),
    audio: {
      prepare: () => {},
      countdown: () => {},
      tick: () => {},
      success: () => {},
      plop: () => {},
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

  const game = createBalloonPopGame(context);
  game.start();
  return {
    game,
    logged,
    next,
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

/** The hand rests low, then rises straight up into the balloon over one second. */
const raiseFrom = (from: number) => (t: number) => ({
  x: 0,
  y: -0.8 + (BALLOON_Y + 0.8) * Math.min(1, Math.max(0, (t - from) / 1000)),
});

describe("balloon_pop game", () => {
  it("pops a balloon reached after it arrives, logging raw positions and the arm's peak", () => {
    const sim = setUp();
    sim.simulate({
      cursor: raiseFrom(2000),
      level: () => 0,
      elevation: (t) => 20 + Math.min(100, Math.max(0, t - 2000) / 10),
    });
    sim.runUntil(8000);

    expect(sim.next).toHaveBeenCalledTimes(1);
    expect(sim.logged).toHaveLength(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.params).toEqual(PARAMS);
    expect(trial.target?.sector).toBe("D2R2");
    expect(trial.target?.y_sw).toBeCloseTo(BALLOON_Y);
    // The arm kept rising after the pop; the peak is taken only while the balloon was live.
    const popAt = (trial.timings.enter as number) + STEP;
    expect(trial.metrics.peak_arm_elevation_deg).toBeCloseTo(20 + (popAt - 2000) / 10, 0);
    expect(trial.metrics.peak_arm_elevation_deg).toBeLessThan(120);
    expect(trial.metrics.path_efficiency).toBeGreaterThan(0.99);
    for (const [t, x, y] of trial.trajectory) {
      const smooth = raiseFrom(2000)(t + STEP);
      expect(x).toBeCloseTo(smooth.x + RAW_OFFSET.x, 3);
      expect(y).toBeCloseTo(smooth.y + RAW_OFFSET.y, 3);
    }
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.popped", params: { n: 1 } }]);
    expect(sim.game.isFinished()).toBe(true);
    expect(sim.game.getSummary().score).toBeGreaterThan(100);
  });

  it("logs a miss when the balloon floats away, and scores nothing", () => {
    const sim = setUp();
    sim.simulate({ cursor: () => ({ x: 0, y: -0.8 }), level: () => 0, elevation: () => 15 });
    sim.runUntil(15000);

    expect(sim.logged[0].outcome).toBe("miss");
    expect(sim.logged[0].metrics.peak_arm_elevation_deg).toBe(15);
    expect(sim.game.getSummary().score).toBe(0);
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.popped", params: { n: 0 } }]);
  });

  it("needs a squeeze through the input layer in touch_squeeze mode", () => {
    const sim = setUp({ ...PARAMS, squeeze_to_pop: 1 });
    sim.simulate({
      cursor: raiseFrom(2000),
      level: (t) => (t >= 4000 ? 1 : 0),
      elevation: () => 90,
    });
    sim.runUntil(9000);

    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.metrics.activation_latency_ms).not.toBeNull();
    expect(trial.timings.activation_done).toBeGreaterThan(trial.timings.enter as number);
  });

  it("plays an interrupted balloon again from the start after a pause", () => {
    const sim = setUp();
    sim.simulate({ cursor: raiseFrom(9999), level: () => 0, elevation: () => 20 });
    sim.runUntil(3000);
    sim.game.pause();
    sim.game.resume();
    sim.simulate({ cursor: raiseFrom(4000), level: () => 0, elevation: () => 20 });
    sim.runUntil(12000);

    expect(sim.next).toHaveBeenCalledTimes(2);
    expect(sim.logged).toHaveLength(1);
    expect(sim.logged[0].trial_no).toBe(1);
    expect(sim.logged[0].outcome).toBe("success");
  });
});
