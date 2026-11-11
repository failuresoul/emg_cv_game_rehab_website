import type { TranslationKey } from "@/i18n";
import type { Point } from "@/vision/geometry";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import { thumbThresholdFromWarmup, type TouchThresholdChoice } from "./fingerTouch";
import { clamp01 } from "./types";

/** Thumb-to-index distance, in palm lengths, that counts as a pinch without a warm-up value. */
export const DEFAULT_PINCH_THRESHOLD = 0.25;
/** A pinch ends only once the thumb is this much farther than the threshold, in palm lengths. */
export const PINCH_HYSTERESIS = 0.1;
/** Pinch strength falls to 0 this far, in palm lengths, beyond the threshold. */
export const PINCH_STRENGTH_SPAN = 0.3;

export type PinchSourceId = "cv_pinch" | "keyboard";

export interface PinchEvent {
  type: "pinchStart" | "pinchEnd";
  /** When it happened, in ms on the source's clock (performance.now() for live input). */
  t: number;
  /** The pinch point at that moment, RAW, in SW body coordinates; null if it was not known. */
  pointRawSw: Point | null;
}

export type PinchListener = (event: PinchEvent) => void;

/** One moment of the pinch. */
export interface PinchState {
  /** False while the source cannot measure, for example when the hand is out of view. */
  ready: boolean;
  pinching: boolean;
  /** 0 thumb and index far apart, 1 tips together. */
  strength: number;
  /** Midway between the thumb tip and the index fingertip, RAW, in SW. Use this for saved data. */
  pointRawSw: Point | null;
  /** The same point smoothed, for drawing only. */
  pointSmoothSw: Point | null;
  t: number;
}

export type PinchStateListener = (state: PinchState) => void;

export const IDLE_PINCH: Readonly<PinchState> = {
  ready: false,
  pinching: false,
  strength: 0,
  pointRawSw: null,
  pointSmoothSw: null,
  t: 0,
};

/** Whether the thumb and index finger of the affected hand are pinched together, and where. */
export interface PinchSource {
  readonly id: PinchSourceId;
  readonly labelKey: TranslationKey;
  isReady(): boolean;
  /** The latest state. Stable until the next update. */
  getState(): PinchState;
  start(): void;
  /** Ends a pinch in progress, telling listeners. */
  stop(): void;
  /** Each pinchStart and pinchEnd. Returns a function that unsubscribes. */
  subscribe(listener: PinchListener): () => void;
  /** Every new state, about once per camera frame. Returns a function that unsubscribes. */
  subscribeState(listener: PinchStateListener): () => void;
  /** Changes the pinch distance, for sources that measure one. A pinch in progress carries on. */
  setThreshold?(threshold: number): void;
}

/** clamp(1 − distance / (threshold + 0.3), 0, 1). */
export function pinchStrength(distance: number, threshold = DEFAULT_PINCH_THRESHOLD): number {
  if (!Number.isFinite(distance)) return 0;
  return clamp01(1 - distance / (threshold + PINCH_STRENGTH_SPAN));
}

/** Midway between two points. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type ThumbWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "thresholds">;

/**
 * The patient's pinch distance from the latest thumb opposition warm-up (the distance its touches
 * were counted at), or 0.25 without one.
 */
export function pinchThresholdFromWarmup(
  results: readonly ThumbWarmupResult[],
): TouchThresholdChoice {
  return thumbThresholdFromWarmup(results, DEFAULT_PINCH_THRESHOLD);
}

export interface PinchDetectorOptions {
  threshold?: number;
  hysteresis?: number;
}

/**
 * Turns thumb-to-index distances into pinches. A pinch starts below the threshold and ends only
 * above threshold + hysteresis, so jitter around the threshold never makes a second pinch. Pure:
 * give it each frame's distance and time.
 */
export class PinchDetector {
  private pinchThreshold: number;
  private readonly hysteresis: number;
  private held = false;

  constructor({
    threshold = DEFAULT_PINCH_THRESHOLD,
    hysteresis = PINCH_HYSTERESIS,
  }: PinchDetectorOptions = {}) {
    if (!(threshold > 0)) throw new RangeError(`threshold (${threshold}) must be above 0`);
    if (!(hysteresis >= 0)) throw new RangeError(`hysteresis (${hysteresis}) must be 0 or more`);
    this.pinchThreshold = threshold;
    this.hysteresis = hysteresis;
  }

  get pinching(): boolean {
    return this.held;
  }

  get threshold(): number {
    return this.pinchThreshold;
  }

  /** Takes effect from the next frame; a pinch in progress carries on. */
  setThreshold(threshold: number): void {
    if (threshold > 0) this.pinchThreshold = threshold;
  }

  /** This frame's strength for a distance, with the current threshold. */
  strength(distance: number | null): number {
    return distance === null ? 0 : pinchStrength(distance, this.pinchThreshold);
  }

  /**
   * One frame's thumb-to-index distance in palm lengths, or null when the hand is not visible
   * (which ends a pinch). Returns "start", "end" or null.
   */
  update(distance: number | null): "start" | "end" | null {
    if (distance === null || !Number.isFinite(distance)) return this.reset();
    if (this.held) {
      if (distance <= this.pinchThreshold + this.hysteresis) return null;
      this.held = false;
      return "end";
    }
    if (distance >= this.pinchThreshold) return null;
    this.held = true;
    return "start";
  }

  /** Ends a pinch in progress. */
  reset(): "end" | null {
    if (!this.held) return null;
    this.held = false;
    return "end";
  }
}
