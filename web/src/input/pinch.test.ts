import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HAND, POSE } from "@/vision/landmarks";
import type { DetectedHand, VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import type { VisionFrameSource } from "./cvApertureSource";
import { MAX_TOUCH_THRESHOLD } from "./fingerTouch";
import {
  DEFAULT_PINCH_THRESHOLD,
  midpoint,
  PINCH_HYSTERESIS,
  type PinchEvent,
  PinchDetector,
  type PinchState,
  pinchStrength,
  pinchThresholdFromWarmup,
} from "./pinch";
import {
  CvPinchSource,
  KeyboardPinchSource,
  PINCH_KEY_CODE,
  PinchManager,
  type PinchSample,
} from "./pinchSource";

type ThumbResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "thresholds">;

function thumbResult(changes: Partial<ThumbResult> = {}): ThumbResult {
  return {
    exerciseId: "thumb_opposition",
    skipped: false,
    thresholds: { low: 0.4, high: 0.6 },
    ...changes,
  };
}

/** Feeds one distance per frame, 33 ms apart, and returns the changes. */
function feed(detector: PinchDetector, distances: (number | null)[]): string[] {
  return distances.flatMap((distance) => detector.update(distance) ?? []);
}

const at = (distance: number, x = 0.5, y = -0.2): PinchSample => ({
  distance,
  pointRawSw: { x, y },
});

function record(source: CvPinchSource | KeyboardPinchSource | PinchManager) {
  const events: PinchEvent[] = [];
  const states: PinchState[] = [];
  source.subscribe((event) => events.push(event));
  source.subscribeState((state) => states.push(state));
  return { events, states };
}

describe("pinchStrength", () => {
  it("is 1 with the tips together and falls to 0 at threshold + 0.3", () => {
    expect(pinchStrength(0)).toBe(1);
    expect(pinchStrength(0.275)).toBeCloseTo(0.5);
    expect(pinchStrength(DEFAULT_PINCH_THRESHOLD + 0.3)).toBe(0);
    expect(pinchStrength(2)).toBe(0);
  });

  it("follows the threshold and is 0 for an unusable distance", () => {
    expect(pinchStrength(0.35, 0.4)).toBeCloseTo(0.5);
    expect(pinchStrength(Number.NaN)).toBe(0);
  });
});

describe("midpoint", () => {
  it("is halfway between the two points", () => {
    expect(midpoint({ x: 1, y: -2 }, { x: 3, y: 4 })).toEqual({ x: 2, y: 1 });
  });
});

describe("PinchDetector", () => {
  it("starts below the threshold and ends only above threshold + 0.1", () => {
    const detector = new PinchDetector();
    expect(detector.update(0.4)).toBeNull();
    expect(detector.update(0.24)).toBe("start");
    expect(detector.pinching).toBe(true);
    // Past the threshold but within the hysteresis: still pinching.
    expect(detector.update(0.3)).toBeNull();
    expect(detector.update(0.34)).toBeNull();
    expect(detector.pinching).toBe(true);
    expect(detector.update(0.36)).toBe("end");
    expect(detector.pinching).toBe(false);
  });

  it("does not flicker on jitter around the threshold", () => {
    const detector = new PinchDetector();
    const jitter = [0.26, 0.24, 0.27, 0.23, 0.29, 0.24, 0.31, 0.25, 0.34, 0.22, 0.33, 0.26];
    expect(feed(detector, jitter)).toEqual(["start"]);
    // Jitter just above the threshold, before any pinch, starts nothing either.
    expect(feed(new PinchDetector(), [0.25, 0.26, 0.25, 0.27, 0.251])).toEqual([]);
  });

  it("pinches again only after a real release", () => {
    const detector = new PinchDetector();
    expect(feed(detector, [0.1, 0.4, 0.3, 0.2, 0.5])).toEqual(["start", "end", "start", "end"]);
  });

  it("ends a pinch when the hand is lost", () => {
    const detector = new PinchDetector();
    expect(feed(detector, [0.1, null, 0.4])).toEqual(["start", "end"]);
    expect(detector.update(null)).toBeNull();
  });

  it("uses a changed threshold from the next frame, keeping a pinch in progress", () => {
    const detector = new PinchDetector();
    expect(detector.update(0.35)).toBeNull();
    detector.setThreshold(0.4);
    expect(detector.threshold).toBe(0.4);
    expect(detector.update(0.35)).toBe("start");
    detector.setThreshold(0.2);
    expect(detector.update(0.29)).toBeNull();
    expect(detector.update(0.31)).toBe("end");
    detector.setThreshold(0);
    expect(detector.threshold).toBe(0.2);
  });

  it("refuses unusable settings", () => {
    expect(() => new PinchDetector({ threshold: 0 })).toThrow(RangeError);
    expect(() => new PinchDetector({ hysteresis: -0.1 })).toThrow(RangeError);
    expect(PINCH_HYSTERESIS).toBe(0.1);
  });
});

describe("pinchThresholdFromWarmup", () => {
  it("uses the latest thumb opposition warm-up's touch distance", () => {
    expect(
      pinchThresholdFromWarmup([
        thumbResult({ thresholds: { low: 0.3, high: 0.5 } }),
        thumbResult({ thresholds: { low: 0.35, high: 0.5 } }),
      ]),
    ).toEqual({ threshold: 0.35, origin: "warmup" });
  });

  it("falls back to 0.25 without a usable warm-up", () => {
    const fallback = { threshold: DEFAULT_PINCH_THRESHOLD, origin: "default" };
    expect(pinchThresholdFromWarmup([])).toEqual(fallback);
    expect(pinchThresholdFromWarmup([thumbResult({ skipped: true })])).toEqual(fallback);
    expect(
      pinchThresholdFromWarmup([thumbResult({ thresholds: { low: Number.NaN, high: 1 } })]),
    ).toEqual(fallback);
  });

  it("keeps a far-off value within the usable distances", () => {
    expect(
      pinchThresholdFromWarmup([thumbResult({ thresholds: { low: 2, high: 3 } })]).threshold,
    ).toBe(MAX_TOUCH_THRESHOLD);
  });
});

/** A vision engine that sends frames only when the test asks. */
function fakeEngine() {
  const listeners = new Set<(result: VisionResult) => void>();
  const engine: VisionFrameSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { engine, send: (result: VisionResult) => listeners.forEach((send) => send(result)) };
}

const landmark = (x: number, y: number): NormalizedLandmark => ({ x, y, z: 0, visibility: 1 });

/**
 * A 640 × 480 frame, affected side left: shoulders 128 px apart with the left one at (384, 144),
 * and the left hand at the pose's left wrist with a 48 px palm. Thumb and index tips sit at the
 * given image points.
 */
function frameWithHand(thumb: [number, number], index: [number, number], t: number): VisionResult {
  const pose = Array.from({ length: 33 }, () => landmark(0.5, 0.9));
  pose[POSE.LEFT_SHOULDER] = landmark(0.6, 0.3);
  pose[POSE.RIGHT_SHOULDER] = landmark(0.4, 0.3);
  pose[POSE.LEFT_WRIST] = landmark(0.7, 0.5);
  pose[POSE.RIGHT_WRIST] = landmark(0.3, 0.5);
  const landmarks = Array.from({ length: 21 }, () => landmark(0.7, 0.2));
  landmarks[HAND.WRIST] = landmark(0.7, 0.5);
  landmarks[HAND.MIDDLE_MCP] = landmark(0.7, 0.4);
  landmarks[HAND.THUMB_TIP] = landmark(...thumb);
  landmarks[HAND.INDEX_TIP] = landmark(...index);
  const hand: DetectedHand = { landmarks, worldLandmarks: null, handedness: null };
  return {
    timestamp: t,
    hand: landmarks,
    hands: [hand],
    pose,
    poseWorld: null,
    fps: 30,
    delegate: "GPU",
    brightness: null,
    frameWidth: 640,
    frameHeight: 480,
  };
}

describe("CvPinchSource", () => {
  it("reports the pinch, its strength and the midpoint of thumb and index tips in SW", () => {
    const { engine, send } = fakeEngine();
    const source = new CvPinchSource({ affectedSide: "left", engine });
    const { events, states } = record(source);
    source.start();

    // Tips 0.15 palm lengths apart (7.2 px), centred at (500, 168) px.
    send(frameWithHand([496.4 / 640, 0.35], [503.6 / 640, 0.35], 100));
    const state = source.getState();
    expect(state.ready).toBe(true);
    expect(state.pinching).toBe(true);
    expect(state.strength).toBeCloseTo(1 - 0.15 / 0.55);
    // (500 − 384) / 128 outward and (168 − 144) / 128 below the shoulder.
    expect(state.pointRawSw?.x).toBeCloseTo(116 / 128);
    expect(state.pointRawSw?.y).toBeCloseTo(-24 / 128);
    expect(state.pointSmoothSw?.x).toBeCloseTo(116 / 128);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("pinchStart");
    expect(events[0].t).toBe(100);
    expect(events[0].pointRawSw?.x).toBeCloseTo(116 / 128);
    expect(states).toHaveLength(1);

    // Tips a palm length apart: released.
    send(frameWithHand([476 / 640, 0.35], [524 / 640, 0.35], 133));
    expect(source.getState().pinching).toBe(false);
    expect(source.getState().strength).toBe(0);
    expect(events.map((event) => `${event.type}@${event.t}`)).toEqual([
      "pinchStart@100",
      "pinchEnd@133",
    ]);
  });

  it("is not ready, with no point, while the affected hand is out of view", () => {
    const { engine, send } = fakeEngine();
    const source = new CvPinchSource({ affectedSide: "left", engine });
    source.start();
    send({ ...frameWithHand([0.7, 0.35], [0.7, 0.35], 0), hands: [] });
    expect(source.isReady()).toBe(false);
    expect(source.getState().pointRawSw).toBeNull();
    expect(source.getState().strength).toBe(0);
  });

  it("starts and ends pinches with hysteresis, with their times and points", () => {
    const source = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    const { events } = record(source);
    source.pushSample(at(0.3), 0);
    source.pushSample(at(0.2, 0.6), 33);
    source.pushSample(at(0.34), 66);
    source.pushSample(at(0.36, 0.7), 99);
    expect(events).toEqual([
      { type: "pinchStart", t: 33, pointRawSw: { x: 0.6, y: -0.2 } },
      { type: "pinchEnd", t: 99, pointRawSw: { x: 0.7, y: -0.2 } },
    ]);
  });

  it("makes one pinch from jitter around the threshold", () => {
    const source = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    const { events } = record(source);
    [0.26, 0.24, 0.27, 0.23, 0.3, 0.25, 0.33, 0.24].forEach((distance, index) =>
      source.pushSample(at(distance), index * 33),
    );
    expect(events.map((event) => event.type)).toEqual(["pinchStart"]);
  });

  it("ends a pinch at the last seen point when the hand is lost, and on stop", () => {
    const source = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    const { events } = record(source);
    source.pushSample(at(0.1, 0.4), 0);
    source.pushSample(null, 33);
    expect(events[1]).toEqual({ type: "pinchEnd", t: 33, pointRawSw: { x: 0.4, y: -0.2 } });
    expect(source.getState()).toMatchObject({ ready: false, pinching: false, pointRawSw: null });

    source.pushSample(at(0.1), 66);
    source.stop();
    expect(events.map((event) => event.type)).toEqual([
      "pinchStart",
      "pinchEnd",
      "pinchStart",
      "pinchEnd",
    ]);
  });

  it("uses a personal threshold", () => {
    const personal = new CvPinchSource({
      affectedSide: "left",
      engine: fakeEngine().engine,
      threshold: 0.4,
    });
    const usual = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    personal.pushSample(at(0.35), 0);
    usual.pushSample(at(0.35), 0);
    expect(personal.getState().pinching).toBe(true);
    expect(personal.getState().strength).toBeCloseTo(1 - 0.35 / 0.7);
    expect(usual.getState().pinching).toBe(false);

    usual.setThreshold(0.4);
    expect(usual.threshold).toBe(0.4);
    usual.pushSample(at(0.35), 33);
    expect(usual.getState().pinching).toBe(true);
  });

  it("smooths the drawn point but keeps the raw one", () => {
    const source = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    source.pushSample(at(0.5, 0), 0);
    source.pushSample(at(0.5, 1), 33);
    const { pointRawSw, pointSmoothSw } = source.getState();
    expect(pointRawSw?.x).toBe(1);
    expect(pointSmoothSw?.x).toBeGreaterThan(0);
    expect(pointSmoothSw?.x).toBeLessThan(1);
  });
});

describe("KeyboardPinchSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pinches at full strength while held, at the fingertip cursor", () => {
    const source = new KeyboardPinchSource({ now: () => 0 });
    const { events } = record(source);
    expect(source.isReady()).toBe(true);
    source.pushCursor({ rawSw: { x: 0.8, y: 0.1 }, smoothSw: { x: 0.75, y: 0.1 } }, 10);
    source.press(20);
    source.press(25); // A repeat changes nothing.
    expect(source.getState()).toMatchObject({
      pinching: true,
      strength: 1,
      pointRawSw: { x: 0.8, y: 0.1 },
      pointSmoothSw: { x: 0.75, y: 0.1 },
    });

    // The point follows the cursor while the pinch is held.
    source.pushCursor({ rawSw: { x: 1.1, y: 0.3 }, smoothSw: { x: 1, y: 0.3 } }, 40);
    expect(source.getState().pointRawSw).toEqual({ x: 1.1, y: 0.3 });
    source.release(60);
    expect(source.getState()).toMatchObject({ pinching: false, strength: 0 });
    expect(events).toEqual([
      { type: "pinchStart", t: 20, pointRawSw: { x: 0.8, y: 0.1 } },
      { type: "pinchEnd", t: 60, pointRawSw: { x: 1.1, y: 0.3 } },
    ]);
  });

  it("follows the fingertip cursor from the vision engine", () => {
    vi.stubGlobal("window", new EventTarget());
    const { engine, send } = fakeEngine();
    const source = new KeyboardPinchSource({ affectedSide: "left", engine, now: () => 0 });
    source.start();
    // The index tip at (500, 168) px is the cursor.
    send(frameWithHand([0.7, 0.35], [500 / 640, 0.35], 100));
    source.press(110);
    expect(source.getState().pointRawSw?.x).toBeCloseTo(116 / 128);
    expect(source.getState().pointRawSw?.y).toBeCloseTo(-24 / 128);
    expect(source.getState().pointSmoothSw).not.toBeNull();
    source.stop();
  });

  it("reacts to P only, and lets go on blur and stop", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const key = (type: string, code: string, changes: object = {}) =>
      Object.assign(new Event(type, { cancelable: true }), {
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...changes,
      });
    const source = new KeyboardPinchSource({ now: () => 5 });
    const { events } = record(source);
    source.start();
    target.dispatchEvent(key("keydown", "KeyO"));
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE, { ctrlKey: true }));
    expect(source.getState().pinching).toBe(false);
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE));
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE, { repeat: true }));
    target.dispatchEvent(key("keyup", PINCH_KEY_CODE));
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE));
    target.dispatchEvent(new Event("blur"));
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE));
    source.stop();
    target.dispatchEvent(key("keydown", PINCH_KEY_CODE));
    expect(source.getState().pinching).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "pinchStart",
      "pinchEnd",
      "pinchStart",
      "pinchEnd",
      "pinchStart",
      "pinchEnd",
    ]);
  });
});

describe("PinchManager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes on the chosen source's pinches and ends a pinch when switching", () => {
    vi.stubGlobal("window", new EventTarget());
    const camera = new CvPinchSource({ affectedSide: "left", engine: fakeEngine().engine });
    const keyboard = new KeyboardPinchSource({ now: () => 500 });
    const manager = new PinchManager([camera, keyboard]);
    const { events, states } = record(manager);
    expect(manager.sourceId).toBe("cv_pinch");
    manager.start();

    keyboard.press(0); // Not chosen: ignored.
    keyboard.release(1);
    camera.pushSample(at(0.1), 10);
    expect(manager.getState().pinching).toBe(true);
    expect(states).toHaveLength(1);

    manager.select("keyboard");
    expect(events.map((event) => event.type)).toEqual(["pinchStart", "pinchEnd"]);
    expect(manager.isReady()).toBe(true);

    manager.setThreshold(0.4);
    expect(camera.threshold).toBe(0.4);

    keyboard.press(20);
    manager.stop();
    expect(events.slice(2).map((event) => event.type)).toEqual(["pinchStart", "pinchEnd"]);
  });

  it("rejects an initial source it does not have", () => {
    expect(() => new PinchManager([new KeyboardPinchSource()])).toThrow();
  });
});
