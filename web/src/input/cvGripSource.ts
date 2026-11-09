import type { Side } from "@/types/api";
import { computeHandMeasures, selectAffectedHand } from "@/vision/hand";
import type { VisionResult } from "@/vision/visionEngine";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

import { type ActivationSource, clamp01, LevelListeners } from "./types";

/** Hand aperture, in palm lengths, of an open hand (level 0) and a fist (level 1). */
export interface GripRefs {
  openRef: number;
  closedRef: number;
}

export const DEFAULT_GRIP_REFS: Readonly<GripRefs> = { openRef: 1.6, closedRef: 1.1 };

/** Below this gap the level would jump between 0 and 1 on tracking noise alone. */
export const MIN_GRIP_REF_GAP = 0.15;

/** Weight of the newest frame: light smoothing that still follows a quick squeeze. */
export const GRIP_SMOOTHING_ALPHA = 0.5;

/** 0 for a hand open to openRef or wider, 1 for a hand closed to closedRef or tighter. */
export function apertureToLevel(aperture: number, refs: GripRefs = DEFAULT_GRIP_REFS): number {
  const range = refs.openRef - refs.closedRef;
  if (!(range > 0)) return 0;
  return clamp01((refs.openRef - aperture) / range);
}

export type GripRefsOrigin = "warmup" | "default";

export interface GripRefsChoice extends GripRefs {
  origin: GripRefsOrigin;
}

type HandWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

/**
 * Personal references from this session's hand open-close warm-up. Open is the widest the hand
 * opened (the best peak). Closed is the exercise's low threshold: the reps record how wide each
 * opening was but not how tightly the hand then closed, and every counted rep closed below it.
 * Falls back to the defaults without a usable result.
 */
export function gripRefsFromWarmup(results: readonly HandWarmupResult[]): GripRefsChoice {
  const result = results.findLast((item) => item.exerciseId === "hand_open_close");
  const open = result?.bestPeak;
  if (!result || result.skipped || open === null || open === undefined || !Number.isFinite(open)) {
    return { ...DEFAULT_GRIP_REFS, origin: "default" };
  }
  const low = result.thresholds.low;
  // A hand that barely opened still needs a usable range, so the closed reference gives way.
  const closedRef = Number.isFinite(low) ? Math.min(low, open - MIN_GRIP_REF_GAP) : open - 0.5;
  return { openRef: open, closedRef, origin: "warmup" };
}

/** Anything that delivers vision frames, such as visionEngine. */
export interface VisionFrameSource {
  subscribe(listener: (result: VisionResult) => void): () => void;
}

export interface CvGripSourceOptions {
  affectedSide: Side;
  engine: VisionFrameSource;
  refs?: GripRefs;
}

/**
 * Activation from closing the affected hand in front of the camera. It only listens to the vision
 * engine, so something else on the page must start the camera.
 */
export class CvGripSource implements ActivationSource {
  readonly id = "cv_grip";
  readonly labelKey = "input.source.cvGrip";
  private readonly affectedSide: Side;
  private readonly engine: VisionFrameSource;
  private readonly listeners = new LevelListeners();
  private refs: GripRefs;
  private level = 0;
  private ready = false;
  private unsubscribe: (() => void) | null = null;

  constructor({ affectedSide, engine, refs = DEFAULT_GRIP_REFS }: CvGripSourceOptions) {
    this.affectedSide = affectedSide;
    this.engine = engine;
    this.refs = { ...refs };
  }

  get currentRefs(): GripRefs {
    return { ...this.refs };
  }

  setRefs(refs: GripRefs): void {
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
    const hand = selectAffectedHand(result, this.affectedSide);
    const measures = computeHandMeasures(hand, result.frameWidth, result.frameHeight);
    this.pushAperture(measures?.handApertureRatio ?? null);
  }

  /** One frame's aperture of the affected hand, or null when the hand is not visible. */
  pushAperture(aperture: number | null): void {
    if (aperture === null || !Number.isFinite(aperture)) {
      // Starts afresh when the hand comes back, rather than easing in from an old squeeze.
      this.ready = false;
      this.level = 0;
    } else {
      const target = apertureToLevel(aperture, this.refs);
      this.level = this.ready
        ? GRIP_SMOOTHING_ALPHA * target + (1 - GRIP_SMOOTHING_ALPHA) * this.level
        : target;
      this.ready = true;
    }
    this.listeners.emit(this.level);
  }
}
