import { describe, expect, it, vi } from "vitest";

import { gameAudio } from "@/games/shared/audio";
import { createPlayArea, defaultHull } from "@/games/shared/playArea";
import { defaultParams } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameParams } from "@/games/shared/types";
import { pathLength, pointAtDistance } from "@/metrics/paths";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import { pathTrace } from "./index";
import { PATH_TRACE_PARAMS, readParams } from "./params";
import { placePath } from "./placement";
import { START_TIMEOUT_MS } from "./traceMachine";

const STEP = 1000 / 60;
const PARAMS: GameParams = { ...defaultParams(PATH_TRACE_PARAMS), shape_index: 2 };
const SETTINGS = readParams(PARAMS);
// Without a calibration, the game uses the default hull.
const PATH = placePath({ ...SETTINGS, hull: defaultHull() }).points;
const LENGTH = pathLength(PATH);
/** The fingertip arrives in the start circle on the first frame and is held 500 ms. */
const TRACE_START = STEP + 500;
const TRACE_MS = (LENGTH / SETTINGS.guideSpeedSwS) * 1000;

function setUp(cursor: (t: number) => Point | null) {
  let now = 0;
  const logged: TrialCreate[] = [];
  const success = vi.fn();
  const next = vi.fn(() => ({ ...PARAMS }));
  const area = createPlayArea({ width: 1600, height: 900, affectedSide: "right", hull: null });
  const context: GameContext = {
    gameId: "path_trace",
    width: 1600,
    height: 900,
    trialsPlanned: 1,
    toScreen: area.toScreen,
    toBody: area.toBody,
    pixelsPerSw: area.pixelsPerSw,
    getTracking: () => {
      const point = cursor(now);
      return {
        rawSw: point,
        smoothSw: point,
        handLost: point === null,
        handLostMs: 0,
        armElevationDeg: null,
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
    },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: { ...gameAudio, success, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: () => {},
  };
  const game = pathTrace.create(context);
  game.start();
  return {
    game,
    logged,
    success,
    next,
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

/** On the start circle, then right on the guide. */
const follower = (t: number) =>
  t < TRACE_START
    ? PATH[0]
    : pointAtDistance(PATH, (SETTINGS.guideSpeedSwS * (t - TRACE_START)) / 1000);

describe("path_trace game", () => {
  it("is registered with 10 trials and its settings", () => {
    expect(pathTrace.implemented).toBe(true);
    expect(pathTrace.trialsDefault).toBe(10);
    expect(defaultParams(PATH_TRACE_PARAMS)).toMatchObject({
      path_length_frac: 0.6,
      guide_speed_sw_s: 0.25,
      corridor_width_sw: 0.4,
      ring_frac: 0.7,
      rest_ms: 2000,
    });
  });

  it("logs a trace followed closely as a success with the path as its target", () => {
    const sim = setUp(follower);
    sim.runUntil(TRACE_START + TRACE_MS + 6000);

    expect(sim.next).toHaveBeenCalledTimes(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.params).toEqual(PARAMS);
    expect(trial.target).toMatchObject({ kind: "path", shape: "s_curve" });
    expect(trial.target?.points?.length).toBeGreaterThan(10);
    expect(trial.metrics.time_in_corridor_pct).toBe(100);
    expect(trial.metrics.mean_path_error_sw as number).toBeLessThan(0.01);
    expect(trial.metrics.coverage_pct as number).toBeGreaterThan(90);
    expect(trial.trajectory.length).toBeGreaterThan(30);
    expect(sim.success).toHaveBeenCalledTimes(1);
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.stars", params: { n: 3 } }]);
    expect(sim.game.isFinished()).toBe(true);
  });

  it("logs a fingertip that never reaches the start circle as reach_fail", () => {
    const sim = setUp(() => ({ x: -2, y: -2 }));
    sim.runUntil(START_TIMEOUT_MS + 6000);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("reach_fail");
    expect(trial.metrics.time_in_corridor_pct).toBeNull();
    expect(sim.success).not.toHaveBeenCalled();
    expect(sim.game.getSummary().score).toBe(0);
  });

  it("starts the trace again from the start circle after a pause", () => {
    const sim = setUp(follower);
    sim.runUntil(TRACE_START + 1000);
    sim.game.pause();
    sim.game.resume();
    sim.runUntil(sim.now + 200);
    expect(sim.next).toHaveBeenCalledTimes(2);
    expect(sim.logged).toHaveLength(0);
  });
});
