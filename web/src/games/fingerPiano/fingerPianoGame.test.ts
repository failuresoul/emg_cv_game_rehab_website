import { describe, expect, it, vi } from "vitest";

import { DETAIL_BEST_FINGER, DETAIL_NOTE_HIT_RATE } from "@/features/games/results";
import { gameAudio } from "@/games/shared/audio";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameParams } from "@/games/shared/types";
import type { Finger, FingerTouchListener } from "@/input/fingerTouch";
import type { TrialCreate } from "@/types/api";
import type { CompensationMonitor } from "@/warmup/compensation";

import { fingerPiano } from "./index";
import { FALL_MS } from "./melodyMachine";
import { melodyToParams } from "./params";

const STEP = 1000 / 60;
const MELODY: Finger[] = ["index", "middle", "ring", "little"];
const PARAMS: GameParams = {
  finger_count: 4,
  sequence_length: 4,
  note_interval_ms: 2000,
  hit_window_ms: 1200,
  touch_threshold: 0.32,
  preview_ms: 2000,
  rest_ms: 1500,
  ...melodyToParams(MELODY),
};

function setUp(params: GameParams = PARAMS) {
  let now = 0;
  const logged: TrialCreate[] = [];
  const listeners = new Set<FingerTouchListener>();
  const note = vi.fn();
  const muted = vi.fn();
  const setTouchThreshold = vi.fn();
  const next = vi.fn(() => ({ ...params }));

  const context: GameContext = {
    gameId: "finger_piano",
    width: 1600,
    height: 900,
    trialsPlanned: 1,
    toScreen: (point) => point,
    toBody: (point) => point,
    pixelsPerSw: 300,
    getTracking: () => ({
      rawSw: null,
      smoothSw: null,
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
      subscribeTouch: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setTouchThreshold,
    },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: { ...gameAudio, note, muted, success: () => {}, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: () => {},
  };

  const game = fingerPiano.create(context);
  game.start();
  return {
    game,
    logged,
    listeners,
    note,
    muted,
    next,
    setTouchThreshold,
    /** A touch start at game time t, delivered when the game next updates. */
    touch: (finger: Finger, t: number) =>
      listeners.forEach((listener) => listener({ type: "touchStart", finger, t })),
    release: (finger: Finger, t: number) =>
      listeners.forEach((listener) => listener({ type: "touchEnd", finger, t })),
    runUntil: (until: number) => {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        game.update(STEP, now);
      }
    },
  };
}

/** The melody spawns on the first frame; its first note arrives after the preview and fall. */
const SPAWN = STEP;
const arrival = (index: number) => SPAWN + 2000 + FALL_MS + index * 2000;

describe("finger_piano game", () => {
  it("is registered with 12 melodies and hand-only settings", () => {
    expect(fingerPiano.implemented).toBe(true);
    expect(fingerPiano.trialsDefault).toBe(12);
    expect(fingerPiano.showCursor).toBe(false);
    expect(fingerPiano.compensationExercise).toBe("thumb_opposition");
  });

  it("plays a melody from the provider's settings and sets the touch distance", () => {
    const sim = setUp();
    sim.runUntil(arrival(0) - 100);
    expect(sim.next).toHaveBeenCalledTimes(1);
    expect(sim.setTouchThreshold).toHaveBeenCalledWith(0.32);

    MELODY.forEach((finger, index) => {
      sim.runUntil(arrival(index) - 50);
      sim.touch(finger, arrival(index) + (index % 2 === 0 ? -150 : 150));
      sim.runUntil(arrival(index) + 200);
      sim.release(finger, arrival(index) + 250);
    });
    sim.runUntil(arrival(3) + 3000);

    expect(sim.note).toHaveBeenCalledTimes(4);
    expect(sim.note.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3]);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.target).toEqual({ kind: "sequence", notes: MELODY });
    expect(trial.params).toEqual(PARAMS);
    expect(trial.metrics).toMatchObject({
      notes_total: 4,
      hits: 4,
      wrong_finger: 0,
      missed: 0,
      hit_rate: 1,
      mean_timing_error_ms: 150,
    });
    const details = sim.game.getSummary().summary.details;
    expect(details?.[DETAIL_NOTE_HIT_RATE]).toBe(1);
    // Every finger played its one note: the first in finger order is the best.
    expect(details?.[DETAIL_BEST_FINGER]).toBe("index");
    expect(details).toMatchObject({
      hit_rate_index: 1,
      hit_rate_middle: 1,
      hit_rate_ring: 1,
      hit_rate_little: 1,
    });
  });

  it("plays a muted sound for a wrong finger and records it", () => {
    const sim = setUp();
    sim.runUntil(arrival(0) - 50);
    sim.touch("little", arrival(0));
    sim.runUntil(arrival(3) + 3000);

    expect(sim.muted).toHaveBeenCalledTimes(1);
    expect(sim.note).not.toHaveBeenCalled();
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics).toMatchObject({ hits: 0, wrong_finger: 1, missed: 3 });
    const details = sim.game.getSummary().summary.details;
    expect(details?.[DETAIL_BEST_FINGER]).toBeNull();
    expect(details?.hit_rate_index).toBe(0);
    expect(sim.game.getSummary().score).toBe(0);
  });

  it("ignores touches while paused, and starts the melody again after a pause", () => {
    const sim = setUp();
    sim.runUntil(arrival(0) - 50);
    sim.game.pause();
    sim.touch("index", arrival(0));
    sim.game.resume();
    expect(sim.logged).toHaveLength(0);
    sim.runUntil(arrival(0) + 100);
    // A new melody, with a new preview: nothing has been played or logged.
    expect(sim.next).toHaveBeenCalledTimes(2);
    expect(sim.note).not.toHaveBeenCalled();
  });

  it("makes its own melody if the provider sends none", () => {
    const withoutMelody = { ...PARAMS };
    for (let position = 1; position <= 4; position++) delete withoutMelody[`note_${position}`];
    const sim = setUp(withoutMelody);
    sim.runUntil(arrival(3) + 3000);
    const notes = sim.logged[0].target?.notes ?? [];
    expect(notes).toHaveLength(4);
    expect(new Set(notes).size).toBe(4);
  });

  it("stops listening to touches when destroyed", () => {
    const sim = setUp();
    expect(sim.listeners.size).toBe(1);
    sim.game.destroy();
    expect(sim.listeners.size).toBe(0);
  });
});
