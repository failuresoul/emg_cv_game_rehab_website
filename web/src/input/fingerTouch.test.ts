import { afterEach, describe, expect, it, vi } from "vitest";

import type { VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import type { VisionFrameSource } from "./cvApertureSource";
import {
  DEFAULT_TOUCH_THRESHOLD,
  type FingerTouchEvent,
  FingerTouchDetector,
  TOUCH_HYSTERESIS,
  touchThresholdFromWarmup,
} from "./fingerTouch";
import { CvFingerTouchSource, KeyboardFingerTouchSource } from "./fingerTouchSource";
import { TouchManager } from "./touchManager";

const FAR = 1.2;
/** Distances to the index, middle, ring and little fingertips, with one finger near. */
const near = (index: number, value: number, others = FAR) =>
  [0, 1, 2, 3].map((finger) => (finger === index ? value : others));

/** Feeds frames 33 ms apart and returns every event. */
function feed(detector: FingerTouchDetector, frames: (number[] | null)[]): FingerTouchEvent[] {
  return frames.flatMap((frame, index) => detector.update(frame, index * 33));
}

const kinds = (events: FingerTouchEvent[]) =>
  events.map((event) => `${event.type}:${event.finger}`);

type ThumbResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "thresholds">;

describe("FingerTouchDetector", () => {
  it("starts a touch below the threshold and ends it above threshold + 0.1", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    expect(detector.update(near(1, 0.5), 0)).toEqual([]);
    expect(detector.update(near(1, 0.25), 33)).toEqual([
      { type: "touchStart", finger: "middle", t: 33 },
    ]);
    expect(detector.finger).toBe("middle");
    // Past the threshold but within the hysteresis: still touching.
    expect(detector.update(near(1, 0.38), 66)).toEqual([]);
    expect(detector.update(near(1, 0.41), 99)).toEqual([
      { type: "touchEnd", finger: "middle", t: 99 },
    ]);
    expect(detector.finger).toBeNull();
  });

  it("makes no double touches from jitter around the threshold", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    const jitter = [0.31, 0.29, 0.32, 0.27, 0.34, 0.29, 0.36, 0.3, 0.39, 0.28, 0.33];
    const events = feed(
      detector,
      jitter.map((value) => near(0, value)),
    );
    expect(kinds(events)).toEqual(["touchStart:index"]);
  });

  it("touches again only after a real release", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    const values = [0.2, 0.45, 0.35, 0.2, 0.5];
    expect(
      kinds(
        feed(
          detector,
          values.map((value) => near(2, value)),
        ),
      ),
    ).toEqual(["touchStart:ring", "touchEnd:ring", "touchStart:ring", "touchEnd:ring"]);
  });

  it("touches only the closest finger when two are below the threshold", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    expect(kinds(detector.update([0.25, 0.12, 0.28, 0.9], 0))).toEqual(["touchStart:middle"]);
    expect(detector.finger).toBe("middle");
  });

  it("keeps one finger at a time while a neighbour jitters close", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    const frames = [
      [0.15, 0.4, FAR, FAR],
      [0.2, 0.17, FAR, FAR], // Middle closer, but not by the hysteresis: stays on index.
      [0.18, 0.2, FAR, FAR],
      [0.21, 0.16, FAR, FAR],
    ];
    expect(kinds(feed(detector, frames))).toEqual(["touchStart:index"]);
  });

  it("moves the touch when the thumb slides clearly onto another finger", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    const events = feed(detector, [
      [0.15, 0.5, FAR, FAR],
      [0.32, 0.15, FAR, FAR],
    ]);
    expect(kinds(events)).toEqual(["touchStart:index", "touchEnd:index", "touchStart:middle"]);
    expect(events[1].t).toBe(events[2].t);
    expect(detector.finger).toBe("middle");
  });

  it("starts a new touch in the same frame as a release when the thumb jumps", () => {
    const detector = new FingerTouchDetector({ threshold: 0.3 });
    const events = feed(detector, [near(0, 0.1), near(3, 0.1)]);
    expect(kinds(events)).toEqual(["touchStart:index", "touchEnd:index", "touchStart:little"]);
  });

  it("ends a touch when the hand is lost", () => {
    const detector = new FingerTouchDetector();
    expect(kinds(feed(detector, [near(0, 0.1), null, null]))).toEqual([
      "touchStart:index",
      "touchEnd:index",
    ]);
  });

  it("treats a missing or broken distance as far away", () => {
    const detector = new FingerTouchDetector();
    expect(detector.update([Number.NaN, Infinity, 0.5, FAR], 0)).toEqual([]);
    expect(detector.update([0.1, 0.2], 33)).toEqual([
      { type: "touchStart", finger: "index", t: 33 },
    ]);
  });

  it("uses 0.3 and 0.1 by default and rejects unusable settings", () => {
    expect(DEFAULT_TOUCH_THRESHOLD).toBe(0.3);
    expect(TOUCH_HYSTERESIS).toBe(0.1);
    expect(new FingerTouchDetector().threshold).toBe(0.3);
    expect(() => new FingerTouchDetector({ threshold: 0 })).toThrow(RangeError);
    expect(() => new FingerTouchDetector({ hysteresis: -1 })).toThrow(RangeError);
  });

  it("uses a personal threshold", () => {
    const detector = new FingerTouchDetector({ threshold: 0.4 });
    expect(kinds(feed(detector, [near(0, 0.38), near(0, 0.48), near(0, 0.51)]))).toEqual([
      "touchStart:index",
      "touchEnd:index",
    ]);
  });
});

