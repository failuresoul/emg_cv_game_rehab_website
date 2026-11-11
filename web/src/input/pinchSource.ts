import type { Side } from "@/types/api";
import { type Point, toBodyFrame, toPixel } from "@/vision/geometry";
import { selectAffectedHand } from "@/vision/hand";
import { HAND } from "@/vision/landmarks";
import { OneEuroFilter2D } from "@/vision/oneEuro";
import { Tracker } from "@/vision/tracking";
import type { VisionResult } from "@/vision/visionEngine";

import { affectedHandMeasures, type VisionFrameSource } from "./cvApertureSource";
import {
  DEFAULT_PINCH_THRESHOLD,
  IDLE_PINCH,
  midpoint,
  type PinchEvent,
  PinchDetector,
  type PinchListener,
  type PinchSource,
  type PinchSourceId,
  type PinchState,
  type PinchStateListener,
} from "./pinch";
import { isTyping, Listeners } from "./types";

/** One frame of the affected hand: its thumb-to-index distance and the pinch point. */
export interface PinchSample {
  /** In palm lengths. */
  distance: number;
  /** RAW, in SW; null until the body frame is known. */
  pointRawSw: Point | null;
}

export interface CvPinchSourceOptions {
  affectedSide: Side;
  engine: VisionFrameSource;
  threshold?: number;
}

/**
 * The thumb-and-index pinch of the affected hand from the camera. It only listens to the vision
 * engine, so something else on the page must start the camera. The body frame comes from the same
 * Tracker the games use, so the pinch point lines up with the fingertip cursor.
 */
export class CvPinchSource implements PinchSource {
  readonly id = "cv_pinch";
  readonly labelKey = "input.source.cvPinch";
  private readonly affectedSide: Side;
  private readonly engine: VisionFrameSource;
  private readonly tracker: Tracker;
  private readonly detector: PinchDetector;
  private readonly smoothing = new OneEuroFilter2D();
  private readonly events = new Listeners<PinchEvent>();
  private readonly states = new Listeners<PinchState>();
  private state: PinchState = IDLE_PINCH;
  private lastPoint: Point | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor({ affectedSide, engine, threshold = DEFAULT_PINCH_THRESHOLD }: CvPinchSourceOptions) {
    this.affectedSide = affectedSide;
    this.engine = engine;
    this.tracker = new Tracker(affectedSide);
    this.detector = new PinchDetector({ threshold });
  }

  get threshold(): number {
    return this.detector.threshold;
  }

  setThreshold(threshold: number): void {
    this.detector.setThreshold(threshold);
  }

  isReady(): boolean {
    return this.state.ready;
  }

  getState(): PinchState {
    return this.state;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.subscribe((result) => this.processFrame(result));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pushSample(null, performance.now());
  }

  subscribe(listener: PinchListener): () => void {
    return this.events.add(listener);
  }

  subscribeState(listener: PinchStateListener): () => void {
    return this.states.add(listener);
  }

  processFrame(result: VisionResult): void {
    const { frame } = this.tracker.process(result);
    const measures = affectedHandMeasures(result, this.affectedSide);
    const hand = measures ? selectAffectedHand(result, this.affectedSide) : null;
    const thumb = hand?.landmarks[HAND.THUMB_TIP];
    const index = hand?.landmarks[HAND.INDEX_TIP];
    if (!measures || !thumb || !index) {
      this.pushSample(null, result.timestamp);
      return;
    }
    const { frameWidth, frameHeight } = result;
    const pointPx = midpoint(
      toPixel(thumb, frameWidth, frameHeight),
      toPixel(index, frameWidth, frameHeight),
    );
    this.pushSample(
      {
        distance: measures.thumbFingerDistances[0],
        pointRawSw: frame ? toBodyFrame(pointPx, frame) : null,
      },
      result.timestamp,
    );
  }

  /** One frame of the affected hand, or null when it is not visible. */
  pushSample(sample: PinchSample | null, t: number): void {
    const distance = sample && Number.isFinite(sample.distance) ? sample.distance : null;
    const pointRawSw = distance === null ? null : (sample?.pointRawSw ?? null);
    // Without a point the filter restarts, so the drawn point jumps to where the hand comes back.
    if (!pointRawSw) this.smoothing.reset();
    const pointSmoothSw = pointRawSw ? this.smoothing.filter(pointRawSw, t) : null;
    const change = this.detector.update(distance);
    this.state = {
      ready: distance !== null,
      pinching: this.detector.pinching,
      strength: this.detector.strength(distance),
      pointRawSw,
      pointSmoothSw,
      t,
    };
    if (change) {
      // A pinch that ends because the hand was lost keeps the last point it was seen at.
      const at = pointRawSw ?? (change === "end" ? this.lastPoint : null);
      this.events.emit({ type: change === "start" ? "pinchStart" : "pinchEnd", t, pointRawSw: at });
    }
    if (pointRawSw) this.lastPoint = pointRawSw;
    this.states.emit(this.state);
  }
}

export const PINCH_KEY_CODE = "KeyP";

/** Where the on-screen fingertip cursor is: RAW for saved data and smoothed for drawing. */
export interface CursorSample {
  rawSw: Point | null;
  smoothSw: Point | null;
}

