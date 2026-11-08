import type { JointAngleState } from "@/vision/measures";

import type { ExerciseFrame } from "./exerciseRunner";
import type { ExerciseDefinition } from "./exercises";

/** The values an exercise counts, picked from one frame of measures. */
export function frameForExercise(
  exercise: ExerciseDefinition,
  state: JointAngleState,
): ExerciseFrame {
  const { timestamp, raw, filtered, hand } = state;
  const planeDeg = filtered.elevationPlaneDeg;

  switch (exercise.measure) {
    case "armElevationDeg":
    case "elbowFlexionDeg":
    case "forwardReachRatio": {
      const measure = raw[exercise.measure];
      return {
        timestamp,
        value: filtered[exercise.measure],
        rawValue: measure?.value,
        planeDeg,
        source: measure?.source,
        trunkReference: measure?.trunkReference,
      };
    }
    case "handApertureRatio":
      return {
        timestamp,
        value: hand.filtered.handApertureRatio,
        rawValue: hand.raw?.handApertureRatio,
        source: hand.raw?.source,
        trunkReference: null,
      };
    case "thumbFingerDistances":
      return {
        timestamp,
        value: null,
        values: hand.filtered.thumbFingerDistances,
        rawValues: hand.raw?.thumbFingerDistances,
        source: hand.raw?.source,
        trunkReference: null,
      };
  }
}

/** The single value to show on a gauge, or null for a sequence. */
export function displayValue(exercise: ExerciseDefinition, state: JointAngleState): number | null {
  return exercise.counter === "sequence" ? null : frameForExercise(exercise, state).value;
}