describe("touchThresholdFromWarmup", () => {
  const thumb = (changes: Partial<ThumbResult> = {}): ThumbResult => ({
    exerciseId: "thumb_opposition",
    skipped: false,
    thresholds: { low: 0.35, high: 0.5 },
    ...changes,
  });

  it("takes the latest thumb opposition touch distance", () => {
    expect(
      touchThresholdFromWarmup([
        thumb({ thresholds: { low: 0.25, high: 0.4 } }),
        { ...thumb(), exerciseId: "hand_open_close", thresholds: { low: 1.2, high: 1.6 } },
        thumb(),
      ]),
    ).toEqual({ threshold: 0.35, origin: "warmup" });
  });

  it.each([
    ["no results", []],
    ["a skipped exercise", [thumb({ skipped: true })]],
    ["an unusable value", [thumb({ thresholds: { low: Number.NaN, high: 0.5 } })]],
  ])("falls back to 0.3 with %s", (_, results) => {
    expect(touchThresholdFromWarmup(results)).toEqual({ threshold: 0.3, origin: "default" });
  });
});

describe("CvFingerTouchSource", () => {
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

  it("reports touches of the affected hand and is not ready without it", () => {
    const { engine, listeners } = fakeEngine();
    const source = new CvFingerTouchSource({ affectedSide: "left", engine, threshold: 0.3 });
    const events: FingerTouchEvent[] = [];
    source.subscribe((event) => events.push(event));
    source.start();
    expect(listeners.size).toBe(1);
    expect(source.isReady()).toBe(false);

    source.pushDistances(near(2, 0.2), 100);
    expect(source.isReady()).toBe(true);
    expect(source.getTouch()).toBe("ring");

    // A frame with no hand at all.
    listeners.forEach((listener) =>
      listener({
        timestamp: 200,
        hand: null,
        hands: [],
        pose: null,
        poseWorld: null,
        fps: 30,
        delegate: "GPU",
        brightness: null,
        frameWidth: 640,
        frameHeight: 480,
      }),
    );
    expect(source.isReady()).toBe(false);
    expect(source.getTouch()).toBeNull();
    expect(events).toEqual([
      { type: "touchStart", finger: "ring", t: 100 },
      { type: "touchEnd", finger: "ring", t: 200 },
    ]);
    source.stop();
    expect(listeners.size).toBe(0);
  });
});

