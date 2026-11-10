import type { TranslationKey } from "@/i18n";
import type { Side } from "@/types/api";
import { computeHandMeasures, type HandMeasures, selectAffectedHand } from "@/vision/hand";
import type { VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import { LevelListeners, type LevelSource } from "./types";

/** Hand aperture, in palm lengths, of an open hand and of a fist. */
export interface ApertureRefs {
  openRef: number;
  closedRef: number;
}

export const DEFAULT_APERTURE_REFS: Readonly<ApertureRefs> = { openRef: 1.6, closedRef: 1.1 };

/** Below this gap the level would jump between 0 and 1 on tracking noise alone. */
export const MIN_APERTURE_REF_GAP = 0.15;
/**
 * An open hand measures about 1.8 palm lengths. A warm-up peak far above that is a tracking
 * glitch, and taking it as the open reference would make full openness impossible to reach.
 */
export const MAX_OPEN_REF = 2.2;

/** Weight of the newest frame: light smoothing that still follows a quick movement. */
export const APERTURE_SMOOTHING_ALPHA = 0.5;

export type ApertureRefsOrigin = "warmup" | "default";

export interface ApertureRefsChoice extends ApertureRefs {
  origin: ApertureRefsOrigin;
}

type HandWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

/**
 * Personal references from the latest hand open-close warm-up. Open is the widest the hand opened
 * (the best peak). Closed is the exercise's low threshold: the reps record how wide each opening
 * was but not how tightly the hand then closed, and every counted rep closed below it. Falls back
 * to the defaults without a usable result.
 */
export function apertureRefsFromWarmup(results: readonly HandWarmupResult[]): ApertureRefsChoice {
  const result = results.findLast((item) => item.exerciseId === "hand_open_close");
  const open = result?.bestPeak;
  if (!result || result.skipped || open === null || open === undefined || !Number.isFinite(open)) {
    return { ...DEFAULT_APERTURE_REFS, origin: "default" };
  }
  const openRef = Math.min(open, MAX_OPEN_REF);
  const low = result.thresholds.low;
  // A hand that barely opened still needs a usable range, so the closed reference gives way.
  const closedRef = Number.isFinite(low)
    ? Math.min(low, openRef - MIN_APERTURE_REF_GAP)
    : openRef - 0.5;
  return { openRef, closedRef, origin: "warmup" };
}

/** Anything that delivers vision frames, such as visionEngine. */
export interface VisionFrameSource {
  subscribe(listener: (result: VisionResult) => void): () => void;
}

/**
 * Each frame's measures, by affected side. The engine sends the same result object to every
 * listener, so grip, openness and touch share one calculation per frame; old frames are freed
 * with their result.
 */
const measuresByFrame = new WeakMap<VisionResult, Map<Side, HandMeasures | null>>();

/** The affected hand's measures in one frame, or null when that hand is not visible. */
export function affectedHandMeasures(result: VisionResult, side: Side): HandMeasures | null {
  let bySide = measuresByFrame.get(result);
  if (!bySide) {
    bySide = new Map();
    measuresByFrame.set(result, bySide);
  }
  if (!bySide.has(side)) {
    const hand = selectAffectedHand(result, side);
    bySide.set(side, computeHandMeasures(hand, result.frameWidth, result.frameHeight));
  }
  return bySide.get(side) ?? null;
}

export interface CvApertureSourceOptions {
  affectedSide: Side;
  engine: VisionFrameSource;
  refs?: ApertureRefs;
}

/**
 * A level worked out from how open the affected hand is in front of the camera, smoothed with an
 * exponential moving average. It only listens to the vision engine, so something else on the page
 * must start the camera. Subclasses choose how an aperture becomes a level.
 */
export abstract class CvApertureSource<Id extends string> implements LevelSource<Id> {
  abstract readonly id: Id;
  abstract readonly labelKey: TranslationKey;
  private readonly affectedSide: Side;
  private readonly engine: VisionFrameSource;
  private readonly listeners = new LevelListeners();
  private refs: ApertureRefs;
  private level = 0;
  private ready = false;
  private unsubscribe: (() => void) | null = null;

  constructor({ affectedSide, engine, refs = DEFAULT_APERTURE_REFS }: CvApertureSourceOptions) {
    this.affectedSide = affectedSide;
    this.engine = engine;
    this.refs = { ...refs };
  }

  /** The level for one frame's aperture, from 0 to 1. */
  protected abstract toLevel(aperture: number, refs: ApertureRefs): number;

  get currentRefs(): ApertureRefs {
    return { ...this.refs };
  }

  setRefs(refs: ApertureRefs): void {
    this.refs = { ...refs };
  }

  isReady(): boolean {
    return this.ready;
  }

  getLevel(): number {
    return this.level;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.subscribe((result) => this.processFrame(result));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pushAperture(null);
  }

  subscribe(listener: (level: number) => void): () => void {
    return this.listeners.add(listener);
  }

  processFrame(result: VisionResult): void {
    this.pushAperture(affectedHandMeasures(result, this.affectedSide)?.handApertureRatio ?? null);
  }

  /** One frame's aperture of the affected hand, or null when the hand is not visible. */
  pushAperture(aperture: number | null): void {
    if (aperture === null || !Number.isFinite(aperture)) {
      // Starts afresh when the hand comes back, rather than easing in from an old level.
      this.ready = false;
      this.level = 0;
    } else {
      const target = this.toLevel(aperture, this.refs);
      this.level = this.ready
        ? APERTURE_SMOOTHING_ALPHA * target + (1 - APERTURE_SMOOTHING_ALPHA) * this.level
        : target;
      this.ready = true;
    }
    this.listeners.emit(this.level);
  }
}
