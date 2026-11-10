import {
  APERTURE_SMOOTHING_ALPHA,
  type ApertureRefs,
  type ApertureRefsChoice,
  type ApertureRefsOrigin,
  apertureRefsFromWarmup,
  CvApertureSource,
  DEFAULT_APERTURE_REFS,
  MIN_APERTURE_REF_GAP,
} from "./cvApertureSource";
import { clamp01 } from "./types";

export type { CvApertureSourceOptions as CvGripSourceOptions } from "./cvApertureSource";
export type { VisionFrameSource } from "./cvApertureSource";

/** Hand aperture, in palm lengths, of an open hand (level 0) and a fist (level 1). */
export type GripRefs = ApertureRefs;
export type GripRefsOrigin = ApertureRefsOrigin;
export type GripRefsChoice = ApertureRefsChoice;

export const DEFAULT_GRIP_REFS = DEFAULT_APERTURE_REFS;
export const MIN_GRIP_REF_GAP = MIN_APERTURE_REF_GAP;
export const GRIP_SMOOTHING_ALPHA = APERTURE_SMOOTHING_ALPHA;
/** The same personal references serve both grip and openness. */
export const gripRefsFromWarmup = apertureRefsFromWarmup;

/** 0 for a hand open to openRef or wider, 1 for a hand closed to closedRef or tighter. */
export function apertureToLevel(aperture: number, refs: GripRefs = DEFAULT_GRIP_REFS): number {
  const range = refs.openRef - refs.closedRef;
  if (!(range > 0)) return 0;
  return clamp01((refs.openRef - aperture) / range);
}

/** Activation from closing the affected hand in front of the camera. */
export class CvGripSource extends CvApertureSource<"cv_grip"> {
  readonly id = "cv_grip";
  readonly labelKey = "input.source.cvGrip";

  protected toLevel(aperture: number, refs: GripRefs): number {
    return apertureToLevel(aperture, refs);
  }
}
