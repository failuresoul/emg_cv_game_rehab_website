import type { Side } from "@/types/api";
import type { VisionResult } from "@/vision/visionEngine";

import { affectedHandMeasures, type VisionFrameSource } from "./cvApertureSource";
import {
  DEFAULT_TOUCH_THRESHOLD,
  type Finger,
  type FingerTouchEvent,
  FingerTouchDetector,
  type FingerTouchListener,
  type FingerTouchSource,
} from "./fingerTouch";
import { isTyping, Listeners } from "./types";

export interface CvFingerTouchSourceOptions {
  affectedSide: Side;
  engine: VisionFrameSource;
  threshold?: number;
}

/**
 * Thumb-to-finger touches of the affected hand from the camera. It only listens to the vision
 * engine, so something else on the page must start the camera.
 */
export class CvFingerTouchSource implements FingerTouchSource {
  readonly id = "cv_touch";
  readonly labelKey = "input.source.cvTouch";
  private readonly affectedSide: Side;
  private readonly engine: VisionFrameSource;
  private readonly detector: FingerTouchDetector;
  private readonly listeners = new Listeners<FingerTouchEvent>();
  private ready = false;
  private unsubscribe: (() => void) | null = null;

  constructor({
    affectedSide,
    engine,
    threshold = DEFAULT_TOUCH_THRESHOLD,
  }: CvFingerTouchSourceOptions) {
    this.affectedSide = affectedSide;
    this.engine = engine;
    this.detector = new FingerTouchDetector({ threshold });
  }

  get threshold(): number {
    return this.detector.threshold;
  }

  setThreshold(threshold: number): void {
    this.detector.setThreshold(threshold);
  }

  isReady(): boolean {
    return this.ready;
  }

  getTouch(): Finger | null {
    return this.detector.finger;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.subscribe((result) => this.processFrame(result));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pushDistances(null, performance.now());
  }

  subscribe(listener: FingerTouchListener): () => void {
    return this.listeners.add(listener);
  }

  processFrame(result: VisionResult): void {
    const measures = affectedHandMeasures(result, this.affectedSide);
    this.pushDistances(measures?.thumbFingerDistances ?? null, result.timestamp);
  }

  /** One frame's thumb distances of the affected hand, or null when the hand is not visible. */
  pushDistances(distances: readonly number[] | null, t: number): void {
    this.ready = distances !== null;
    this.detector.update(distances, t).forEach((event) => this.listeners.emit(event));
  }
}

const KEY_FINGERS: Readonly<Record<string, Finger>> = {
  Digit1: "index",
  Digit2: "middle",
  Digit3: "ring",
  Digit4: "little",
  Numpad1: "index",
  Numpad2: "middle",
  Numpad3: "ring",
  Numpad4: "little",
};

export interface KeyboardFingerTouchSourceOptions {
  now?: () => number;
}

/**
 * For testing without a camera: holding 1, 2, 3 or 4 touches the index, middle, ring or little
 * finger. Pressing another number moves the touch, so only one finger is touched at a time.
 */
export class KeyboardFingerTouchSource implements FingerTouchSource {
  readonly id = "keyboard";
  readonly labelKey = "input.source.keyboard";
  private readonly now: () => number;
  private readonly listeners = new Listeners<FingerTouchEvent>();
  private current: Finger | null = null;
  private running = false;

  constructor({ now = () => performance.now() }: KeyboardFingerTouchSourceOptions = {}) {
    this.now = now;
  }

  isReady(): boolean {
    return true;
  }

  getTouch(): Finger | null {
    return this.current;
  }

  /** A finger's key pressed. Repeats while it is held change nothing. */
  press(finger: Finger, t: number = this.now()): void {
    if (this.current === finger) return;
    this.end(t);
    this.current = finger;
    this.listeners.emit({ type: "touchStart", finger, t });
  }

  /** A finger's key released. Only the finger touched now can end its touch. */
  release(finger: Finger, t: number = this.now()): void {
    if (this.current === finger) this.end(t);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  stop(): void {
    if (this.running) {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
    }
    this.running = false;
    this.end(this.now());
  }

  subscribe(listener: FingerTouchListener): () => void {
    return this.listeners.add(listener);
  }

  private end(t: number): void {
    if (this.current === null) return;
    const finger = this.current;
    this.current = null;
    this.listeners.emit({ type: "touchEnd", finger, t });
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const finger = KEY_FINGERS[event.code];
    if (!finger || event.repeat || isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    this.press(finger);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    const finger = KEY_FINGERS[event.code];
    if (!finger) return;
    this.release(finger);
  };

  /** A key released in another window never reaches this one. */
  private readonly onBlur = () => this.end(this.now());
}
