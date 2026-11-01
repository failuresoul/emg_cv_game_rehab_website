import type { TranslationKey } from "@/i18n";
import type { Point } from "@/vision/geometry";

import type { ExerciseResult } from "./exerciseRunner";
import type { RepDirection } from "./repCounter";

export type ExerciseId = "shoulder_flexion" | "shoulder_abduction" | "elbow_flexion";
export type ExercisePreset = "standard" | "gentle";
export type ExerciseMeasure = "armElevationDeg" | "elbowFlexionDeg";

export interface Thresholds {
  low: number;
  high: number;
}

export interface PreferredPlane {
  minDeg: number;
  maxDeg: number;
  feedback: "forward" | "sideways";
}

/** One pose of the demo. Positions are in shoulder widths, with the shoulder at the origin. */
export interface DemoKeyframe {
  /** From 0 to 1 through one repetition. */
  time: number;
  shoulder: Point;
  elbow: Point;
  wrist: Point;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  nameKey: TranslationKey;
  instructionKeys: [TranslationKey, TranslationKey, TranslationKey];
  tipKey?: TranslationKey;
  measure: ExerciseMeasure;
  direction: RepDirection;
  presets: Record<ExercisePreset, Thresholds>;
  preferredPlane?: PreferredPlane;
  targetReps: number;
  maxDurationSec: number;
  demoKeyframes: DemoKeyframe[];
}

const TARGET_REPS = 10;
const MAX_DURATION_SEC = 90;
const UPPER_ARM_SW = 0.9;
const FOREARM_SW = 0.8;
const DEMO_TIMES = [0, 0.25, 0.5, 0.75, 1];

/** A pose from the two angles the app measures. Bending moves the forearm forward and up. */
function armPose(time: number, elevationDeg: number, elbowDeg: number): DemoKeyframe {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const upperArm = toRadians(elevationDeg);
  const forearm = upperArm + toRadians(180 - elbowDeg);
  const elbow = { x: UPPER_ARM_SW * Math.sin(upperArm), y: -UPPER_ARM_SW * Math.cos(upperArm) };
  return {
    time,
    shoulder: { x: 0, y: 0 },
    elbow,
    wrist: {
      x: elbow.x + FOREARM_SW * Math.sin(forearm),
      y: elbow.y - FOREARM_SW * Math.cos(forearm),
    },
  };
}

/** Out and back: rest, halfway, furthest, halfway, rest. */
function demoBetween(
  rest: { elevationDeg: number; elbowDeg: number },
  furthest: { elevationDeg: number; elbowDeg: number },
): DemoKeyframe[] {
  const shares = [0, 0.5, 1, 0.5, 0];
  return DEMO_TIMES.map((time, index) =>
    armPose(
      time,
      rest.elevationDeg + shares[index] * (furthest.elevationDeg - rest.elevationDeg),
      rest.elbowDeg + shares[index] * (furthest.elbowDeg - rest.elbowDeg),
    ),
  );
}

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  shoulder_flexion: {
    id: "shoulder_flexion",
    nameKey: "exercise.shoulderFlexion.name",
    instructionKeys: [
      "exercise.shoulderFlexion.step1",
      "exercise.shoulderFlexion.step2",
      "exercise.shoulderFlexion.step3",
    ],
    measure: "armElevationDeg",
    direction: "up",
    presets: {
      standard: { low: 30, high: 90 },
      gentle: { low: 30, high: 60 },
    },
    preferredPlane: { minDeg: 50, maxDeg: 130, feedback: "forward" },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demoKeyframes: demoBetween(
      { elevationDeg: 10, elbowDeg: 175 },
      { elevationDeg: 110, elbowDeg: 175 },
    ),
  },
  shoulder_abduction: {
    id: "shoulder_abduction",
    nameKey: "exercise.shoulderAbduction.name",
    instructionKeys: [
      "exercise.shoulderAbduction.step1",
      "exercise.shoulderAbduction.step2",
      "exercise.shoulderAbduction.step3",
    ],
    measure: "armElevationDeg",
    direction: "up",
    presets: {
      standard: { low: 30, high: 80 },
      gentle: { low: 30, high: 50 },
    },
    preferredPlane: { minDeg: -30, maxDeg: 40, feedback: "sideways" },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demoKeyframes: demoBetween(
      { elevationDeg: 10, elbowDeg: 175 },
      { elevationDeg: 100, elbowDeg: 175 },
    ),
  },
  elbow_flexion: {
    id: "elbow_flexion",
    nameKey: "exercise.elbowFlexion.name",
    instructionKeys: [
      "exercise.elbowFlexion.step1",
      "exercise.elbowFlexion.step2",
      "exercise.elbowFlexion.step3",
    ],
    tipKey: "exercise.elbowFlexion.tip",
    measure: "elbowFlexionDeg",
    direction: "down",
    presets: {
      standard: { low: 70, high: 140 },
      gentle: { low: 90, high: 125 },
    },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demoKeyframes: demoBetween(
      { elevationDeg: 5, elbowDeg: 170 },
      { elevationDeg: 5, elbowDeg: 60 },
    ),
  },
};

/** The first exercises of the warm-up, in order. */
export const EXERCISE_ORDER: ExerciseId[] = [
  "shoulder_flexion",
  "shoulder_abduction",
  "elbow_flexion",
];

export function getThresholds(
  exercise: ExerciseDefinition,
  preset: ExercisePreset,
  history?: readonly ExerciseResult[],
): Thresholds {
  // TODO(Day 4): personalise these from the patient's earlier results in `history`.
  void history;
  return exercise.presets[preset];
}
