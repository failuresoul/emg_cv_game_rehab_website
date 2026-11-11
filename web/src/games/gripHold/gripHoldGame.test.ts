import { describe, expect, it, vi } from "vitest";

import { FixedProvider } from "@/ai/paramsProvider";
import {
  DETAIL_BEST_HOLD_MS,
  DETAIL_BEST_STEADINESS,
  DETAIL_MEAN_IN_BAND_PCT,
  DETAIL_MEAN_RELAXATION_MS,
} from "@/features/games/results";
import { gameAudio } from "@/games/shared/audio";
import { defaultParams, GAMES } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameFeedback, GameParams } from "@/games/shared/types";
import { IDLE_PINCH } from "@/input/pinch";
import type { ActivationSourceId } from "@/input/types";
import type { TrialCreate } from "@/types/api";
import type { CompensationMonitor } from "@/warmup/compensation";

import { OUTCOME_MS } from "./holdMachine";
import { gripHold } from "./index";
import { GRIP_HOLD_PARAMS } from "./params";

const STEP = 1000 / 60;
const PARAMS: GameParams = defaultParams(GRIP_HOLD_PARAMS);

function setUp(level: (t: number) => number, sourceId: ActivationSourceId = "cv_grip") {
  let now = 0;
  const logged: TrialCreate[] = [];
  const feedback: GameFeedback[] = [];
  const success = vi.fn();
  const next = vi.fn(() => ({ ...PARAMS }));
  const context: GameContext = {
    gameId: "grip_hold",
    width: 1600,
    height: 900,
    trialsPlanned: 1,
    toScreen: (point) => point,
    toBody: (point) => point,
    pixelsPerSw: 100,
    getTracking: () => ({
      rawSw: null,
      smoothSw: null,
      handLost: false,
      handLostMs: 0,
      armElevationDeg: null,
      elbowFlexionDeg: null,
      timestamp: now,
    }),
    activation: { sourceId, getLevel: () => level(now), isReady: () => true },
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
    audio: { ...gameAudio, success, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: (item) => feedback.push(item),
  };
  const game = gripHold.create(context);
  game.start();
  return {
    game,
    logged,
    feedback,
    success,
    next,
    runUntil: (until: number) => {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        game.update(STEP, now);
      }
    },
  };
}

describe("grip_hold game", () => {
  it("is registered with 8 trials and its settings", () => {
    expect(GAMES.grip_hold).toBe(gripHold);
    expect(gripHold.implemented).toBe(true);
    expect(gripHold.trialsDefault).toBe(8);
    expect(PARAMS).toEqual({
      band_center: 0.5,
      band_width: 0.3,
      hold_ms: 3000,
      time_limit_ms: 15000,
      relax_below: 0.15,
      relax_within_ms: 3000,
      rest_ms: 2000,
    });
  });

  it("logs a hold and relax as a success, with the band and the measures", () => {
    // Squeeze into the band at 1 s, hold 3 s, relax at 4.6 s.
    const sim = setUp((t) => (t < 1000 ? 0.1 : t < 4600 ? 0.5 : 0.05));
    sim.runUntil(4600 + OUTCOME_MS + 2200);

    expect(sim.next).toHaveBeenCalledTimes(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.target).toEqual({ kind: "grip_band", center: 0.5, width: 0.3 });
    expect(trial.metrics.time_to_band_ms).toBeCloseTo(1000, -2);
    expect(trial.metrics.time_in_band_pct).toBeCloseTo(75, 0);
    expect(trial.metrics.longest_continuous_hold_ms).toBeCloseTo(3000, -2);
    expect(trial.metrics.steadiness).toBe(0);
    expect(trial.metrics.overshoot_count).toBe(0);
    expect(trial.metrics.relaxation_ms).toBeCloseTo(600, -2);
    expect(trial.metrics.input_source).toBe("cv_grip");
    expect(trial.metrics.failed_phase).toBeNull();
    expect(sim.success).toHaveBeenCalledTimes(1);
    expect(sim.feedback.map((item) => item.key)).toContain("game.grip_hold.prompt.relax");
    expect(sim.game.isFinished()).toBe(true);

    const result = sim.game.getSummary();
    expect(result.summary.successes).toBe(1);
    expect(result.summary.details?.[DETAIL_MEAN_IN_BAND_PCT]).toBeCloseTo(75, 0);
    expect(result.summary.details?.[DETAIL_BEST_HOLD_MS]).toBeCloseTo(3000, -2);
    expect(result.summary.details?.[DETAIL_BEST_STEADINESS]).toBe(0);
    expect(result.summary.details?.[DETAIL_MEAN_RELAXATION_MS]).toBeCloseTo(600, -2);
  });

  it("misses calmly when the hand does not relax, saving the phase", () => {
    const sim = setUp(() => 0.5, "keyboard");
    sim.runUntil(3000 + 3000 + OUTCOME_MS + 2200);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics.failed_phase).toBe("relax");
    expect(trial.metrics.input_source).toBe("keyboard");
    expect(sim.feedback.map((item) => item.key)).toContain("game.grip_hold.prompt.relaxMissed");
  });

  it("misses calmly when the band is never held long enough", () => {
    const sim = setUp(() => 0.9);
    sim.runUntil(15000 + OUTCOME_MS + 2200);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics.failed_phase).toBe("hold");
    expect(trial.metrics.time_to_band_ms).toBeNull();
    expect(trial.metrics.overshoot_count).toBe(1);
    expect(trial.metrics.max_overshoot).toBeCloseTo(0.25);
    expect(sim.feedback.map((item) => item.key)).toContain("game.grip_hold.prompt.holdMissed");
  });

  it("shows the webcam note only while the grip comes from the camera", () => {
    expect(setUp(() => 0).game.getHudItems?.()).toContainEqual({
      key: "game.grip_hold.webcamNote",
    });
    expect(
      setUp(() => 0, "keyboard")
        .game.getHudItems?.()
        .map((item) => item.key),
    ).toEqual(["game.hud.holds"]);
    expect(
      setUp(() => 0, "emg")
        .game.getHudItems?.()
        .map((item) => item.key),
    ).toEqual(["game.hud.holds"]);
  });

  it("starts a hold cut short by a pause again", () => {
    const sim = setUp(() => 0.5);
    sim.runUntil(1500);
    sim.game.pause();
    sim.game.resume();
    sim.runUntil(1600);
    expect(sim.logged).toHaveLength(0);
    expect(sim.next).toHaveBeenCalledTimes(2);
  });
});

describe("FixedProvider for grip_hold", () => {
  it("uses the defaults for every trial", () => {
    const provider = new FixedProvider({ specsFor: (id) => GAMES[id].params, seed: 3 });
    expect(provider.nextParams("grip_hold", [], 1)).toEqual(PARAMS);
    expect(provider.nextParams("grip_hold", [], 5)).toEqual(PARAMS);
  });
});
