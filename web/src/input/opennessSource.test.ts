import { afterEach, describe, expect, it, vi } from "vitest";

import type { VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import {
  APERTURE_SMOOTHING_ALPHA,
  apertureRefsFromWarmup,
  type VisionFrameSource,
} from "./cvApertureSource";
import { apertureToLevel } from "./cvGripSource";
import { EmgSource } from "./emgSource";
import { InputManager } from "./inputManager";
import { KeyboardSource } from "./keyboardSource";
import { apertureToOpenness, CvOpennessSource, OPENNESS_KEY_CODE } from "./opennessSource";
import type { OpennessSourceId } from "./types";

type HandResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

function handResult(changes: Partial<HandResult> = {}): HandResult {
  return {
    exerciseId: "hand_open_close",
    skipped: false,
    bestPeak: 1.8,
    thresholds: { low: 1.2, high: 1.6 },
    ...changes,
  };
}

function fakeEngine() {
  const listeners = new Set<(result: VisionResult) => void>();
  const engine: VisionFrameSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { engine, listeners };
}

const emptyFrame: VisionResult = {
  timestamp: 0,
  hand: null,
  hands: [],
  pose: null,
  poseWorld: null,
  fps: 30,
  delegate: "GPU",
  brightness: null,
  frameWidth: 640,
  frameHeight: 480,
};

describe("apertureToOpenness", () => {
  it("is 0 for a fist and 1 for an open hand with the default references (1.1 / 1.6)", () => {
    expect(apertureToOpenness(1.1)).toBe(0);
    expect(apertureToOpenness(1.6)).toBe(1);
    expect(apertureToOpenness(1.35)).toBeCloseTo(0.5);
  });

  it("clamps a hand closed tighter or opened wider than the references", () => {
    expect(apertureToOpenness(0.7)).toBe(0);
    expect(apertureToOpenness(2.4)).toBe(1);
  });

  it("uses the patient's personal references from the hand open-close warm-up", () => {
    const refs = apertureRefsFromWarmup([handResult()]); // open 1.8, closed 1.2
    expect(apertureToOpenness(1.2, refs)).toBe(0);
    expect(apertureToOpenness(1.5, refs)).toBeCloseTo(0.5);
    expect(apertureToOpenness(1.8, refs)).toBe(1);
    // The default references would already call 1.6 fully open.
    expect(apertureToOpenness(1.6, refs)).toBeCloseTo(2 / 3);
  });

  it("uses the latest hand open-close result", () => {
    const refs = apertureRefsFromWarmup([
      handResult({ bestPeak: 2.0 }),
      handResult({ bestPeak: 1.7, thresholds: { low: 1.3, high: 1.5 } }),
    ]);
    expect(apertureToOpenness(1.5, refs)).toBeCloseTo(0.5);
  });

  it("falls back to the defaults without a usable warm-up", () => {
    const refs = apertureRefsFromWarmup([handResult({ skipped: true })]);
    expect(refs).toMatchObject({ openRef: 1.6, closedRef: 1.1, origin: "default" });
  });

  it("is the mirror of the grip level", () => {
    for (const aperture of [0.9, 1.1, 1.25, 1.4, 1.6, 1.9]) {
      expect(apertureToOpenness(aperture) + apertureToLevel(aperture)).toBeCloseTo(1);
    }
  });

  it("is 0 rather than a wrong number for unusable references or values", () => {
    expect(apertureToOpenness(1.3, { openRef: 1.1, closedRef: 1.1 })).toBe(0);
    expect(apertureToOpenness(1.3, { openRef: 1.0, closedRef: 1.5 })).toBe(0);
    expect(apertureToOpenness(Number.NaN)).toBe(0);
  });
});

describe("CvOpennessSource", () => {
  const create = () => new CvOpennessSource({ affectedSide: "right", engine: fakeEngine().engine });

  it("is not ready and reads 0 before the hand is seen", () => {
    const source = create();
    expect(source.isReady()).toBe(false);
    expect(source.getLevel()).toBe(0);
  });

  it("takes the first frame as it is, then smooths with alpha 0.5", () => {
    const source = create();
    source.pushAperture(1.35); // 0.5
    expect(source.getLevel()).toBeCloseTo(0.5);
    source.pushAperture(1.6); // 1
    expect(source.getLevel()).toBeCloseTo(APERTURE_SMOOTHING_ALPHA * 1 + 0.5 * 0.5);
    source.pushAperture(1.6);
    expect(source.getLevel()).toBeCloseTo(0.875);
  });

  it("is not ready and reads 0 while the affected hand is not visible", () => {
    const { engine, listeners } = fakeEngine();
    const source = new CvOpennessSource({ affectedSide: "right", engine });
    source.start();
    source.pushAperture(1.6);
    expect(source.isReady()).toBe(true);
    listeners.forEach((listener) => listener(emptyFrame));
    expect(source.isReady()).toBe(false);
    expect(source.getLevel()).toBe(0);
    source.stop();
    expect(listeners.size).toBe(0);
  });

  it("uses personal references", () => {
    const source = new CvOpennessSource({
      affectedSide: "right",
      engine: fakeEngine().engine,
      refs: { openRef: 1.8, closedRef: 1.2 },
    });
    source.pushAperture(1.5);
    expect(source.getLevel()).toBeCloseTo(0.5);
    source.setRefs({ openRef: 1.6, closedRef: 1.1 });
    expect(source.currentRefs).toEqual({ openRef: 1.6, closedRef: 1.1 });
  });
});

describe("openness keyboard", () => {
  it("opens over 300 ms while O is held and closes on release", () => {
    const source = new KeyboardSource({ code: OPENNESS_KEY_CODE, now: () => 0 });
    source.press(0);
    expect(source.getLevel(150)).toBeCloseTo(0.5);
    expect(source.getLevel(300)).toBe(1);
    source.release(1000);
    expect(source.getLevel(1000)).toBe(1);
    expect(source.getLevel(2000)).toBe(0);
  });

  describe("with key events", () => {
    afterEach(() => vi.unstubAllGlobals());

    function key(type: "keydown" | "keyup", code: string, changes: object = {}) {
      return Object.assign(new Event(type, { cancelable: true }), {
        code,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...changes,
      });
    }

    it("listens to O and ignores Space, so squeeze and open stay separate", () => {
      const target = new EventTarget();
      vi.stubGlobal("window", target);
      vi.stubGlobal("requestAnimationFrame", () => 1);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      let time = 0;
      const source = new KeyboardSource({ code: OPENNESS_KEY_CODE, now: () => time });
      source.start();

      target.dispatchEvent(key("keydown", "Space"));
      time = 300;
      expect(source.getLevel()).toBe(0);

      const down = key("keydown", "KeyO");
      target.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      time = 600;
      expect(source.getLevel()).toBe(1);

      target.dispatchEvent(key("keyup", "KeyO"));
      time = 2000;
      expect(source.getLevel()).toBe(0);

      // Ctrl+O is the browser's, not a press.
      target.dispatchEvent(key("keydown", "KeyO", { ctrlKey: true }));
      time = 3000;
      expect(source.getLevel()).toBe(0);
      source.stop();
    });
  });
});

describe("openness InputManager", () => {
  function create() {
    const camera = new CvOpennessSource({ affectedSide: "left", engine: fakeEngine().engine });
    const keyboard = new KeyboardSource({ code: OPENNESS_KEY_CODE, now: () => 0 });
    const manager = new InputManager<OpennessSourceId>(
      [camera, keyboard, new EmgSource({ channel: "extensor" })],
      "cv_openness",
    );
    return { camera, keyboard, manager };
  }

  it("starts on the camera and toggles to the keyboard and back", () => {
    const { manager } = create();
    expect(manager.sourceId).toBe("cv_openness");
    manager.toggleKeyboard();
    expect(manager.sourceId).toBe("keyboard");
    manager.toggleKeyboard();
    expect(manager.sourceId).toBe("cv_openness");
  });

  it("reads the EMG placeholder as never ready", () => {
    const { manager } = create();
    manager.select("emg");
    expect(manager.isReady()).toBe(false);
    expect(manager.getLevel()).toBe(0);
  });
});