describe("KeyboardFingerTouchSource", () => {
  function create() {
    const source = new KeyboardFingerTouchSource({ now: () => 0 });
    const events: FingerTouchEvent[] = [];
    source.subscribe((event) => events.push(event));
    return { source, events };
  }

  it("touches while a number is held and ends on release", () => {
    const { source, events } = create();
    expect(source.isReady()).toBe(true);
    source.press("ring", 10);
    source.press("ring", 20); // Held: no second touch.
    expect(source.getTouch()).toBe("ring");
    source.release("ring", 30);
    expect(events).toEqual([
      { type: "touchStart", finger: "ring", t: 10 },
      { type: "touchEnd", finger: "ring", t: 30 },
    ]);
  });

  it("touches one finger at a time", () => {
    const { source, events } = create();
    source.press("index", 0);
    source.press("little", 50);
    source.release("index", 60); // Already moved on: nothing.
    expect(source.getTouch()).toBe("little");
    expect(kinds(events)).toEqual(["touchStart:index", "touchEnd:index", "touchStart:little"]);
  });

  it("ends a held touch on stop", () => {
    const { source, events } = create();
    source.press("middle", 0);
    source.stop();
    expect(source.getTouch()).toBeNull();
    expect(kinds(events)).toEqual(["touchStart:middle", "touchEnd:middle"]);
  });

  describe("with key events", () => {
    afterEach(() => vi.unstubAllGlobals());

    const key = (type: string, code: string, changes: object = {}) =>
      Object.assign(new Event(type, { cancelable: true }), {
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...changes,
      });

    it("maps keys 1–4 to index…little and ignores other keys", () => {
      const target = new EventTarget();
      vi.stubGlobal("window", target);
      const { source, events } = create();
      source.start();
      target.dispatchEvent(key("keydown", "Digit1"));
      target.dispatchEvent(key("keydown", "Digit1", { repeat: true }));
      target.dispatchEvent(key("keyup", "Digit1"));
      target.dispatchEvent(key("keydown", "Digit5"));
      target.dispatchEvent(key("keydown", "Numpad4"));
      target.dispatchEvent(key("keydown", "Digit2", { ctrlKey: true }));
      expect(kinds(events)).toEqual(["touchStart:index", "touchEnd:index", "touchStart:little"]);

      target.dispatchEvent(new Event("blur"));
      expect(source.getTouch()).toBeNull();
      source.stop();
      target.dispatchEvent(key("keydown", "Digit3"));
      expect(source.getTouch()).toBeNull();
    });
  });
});

describe("TouchManager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes on the chosen source's touches and ends a touch when switching", () => {
    vi.stubGlobal("window", new EventTarget());
    const keyboard = new KeyboardFingerTouchSource({ now: () => 500 });
    const camera = new CvFingerTouchSource({
      affectedSide: "left",
      engine: { subscribe: () => () => {} },
    });
    const manager = new TouchManager([camera, keyboard]);
    const events: FingerTouchEvent[] = [];
    manager.subscribe((event) => events.push(event));
    expect(manager.sourceId).toBe("cv_touch");
    manager.start();

    keyboard.press("index", 0); // Not chosen: ignored.
    keyboard.release("index", 1);
    camera.pushDistances(near(1, 0.1), 10);
    expect(manager.getTouch()).toBe("middle");

    manager.select("keyboard");
    expect(kinds(events)).toEqual(["touchStart:middle", "touchEnd:middle"]);
    expect(manager.isReady()).toBe(true);

    keyboard.press("ring", 20);
    manager.stop();
    expect(kinds(events).slice(2)).toEqual(["touchStart:ring", "touchEnd:ring"]);
  });

  it("rejects an initial source it does not have", () => {
    expect(() => new TouchManager([new KeyboardFingerTouchSource()])).toThrow();
  });
});