export interface KeyboardPinchSourceOptions {
  /** With both, the pinch point follows the fingertip cursor worked out from these frames. */
  affectedSide?: Side | null;
  engine?: VisionFrameSource;
  now?: () => number;
}

/**
 * For testing without pinching: holding P pinches at full strength. The pinch point is the
 * fingertip cursor the games draw, from the same Tracker, so a pinch lands where the cursor is.
 */
export class KeyboardPinchSource implements PinchSource {
  readonly id = "keyboard";
  readonly labelKey = "input.source.keyboard";
  private readonly now: () => number;
  private readonly engine: VisionFrameSource | null;
  private readonly tracker: Tracker | null;
  private readonly events = new Listeners<PinchEvent>();
  private readonly states = new Listeners<PinchState>();
  private cursor: CursorSample = { rawSw: null, smoothSw: null };
  private pressed = false;
  private state: PinchState = { ...IDLE_PINCH, ready: true };
  private running = false;
  private unsubscribe: (() => void) | null = null;

  constructor({
    affectedSide = null,
    engine,
    now = () => performance.now(),
  }: KeyboardPinchSourceOptions = {}) {
    this.now = now;
    this.engine = engine && affectedSide ? engine : null;
    this.tracker = this.engine && affectedSide ? new Tracker(affectedSide) : null;
  }

  isReady(): boolean {
    return true;
  }

  getState(): PinchState {
    return this.state;
  }

  /** The key pressed. Repeats while it is held change nothing. */
  press(t: number = this.now()): void {
    if (this.pressed) return;
    this.pressed = true;
    this.update(t, "pinchStart");
  }

  release(t: number = this.now()): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.update(t, "pinchEnd");
  }

  /** The fingertip cursor moved. */
  pushCursor(cursor: CursorSample, t: number = this.now()): void {
    this.cursor = { rawSw: cursor.rawSw, smoothSw: cursor.smoothSw };
    this.update(t, null);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    if (this.engine && this.tracker) {
      const tracker = this.tracker;
      this.unsubscribe = this.engine.subscribe((result) => {
        const tracking = tracker.process(result);
        this.pushCursor(
          { rawSw: tracking.fingertipRawSw, smoothSw: tracking.fingertipSmoothSw },
          result.timestamp,
        );
      });
    }
  }

  stop(): void {
    if (this.running) {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
    }
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.release();
  }

  subscribe(listener: PinchListener): () => void {
    return this.events.add(listener);
  }

  subscribeState(listener: PinchStateListener): () => void {
    return this.states.add(listener);
  }

  private update(t: number, change: PinchEvent["type"] | null): void {
    this.state = {
      ready: true,
      pinching: this.pressed,
      strength: this.pressed ? 1 : 0,
      pointRawSw: this.cursor.rawSw,
      pointSmoothSw: this.cursor.smoothSw,
      t,
    };
    if (change) this.events.emit({ type: change, t, pointRawSw: this.cursor.rawSw });
    this.states.emit(this.state);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== PINCH_KEY_CODE || event.repeat || isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    this.press();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.code === PINCH_KEY_CODE) this.release();
  };

  /** A key released in another window never reaches this one. */
  private readonly onBlur = () => this.release();
}

export const DEFAULT_PINCH_SOURCE_ID: PinchSourceId = "cv_pinch";

/**
 * Holds every pinch source and runs the chosen one, passing its pinches and states on. Switching
 * source ends a pinch in progress first, so listeners never keep a pinch that no source holds.
 */
export class PinchManager {
  private readonly sources: ReadonlyMap<PinchSourceId, PinchSource>;
  private readonly events = new Listeners<PinchEvent>();
  private readonly states = new Listeners<PinchState>();
  private activeId: PinchSourceId;
  private running = false;
  private unsubscribeSource: (() => void) | null = null;

  constructor(sources: readonly PinchSource[], initial: PinchSourceId = DEFAULT_PINCH_SOURCE_ID) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    if (!this.sources.has(initial)) throw new Error(`No pinch source "${initial}"`);
    this.activeId = initial;
  }

  get sourceId(): PinchSourceId {
    return this.activeId;
  }

  get source(): PinchSource {
    return this.sources.get(this.activeId) as PinchSource;
  }

  getState(): PinchState {
    return this.source.getState();
  }

  isReady(): boolean {
    return this.source.isReady();
  }

  /** Sets the pinch distance on every source that measures one, chosen or not. */
  setThreshold(threshold: number): void {
    this.sources.forEach((source) => source.setThreshold?.(threshold));
  }

  /** Does nothing for a source the manager does not have. */
  select(id: PinchSourceId): void {
    if (id === this.activeId || !this.sources.has(id)) return;
    if (this.running) this.detach();
    this.activeId = id;
    if (this.running) this.attach();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attach();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.detach();
  }

  subscribe(listener: PinchListener): () => void {
    return this.events.add(listener);
  }

  subscribeState(listener: PinchStateListener): () => void {
    return this.states.add(listener);
  }

  private attach(): void {
    const source = this.source;
    const offEvents = source.subscribe((event) => this.events.emit(event));
    const offStates = source.subscribeState((state) => this.states.emit(state));
    this.unsubscribeSource = () => {
      offEvents();
      offStates();
    };
    source.start();
  }

  /** Stops before unsubscribing, so the pinchEnd of a pinch in progress still gets through. */
  private detach(): void {
    this.source.stop();
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
  }
}
