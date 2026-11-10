import { type ApertureRefs, CvApertureSource, DEFAULT_APERTURE_REFS } from "./cvApertureSource";
import { clamp01 } from "./types";

/** Hold O to open the hand in keyboard mode. */
export const OPENNESS_KEY_CODE = "KeyO";

/**
 * 0 for a hand closed to closedRef or tighter, 1 for a hand open to openRef or wider:
 * clamp((aperture - closedRef) / (openRef - closedRef), 0, 1).
 */
export function apertureToOpenness(
  aperture: number,
  refs: ApertureRefs = DEFAULT_APERTURE_REFS,
): number {
  const range = refs.openRef - refs.closedRef;
  if (!(range > 0)) return 0;
  return clamp01((aperture - refs.closedRef) / range);
}

/**
 * How open the affected hand is, from the camera, using the patient's personal references from
 * the hand open-close warm-up. Not ready while the affected hand is out of view.
 */
export class CvOpennessSource extends CvApertureSource<"cv_openness"> {
  readonly id = "cv_openness";
  readonly labelKey = "input.source.cvOpenness";

  protected toLevel(aperture: number, refs: ApertureRefs): number {
    return apertureToOpenness(aperture, refs);
  }
}
