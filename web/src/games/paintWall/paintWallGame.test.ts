import { describe, expect, it, vi } from "vitest";

import { gameAudio } from "@/games/shared/audio";
import { defaultParams } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameFeedback, GameParams } from "@/games/shared/types";
import { IDLE_PINCH } from "@/input/pinch";
import type { TrialCreate } from "@/types/api";
import type { CompensationMonitor } from "@/warmup/compensation";

import { angleAtHeight, DEFAULT_ELBOW_RANGE } from "./elbowRange";
import { paintWall } from "./index";
import { PAINT_WALL_PARAMS } from "./params";

const STEP = 1000 / 60;
const PARAMS: GameParams = defaultParams(PAINT_WALL_PARAMS);

interface Arm {
  /** The brush height the elbow is at, 0 to 1, or null when unseen. */
  height: (t: number) => number | null;
  elevation: (t: number) => number | null;
}

function setUp(trialsPlanned = 1) {
  let now = 0;
  let arm: Arm = { height: () => 0, elevation: () => 15 };
  const logged: TrialCreate[] = [];
  const emitted: GameFeedback[] = [];
  const next = vi.fn(() => ({ ...PARAMS }));
  const context: GameContext = {
    gameId: "paint_wall",
    width: 1600,
    height: 900,
    trialsPlanned,
    toScreen: (point) => point,
    toBody: (point) => point,
    pixelsPerSw: 300,
    getTracking: () => {
      const height = arm.height(now);
      return {
        rawSw: { x: 0.3, y: -0.5 },
        smoothSw: { x: 0.3, y: -0.5 },
        handLost: false,
        handLostMs: 0,
        armElevationDeg: arm.elevation(now),
        elbowFlexionDeg: height === null ? null : angleAtHeight(height, DEFAULT_ELBOW_RANGE),
        timestamp: now,
      };
    },
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
    affectedSide: "left",
    rng: createRng(1),
    audio: { ...gameAudio, success: () => {}, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: (feedback) => emitted.push(feedback),
  };
  const game = paintWall.create(context);
  game.start();
  return {
    game,
    logged,
    emitted,
    next,
    move: (from: number, value: Arm) => {
      arm = {
        height: (t) => value.height(t - from),
        elevation: (t) => value.elevation(t - from),
      };
    },
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

/** Sweeps of 2 s, 2.2 s apart from 500 ms, `count` of them, each up to `peak`. */
const sweeping =
  (count: number, peak: number) =>
  (t: number): number => {
    const index = Math.floor((t - 500) / 2200);
    if (t < 500 || index >= count) return 0;
    const share = (t - 500 - index * 2200) / 2000;
    return share >= 1 ? 0 : peak * Math.sin(Math.PI * share);
  };

describe("paint_wall game", () => {
  it("is registered with 8 stripes and the patient's elbow range as settings", () => {
    expect(paintWall.implemented).toBe(true);
    expect(paintWall.trialsDefault).toBe(8);
    expect(paintWall.showCursor).toBe(false);
    expect(PARAMS).toMatchObject({
      required_range_frac: 0.75,
      sweeps_needed: 3,
      time_limit_ms: 30000,
      elbow_bent_deg: 70,
      elbow_straight_deg: 150,
      rest_ms: 2000,
    });
  });

  it("finishes a stripe with three full sweeps of the elbow", () => {
    const sim = setUp();
    sim.move(0, { height: sweeping(3, 0.9), elevation: () => 15 });
    sim.runUntil(12000);

    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.target).toEqual({ kind: "stripe", index: 0, target_frac: 0.75 });
    expect(trial.metrics.full_sweeps).toBe(3);
    // Straight is 150°; 0.9 of the way to 70° is 78°.
    expect(trial.metrics.max_straight_deg).toBeCloseTo(150, 0);
    expect(trial.metrics.max_bend_deg as number).toBeLessThan(80);
    expect(trial.metrics.achieved_range_deg as number).toBeGreaterThan(70);
    expect(trial.compensation.flagged).toBe(false);
    expect(sim.game.isFinished()).toBe(true);
    expect(sim.game.getSummary().score).toBe(3 * 30 + 50);
  });

  it("ends as a miss at the time limit, counting partial sweeps", () => {
    const sim = setUp();
    sim.move(0, { height: sweeping(10, 0.5), elevation: () => 15 });
    sim.runUntil(35000);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics.full_sweeps).toBe(0);
    expect(trial.metrics.partial_sweeps as number).toBeGreaterThan(5);
  });

  it("reminds the patient and flags the upper arm when it moves while sweeping", () => {
    const sim = setUp();
    sim.move(0, { height: sweeping(3, 0.9), elevation: (t) => (t > 900 ? 45 : 15) });
    sim.runUntil(12000);
    const [trial] = sim.logged;
    expect(trial.compensation.flagged).toBe(true);
    expect(trial.compensation.type).toContain("upper_arm");
    expect(trial.metrics.upper_arm_motion_deg).toBeCloseTo(30);
    expect(sim.emitted.map((item) => item.key)).toContain("game.paint_wall.keepArmStill");
  });

  it("paints the stripes from left to right and starts a stripe again after a pause", () => {
    const sim = setUp(2);
    sim.move(0, { height: () => 0, elevation: () => 15 });
    sim.runUntil(1000);
    sim.game.pause();
    sim.game.resume();
    const from = sim.now;
    sim.move(from, { height: sweeping(3, 0.9), elevation: () => 15 });
    sim.runUntil(from + 12000);
    const second = sim.now;
    sim.move(second, { height: sweeping(3, 0.9), elevation: () => 15 });
    sim.runUntil(second + 12000);

    expect(sim.next).toHaveBeenCalledTimes(3);
    expect(sim.logged.map((trial) => trial.target?.index)).toEqual([0, 1]);
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.stripes", params: { n: 2 } }]);
  });
});
