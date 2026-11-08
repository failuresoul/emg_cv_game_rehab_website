import type { ExerciseId } from "./exercises";

/** trunk: the shoulders move as a whole; lean: the trunk tilts; shoulder: the shoulder hikes. */
export type CompensationType = "trunk" | "lean" | "shoulder";

export interface CompensationConfig {
  /** How long the person must sit still at the start, to measure their usual posture. */
  baselineMs: number;
  /** A threshold must stay exceeded this long to count, so a single bad frame does not. */
  sustainMs: number;
  /** The shortest time between two spoken or written cues. */
  cueIntervalMs: number;
  thresholds: {
    /** Shoulder-midpoint movement from the baseline, in shoulder widths. */
    trunkDisplacement: number;
    /** Change in trunk tilt from the baseline, in degrees. */
    trunkLeanDeg: number;
    /** Rise of the affected shoulder relative to the other, in shoulder widths. */
    shoulderHike: number;
  };
  /** Which kinds each exercise checks. Hand exercises let the shoulders move freely. */
  checks: Record<ExerciseId, readonly CompensationType[]>;
}

const ALL: readonly CompensationType[] = ["trunk", "lean", "shoulder"];
const TRUNK_ONLY: readonly CompensationType[] = ["trunk"];

export const COMPENSATION_CONFIG: CompensationConfig = {
  baselineMs: 2000,
  sustainMs: 300,
  cueIntervalMs: 5000,
  thresholds: {
    trunkDisplacement: 0.15,
    trunkLeanDeg: 10,
    shoulderHike: 0.08,
  },
  checks: {
    shoulder_flexion: ALL,
    shoulder_abduction: ALL,
    elbow_flexion: ALL,
    forward_reach: ALL,
    hand_open_close: TRUNK_ONLY,
    thumb_opposition: TRUNK_ONLY,
  },
};
