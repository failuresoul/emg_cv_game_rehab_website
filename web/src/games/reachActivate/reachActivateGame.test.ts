import { describe, expect, it, vi } from "vitest";

import { gameAudio } from "@/games/shared/audio";
import { createPlayArea } from "@/games/shared/playArea";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameParams } from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import { createReachActivateGame } from "./reachActivateGame";

const STEP = 1000 / 60;
/** The raw fingertip sits this far from the smoothed one, so the two can be told apart. */
const RAW_OFFSET = { x: 0.01, y: 0.02 };
const PARAMS: GameParams = {
  distance_frac: 0.7,
  direction_deg: 0,
  direction_index: 0,
  target_radius_sw: 0.45,
  dwell_ms: 500,
  activation_demand: 0.5,
  activation_hold_ms: 200,
  activation_window_ms: 3000,
  reach_time_limit_ms: 8000,
  rest_ms: 1500,
};
// Without a calibration the reach is 1.2 SW, so the target's centre is 0.84 SW outward.
const TARGET_X = 0.84;

interface Simulation {
  /** The smoothed cursor at game time t; the raw fingertip is offset from it. */
  cursor: (t: number) => Point | null;
  /** The activation level at game time t. */
  level: (t: number) => number;
}

function setUp(trialsPlanned = 1) {
  let now = 0;
  let sim: Simulation = { cursor: () => ({ x: 0, y: 0 }), level: () => 0 };
  const logged: TrialCreate[] = [];
  const next = vi.fn(() => ({ ...PARAMS }));
  const getLevel = vi.fn(() => sim.level(now));
  const area = createPlayArea({ width: 1600, height: 900, affectedSide: "right", hull: null });

  const context: GameContext = {
    gameId: "reach_activate",
    width: 1600,
    height: 900,
    trialsPlanned,
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
        armElevationDeg: null,
        timestamp: now,
      };
    },
    activation: { sourceId: "keyboard", getLevel, isReady: () => true },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: {
      ...gameAudio,
      success: () => {},
      tick: () => {},
      finish: () => {},
      countdown: () => {},
    },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: () => {},
  };

  const game = createReachActivateGame(context);
  game.start();
  return {
    game,
    logged,
    next,
    getLevel,
    simulate: (value: Simulation) => {
      sim = value;
    },
    /** Runs the 60 Hz updates from the current game time up to `until`. */
    runUntil: (until: number) => {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        game.update(STEP, now);
      }
    },
    get now() {
      return now;
    },
  };
}

/** Rests until `from`, then moves straight to the target's centre over one second. */
const reachFrom = (from: number) => (t: number) => ({
  x: TARGET_X * Math.min(1, Math.max(0, (t - from) / 1000)),
  y: 0,
});

describe("reach_activate game", () => {
  it("plays a trial with settings from the provider and activation from the input layer", () => {
    const sim = setUp();
    sim.simulate({ cursor: reachFrom(500), level: (t) => (t >= 1700 ? 1 : 0) });
    sim.runUntil(6000);

    expect(sim.next).toHaveBeenCalledTimes(1);
    expect(sim.getLevel).toHaveBeenCalled();
    expect(sim.logged).toHaveLength(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.params).toEqual(PARAMS);
    expect(trial.target?.sector).toBe("D0R2");
    expect(trial.target?.x_sw).toBeCloseTo(TARGET_X);
    expect(sim.game.isFinished()).toBe(true);
    expect(sim.game.getSummary().score).toBeGreaterThan(100);
  });

  it("saves the raw fingertip, not the smoothed cursor", () => {
    const sim = setUp();
    sim.simulate({ cursor: reachFrom(500), level: (t) => (t >= 1700 ? 1 : 0) });
    sim.runUntil(6000);

    const { trajectory } = sim.logged[0];
    expect(trajectory.length).toBeGreaterThan(30);
    for (const [t, x, y] of trajectory) {
      expect(t).toBeGreaterThanOrEqual(0);
      // Times are relative to the spawn, on the first update.
      const smooth = reachFrom(500)(t + STEP);
      expect(x).toBeCloseTo(smooth.x + RAW_OFFSET.x, 3);
      expect(y).toBeCloseTo(smooth.y + RAW_OFFSET.y, 3);
    }
  });

  it("measures reaction and movement from the raw path", () => {
    const sim = setUp();
    sim.simulate({ cursor: reachFrom(500), level: (t) => (t >= 1700 ? 1 : 0) });
    sim.runUntil(6000);

    const { metrics, timings } = sim.logged[0];
    // Movement began 500 ms after spawn; the target edge is reached about 464 ms later.
    expect(metrics.reaction_ms).toBeGreaterThanOrEqual(450);
    expect(metrics.reaction_ms).toBeLessThanOrEqual(560);
    expect(metrics.movement_ms).toBe((timings.enter as number) - (metrics.reaction_ms as number));
    expect(metrics.path_efficiency).toBeGreaterThan(0.99);
    expect(metrics.activation_latency_ms).toBeGreaterThan(0);
  });

  it("plays an interrupted trial again from the start after a pause", () => {
    const sim = setUp();
    sim.simulate({ cursor: reachFrom(500), level: () => 0 });
    sim.runUntil(900); // Part of the way there.
    sim.game.pause();
    // Paused game time does not move; the runtime stops calling update.
    sim.game.resume();
    const resumedAt = sim.now;
    sim.simulate({
      cursor: reachFrom(resumedAt + 1500),
      level: (t) => (t >= resumedAt + 4000 ? 1 : 0),
    });
    sim.runUntil(resumedAt + 9000);

    expect(sim.logged).toHaveLength(1);
    const [trial] = sim.logged;
    expect(trial.trial_no).toBe(1);
    expect(trial.outcome).toBe("success");
    // A new trial: asked for its settings again, timed from its own spawn after the pause.
    expect(sim.next).toHaveBeenCalledTimes(2);
    expect(trial.metrics.reaction_ms).toBeGreaterThan(400);
  });

  it("fails a reach that never arrives, and scores nothing for it", () => {
    const sim = setUp();
    sim.simulate({ cursor: () => ({ x: 0, y: 0 }), level: () => 0 });
    sim.runUntil(12000);

    expect(sim.logged[0].outcome).toBe("reach_fail");
    expect(sim.logged[0].timings.end).toBeGreaterThanOrEqual(8000);
    expect(sim.game.getSummary().score).toBe(0);
  });
});
