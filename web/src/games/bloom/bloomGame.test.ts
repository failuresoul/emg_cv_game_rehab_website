import { describe, expect, it, vi } from "vitest";

import { DETAIL_BEST_OPENNESS, DETAIL_MEAN_TIME_TO_OPEN } from "@/features/games/results";
import { gameAudio } from "@/games/shared/audio";
import { defaultParams } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameFeedback } from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";
import type { CompensationMonitor } from "@/warmup/compensation";

import { BLOOM_MS, MISS_MS, SEED_FLIGHT_MS } from "./bloomMachine";
import { createBloomGame } from "./bloomGame";
import { bloom } from "./index";
import { BLOOM_PARAMS, BLOOM_TRIALS } from "./params";

const STEP = 1000 / 60;
const PARAMS = defaultParams(BLOOM_PARAMS);
/** One successful flower, from spawn to the next spawn, with the hand moving at `start`. */
const OPEN_AT = 500;
const FLOWER_MS = OPEN_AT + 800 + BLOOM_MS + 300 + 400 + SEED_FLIGHT_MS + 1500;

interface Hand {
  openness: (t: number) => number;
  grip: (t: number) => number;
}

function setUp(trialsPlanned = 1) {
  let now = 0;
  let hand: Hand = { openness: () => 0, grip: () => 0 };
  const logged: TrialCreate[] = [];
  const emitted: GameFeedback[] = [];
  const next = vi.fn(() => ({ ...PARAMS }));
  const sustained: string[] = [];

  const context: GameContext = {
    gameId: "bloom",
    width: 1600,
    height: 900,
    trialsPlanned,
    toScreen: (point) => point,
    toBody: (point) => point,
    pixelsPerSw: 300,
    getTracking: () => ({
      rawSw: null,
      smoothSw: null,
      handLost: false,
      handLostMs: 0,
      armElevationDeg: null,
      timestamp: now,
    }),
    activation: { sourceId: "keyboard", getLevel: () => hand.grip(now), isReady: () => true },
    hand: {
      getOpenness: () => hand.openness(now),
      isOpennessReady: () => true,
      getTouch: () => null,
      isTouchReady: () => true,
      subscribeTouch: () => () => {},
      setTouchThreshold: () => {},
    },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: { ...gameAudio, success: () => {}, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      get reading() {
        return {
          baseline: null,
          values: { trunkDisplacement: 0.2, trunkLeanDeg: 0, shoulderHike: 0 },
          sustained: [...sustained],
          cue: null,
        };
      },
    } as unknown as CompensationMonitor,
    emit: (feedback) => emitted.push(feedback),
  };

  const game = createBloomGame(context);
  game.start();
  return {
    game,
    logged,
    emitted,
    next,
    sustained,
    /** The hand, with times relative to `from`. */
    play: (from: number, value: Hand) => {
      hand = {
        openness: (t) => value.openness(t - from),
        grip: (t) => value.grip(t - from),
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
    flowers: () => game.getHudItems?.()[0]?.params?.n,
  };
}

/** Opens at 500 ms, then makes a fist as soon as the closing phase begins. */
const goodHand: Hand = {
  openness: (t) => (t >= OPEN_AT && t < OPEN_AT + 800 + BLOOM_MS ? 0.9 : 0.2),
  grip: (t) => (t >= OPEN_AT + 800 + BLOOM_MS + 100 ? 0.8 : 0),
};
const stillHand: Hand = { openness: () => 0.3, grip: () => 0 };

describe("bloom game", () => {
  it("is registered with 15 trials and the hand-opening settings", () => {
    expect(bloom.implemented).toBe(true);
    expect(bloom.trialsDefault).toBe(BLOOM_TRIALS);
    expect(BLOOM_TRIALS).toBe(15);
    expect(PARAMS).toEqual({
      open_demand: 0.7,
      open_hold_ms: 800,
      close_demand: 0.6,
      phase_time_limit_ms: 8000,
      close_hold_ms: 300,
      rest_ms: 1500,
    });
    expect(bloom.compensationExercise).toBe("hand_open_close");
    expect(bloom.showCursor).toBe(false);
  });

  it("plays a flower: opens, blooms, collects the seed and plants it", () => {
    const sim = setUp();
    sim.play(0, goodHand);
    sim.runUntil(FLOWER_MS);

    expect(sim.next).toHaveBeenCalledTimes(1);
    expect(sim.logged).toHaveLength(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.params).toEqual(PARAMS);
    expect(trial.target).toEqual({ kind: "bloom" });
    expect(trial.metrics.failed_phase).toBeNull();
    // Spawned on the first frame, opened on the frame at 500 ms; saved to the nearest ms.
    expect(trial.metrics.time_to_open_ms).toBeGreaterThanOrEqual(OPEN_AT - STEP - 1);
    expect(trial.metrics.time_to_open_ms).toBeLessThanOrEqual(OPEN_AT + STEP);
    expect(trial.metrics.peak_openness).toBeCloseTo(0.9);
    expect(trial.metrics.hold_stability).toBe(0);
    expect(trial.metrics.time_to_close_ms).toBeCloseTo(100, -2);
    expect(trial.metrics.peak_grip).toBeCloseTo(0.8);
    expect(trial.metrics.openness_rise_rate).toBeGreaterThan(0);
    expect(sim.flowers()).toBe(1);
    expect(sim.game.isFinished()).toBe(true);
    expect(sim.game.getSummary().score).toBeGreaterThan(100);
    expect(sim.emitted.map((item) => item.key)).toContain("game.bloom.prompt.close");
  });

  it("logs a calm miss with the phase that ran out of time", () => {
    const sim = setUp();
    sim.play(0, stillHand);
    sim.runUntil(8000 + MISS_MS + 1500 + 100);

    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics.failed_phase).toBe("open");
    expect(trial.metrics.peak_openness).toBeCloseTo(0.3);
    expect(sim.flowers()).toBe(0);
    expect(sim.game.getSummary().score).toBe(0);
    expect(sim.emitted.at(-1)?.tone).toBe("gentle");
  });

  it("grows the garden by one flower for each success only", () => {
    const sim = setUp(3);
    sim.play(0, goodHand);
    sim.runUntil(FLOWER_MS);
    expect(sim.flowers()).toBe(1);

    let from = sim.now;
    sim.play(from, stillHand);
    sim.runUntil(from + 8000 + MISS_MS + 1500 + 100);
    expect(sim.logged.map((trial) => trial.outcome)).toEqual(["success", "miss"]);
    expect(sim.flowers()).toBe(1);

    from = sim.now;
    sim.play(from, goodHand);
    sim.runUntil(from + FLOWER_MS);
    expect(sim.flowers()).toBe(2);
    expect(sim.game.isFinished()).toBe(true);

    const summary = sim.game.getSummary().summary;
    expect(summary.successes).toBe(2);
    expect(summary.details?.[DETAIL_MEAN_TIME_TO_OPEN]).toBeGreaterThan(400);
    // The best of every turn, the missed one (0.3) included.
    expect(summary.details?.[DETAIL_BEST_OPENNESS]).toBeCloseTo(0.9);
  });

  it("counts trunk compensation while the flower is played", () => {
    const sim = setUp();
    sim.sustained.push("trunk");
    sim.play(0, goodHand);
    sim.runUntil(FLOWER_MS);
    expect(sim.logged[0].compensation.flagged).toBe(true);
    expect(sim.logged[0].compensation.type).toBe("trunk");
  });

  it("grows the flower again from a bud after a pause", () => {
    const sim = setUp();
    sim.play(0, stillHand);
    sim.runUntil(1000);
    sim.game.pause();
    sim.game.resume();
    const from = sim.now;
    sim.play(from, goodHand);
    sim.runUntil(from + FLOWER_MS);

    expect(sim.next).toHaveBeenCalledTimes(2);
    expect(sim.logged).toHaveLength(1);
    expect(sim.logged[0].outcome).toBe("success");
    expect(sim.logged[0].trial_no).toBe(1);
  });
});
