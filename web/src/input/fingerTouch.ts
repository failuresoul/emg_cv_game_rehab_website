import type { TranslationKey } from "@/i18n";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

/** The fingers the thumb can touch, in the order of thumbFingerDistances. */
export const FINGERS = ["index", "middle", "ring", "little"] as const;
export type Finger = (typeof FINGERS)[number];

/** Thumb-to-fingertip distance, in palm lengths, that counts as a touch without a warm-up value. */
export const DEFAULT_TOUCH_THRESHOLD = 0.3;
/** A touch ends only once the thumb is this much farther than the threshold, in palm lengths. */
export const TOUCH_HYSTERESIS = 0.1;
/**
 * A warm-up touch distance is kept within these, in palm lengths: closer would need fingertips to
 * overlap, and farther would count a relaxed hand as touching.
 */
export const MIN_TOUCH_THRESHOLD = 0.1;
export const MAX_TOUCH_THRESHOLD = 0.6;

export interface FingerTouchEvent {
  type: "touchStart" | "touchEnd";
  finger: Finger;
  /** When it happened, in ms on the source's clock (performance.now() for live input). */
  t: number;
}

export type FingerTouchListener = (event: FingerTouchEvent) => void;

export type FingerTouchSourceId = "cv_touch" | "keyboard";

/** Which finger the thumb of the affected hand is touching. At most one at a time. */
export interface FingerTouchSource {
  readonly id: FingerTouchSourceId;
  readonly labelKey: TranslationKey;
  /** False while the source cannot measure, for example when the hand is out of view. */
  isReady(): boolean;
  /** The finger touched now, or null. */
  getTouch(): Finger | null;
  start(): void;
  /** Ends any touch in progress, telling listeners. */
  stop(): void;
  /** Called with each touchStart and touchEnd. Returns a function that unsubscribes. */
  subscribe(listener: FingerTouchListener): () => void;
  /** Changes the touch distance, for sources that measure one. A touch in progress carries on. */
  setThreshold?(threshold: number): void;
}

export type TouchThresholdOrigin = "warmup" | "default";

export interface TouchThresholdChoice {
  threshold: number;
  origin: TouchThresholdOrigin;
}

type ThumbWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "thresholds">;

/**
 * The patient's personal touch distance from the latest thumb opposition warm-up: the low
 * threshold, which is the distance its touches were counted at. The default without one.
 */
export function touchThresholdFromWarmup(
  results: readonly ThumbWarmupResult[],
): TouchThresholdChoice {
  return thumbThresholdFromWarmup(results, DEFAULT_TOUCH_THRESHOLD);
}

/**
 * The low threshold of the latest thumb opposition warm-up, kept within the usable touch
 * distances, or `fallback` without a usable result. Shared by finger touches and the pinch.
 */
export function thumbThresholdFromWarmup(
  results: readonly ThumbWarmupResult[],
  fallback: number,
): TouchThresholdChoice {
  const result = results.findLast((item) => item.exerciseId === "thumb_opposition");
  const low = result?.thresholds.low;
  if (!result || result.skipped || low === undefined || !Number.isFinite(low) || !(low > 0)) {
    return { threshold: fallback, origin: "default" };
  }
  return {
    threshold: Math.min(MAX_TOUCH_THRESHOLD, Math.max(MIN_TOUCH_THRESHOLD, low)),
    origin: "warmup",
  };
}

export interface FingerTouchDetectorOptions {
  threshold?: number;
  hysteresis?: number;
}

/**
 * Turns thumb-to-fingertip distances into touches. A touch starts when the closest finger comes
 * below the threshold and ends only above threshold + hysteresis, so jitter around the threshold
 * never makes a second touch. Only one finger is touched at a time: the closest one. Sliding to a
 * neighbouring finger moves the touch only once that finger is closer by at least the hysteresis.
 * Pure: give it each frame's distances and time.
 */
export class FingerTouchDetector {
  private touchThreshold: number;
  private readonly hysteresis: number;
  private current: Finger | null = null;

  constructor({
    threshold = DEFAULT_TOUCH_THRESHOLD,
    hysteresis = TOUCH_HYSTERESIS,
  }: FingerTouchDetectorOptions = {}) {
    if (!(threshold > 0)) throw new RangeError(`threshold (${threshold}) must be above 0`);
    if (!(hysteresis >= 0)) throw new RangeError(`hysteresis (${hysteresis}) must be 0 or more`);
    this.touchThreshold = threshold;
    this.hysteresis = hysteresis;
  }

  get finger(): Finger | null {
    return this.current;
  }

  get threshold(): number {
    return this.touchThreshold;
  }

  /** Takes effect from the next frame; a touch in progress carries on. */
  setThreshold(threshold: number): void {
    if (threshold > 0) this.touchThreshold = threshold;
  }

  /**
   * One frame's thumb distances to the index, middle, ring and little fingertips, or null when the
   * hand is not visible. Returns the touches that started or ended, in order.
   */
  update(distances: readonly number[] | null, t: number): FingerTouchEvent[] {
    if (distances === null) return this.reset(t);
    const values = FINGERS.map((_, index) => {
      const value = distances[index];
      return value !== undefined && Number.isFinite(value) ? value : Infinity;
    });
    let closest = 0;
    values.forEach((value, index) => {
      if (value < values[closest]) closest = index;
    });

    const events: FingerTouchEvent[] = [];
    if (this.current !== null) {
      const held = FINGERS.indexOf(this.current);
      if (values[held] > this.touchThreshold + this.hysteresis) {
        events.push(...this.reset(t));
      } else {
        const slid =
          closest !== held &&
          values[closest] < this.touchThreshold &&
          values[closest] <= values[held] - this.hysteresis;
        if (!slid) return events;
        events.push(...this.reset(t));
      }
    }
    if (values[closest] < this.touchThreshold) {
      this.current = FINGERS[closest];
      events.push({ type: "touchStart", finger: this.current, t });
    }
    return events;
  }

  /** Ends a touch in progress. */
  reset(t: number): FingerTouchEvent[] {
    if (this.current === null) return [];
    const finger = this.current;
    this.current = null;
    return [{ type: "touchEnd", finger, t }];
  }
}
