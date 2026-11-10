import type { ExerciseResult } from "@/warmup/exerciseRunner";

/** The elbow's inside angle, in degrees: about 180 straight, smaller when bent. */
export interface ElbowRange {
  /** The most bent the patient reached: the top of the wall. */
  bentDeg: number;
  /** The most straight: the bottom of the wall. */
  straightDeg: number;
}

export const DEFAULT_ELBOW_RANGE: Readonly<ElbowRange> = { bentDeg: 70, straightDeg: 150 };
/** A range narrower than this would turn tracking noise into big brush moves. */
export const MIN_ELBOW_RANGE_DEG = 30;
/** Angles outside these are tracking errors rather than an elbow. */
const MIN_ANGLE_DEG = 20;
const MAX_ANGLE_DEG = 180;

export type ElbowRangeOrigin = "warmup" | "default";

type ElbowWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "bestPeak" | "thresholds">;

/**
 * The patient's own elbow range from the latest elbow flexion warm-up. Most bent is the best peak
 * (the smallest angle reached). Most straight is the exercise's high threshold: the reps record how
 * far each bend went but not how straight the arm then was, and every counted rep started above
 * it. The range is at least 30°, widened towards straight if need be; defaults (70° and 150°)
 * without a usable result.
 */
export function elbowRangeFromWarmup(
  results: readonly ElbowWarmupResult[],
): ElbowRange & { origin: ElbowRangeOrigin } {
  const result = results.findLast((item) => item.exerciseId === "elbow_flexion");
  const bent = result?.bestPeak;
  const straight = result?.thresholds.high;
  if (
    !result ||
    result.skipped ||
    bent === null ||
    bent === undefined ||
    straight === undefined ||
    !Number.isFinite(bent) ||
    !Number.isFinite(straight)
  ) {
    return { ...DEFAULT_ELBOW_RANGE, origin: "default" };
  }
  const bentDeg = Math.min(MAX_ANGLE_DEG - MIN_ELBOW_RANGE_DEG, Math.max(MIN_ANGLE_DEG, bent));
  const straightDeg = Math.min(MAX_ANGLE_DEG, Math.max(bentDeg + MIN_ELBOW_RANGE_DEG, straight));
  return { bentDeg, straightDeg, origin: "warmup" };
}

/**
 * The brush's height on the wall, from 0 (arm straight: the bottom) to 1 (bent as far as the
 * patient can: the top), kept within 0 and 1.
 */
export function brushHeight(angleDeg: number, range: ElbowRange): number {
  const span = range.straightDeg - range.bentDeg;
  if (!(span > 0) || !Number.isFinite(angleDeg)) return 0;
  return Math.min(1, Math.max(0, (range.straightDeg - angleDeg) / span));
}

/** The elbow angle that puts the brush at `height` (0 to 1) on the wall. */
export function angleAtHeight(height: number, range: ElbowRange): number {
  return range.straightDeg - Math.min(1, Math.max(0, height)) * (range.straightDeg - range.bentDeg);
}
