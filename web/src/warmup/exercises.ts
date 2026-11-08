import type { TranslationKey } from "@/i18n";
import type { Point } from "@/vision/geometry";

import type { ExerciseFeedback } from "./exerciseRunner";
import {
  type PersonalisedTargets,
  personaliseThresholds,
  type WarmupHistoryEntry,
} from "./personalise";
import type { RepDirection } from "./repCounter";

export type ExerciseId =
  | "shoulder_flexion"
  | "shoulder_abduction"
  | "elbow_flexion"
  | "forward_reach"
  | "hand_open_close"
  | "thumb_opposition";
/** The fixed presets each exercise defines. */
export type ExercisePreset = "standard" | "gentle";
/** What a result can use: a fixed preset, or one personalised from the patient's history. */
export type ThresholdPreset = ExercisePreset | "personal";
export type ExerciseMeasure =
  | "armElevationDeg"
  | "elbowFlexionDeg"
  | "forwardReachRatio"
  | "handApertureRatio"
  | "thumbFingerDistances";
/** Degrees; a share of arm length; or a ratio of palm length. Matches the server's units. */
export type MeasureUnit = "deg" | "arm_ratio" | "palm_ratio";

/** For a sequence, low is the touch distance and high the release distance. */
export interface Thresholds {
  low: number;
  high: number;
}

export interface PreferredPlane {
  minDeg: number;
  maxDeg: number;
  feedback: "forward" | "sideways";
}

/** One pose of an arm demo. Positions are in shoulder widths, with the shoulder at the origin. */
export interface DemoKeyframe {
  /** From 0 to 1 through one repetition. */
  time: number;
  shoulder: Point;
  elbow: Point;
  wrist: Point;
}

/**
 * One pose of a hand demo, in palm lengths with the wrist at the origin, +y towards the fingers
 * and +x towards the little finger. Tips are thumb, index, middle, ring and little finger.
 */
export interface HandKeyframe {
  time: number;
  tips: [Point, Point, Point, Point, Point];
}

export type ExerciseDemo =
  { kind: "arm"; keyframes: DemoKeyframe[] } | { kind: "hand"; keyframes: HandKeyframe[] };

/** Words that differ from the arm exercises' defaults. */
export interface ExerciseText {
  feedback?: Partial<Record<ExerciseFeedback, TranslationKey>>;
  /** Shown until the start position is seen. */
  waiting?: TranslationKey;
  trackingLost?: TranslationKey;
  /** The summary's label for the best peak, or null to leave it out. */
  best?: TranslationKey | null;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  nameKey: TranslationKey;
  instructionKeys: [TranslationKey, TranslationKey, TranslationKey];
  tipKey?: TranslationKey;
  measure: ExerciseMeasure;
  /** "rep" counts out and back on one value; "sequence" counts touches in a set order. */
  counter: "rep" | "sequence";
  direction: RepDirection;
  unit: MeasureUnit;
  /** Noise smaller than this cannot start or turn a movement, in the measure's unit. */
  hysteresis?: number;
  /** The gauge's range, in the measure's unit. */
  gauge: { min: number; max: number };
  presets: Record<ExercisePreset, Thresholds>;
  preferredPlane?: PreferredPlane;
  targetReps: number;
  maxDurationSec: number;
  demo: ExerciseDemo;
  text?: ExerciseText;
}

const TARGET_REPS = 10;
const THUMB_TARGET_REPS = 5;
const MAX_DURATION_SEC = 90;
// A touch ends once the thumb is this far past the touch distance, in palm lengths.
const TOUCH_RELEASE_GAP = 0.15;
const UPPER_ARM_SW = 0.9;
const FOREARM_SW = 0.8;
const DEMO_TIMES = [0, 0.25, 0.5, 0.75, 1];
const DEGREE_GAUGE = { min: 0, max: 180 };

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
): ExerciseDemo {
  const shares = [0, 0.5, 1, 0.5, 0];
  return {
    kind: "arm",
    keyframes: DEMO_TIMES.map((time, index) =>
      armPose(
        time,
        rest.elevationDeg + shares[index] * (furthest.elevationDeg - rest.elevationDeg),
        rest.elbowDeg + shares[index] * (furthest.elbowDeg - rest.elbowDeg),
      ),
    ),
  };
}

type HandTips = HandKeyframe["tips"];

/** Where each finger starts, drawn as a fixed palm. Same order and units as HandKeyframe.tips. */
export const HAND_KNUCKLES: HandTips = [
  { x: -0.45, y: 0.35 },
  { x: -0.3, y: 1 },
  { x: -0.1, y: 1.05 },
  { x: 0.1, y: 1 },
  { x: 0.28, y: 0.92 },
];
const OPEN_TIPS: HandTips = [
  { x: -1, y: 0.95 },
  { x: -0.45, y: 1.85 },
  { x: -0.12, y: 1.95 },
  { x: 0.18, y: 1.85 },
  { x: 0.48, y: 1.6 },
];
const FIST_TIPS: HandTips = [
  { x: -0.15, y: 0.65 },
  { x: -0.3, y: 0.72 },
  { x: -0.1, y: 0.7 },
  { x: 0.1, y: 0.7 },
  { x: 0.27, y: 0.72 },
];
/** Where the thumb meets each finger in turn: index, middle, ring, little. */
const TOUCH_POINTS: Point[] = [
  { x: -0.45, y: 1.3 },
  { x: -0.2, y: 1.25 },
  { x: 0.02, y: 1.2 },
  { x: 0.2, y: 1.12 },
];

const blendTips = (from: HandTips, to: HandTips, share: number): HandTips =>
  from.map((tip, index) => ({
    x: tip.x + share * (to[index].x - tip.x),
    y: tip.y + share * (to[index].y - tip.y),
  })) as HandTips;

function openCloseDemo(): ExerciseDemo {
  const shares = [0, 0.5, 1, 0.5, 0];
  return {
    kind: "hand",
    keyframes: DEMO_TIMES.map((time, index) => ({
      time,
      tips: blendTips(FIST_TIPS, OPEN_TIPS, shares[index]),
    })),
  };
}

function oppositionDemo(): ExerciseDemo {
  const touching = (finger: number): HandTips => {
    const tips = [...OPEN_TIPS] as HandTips;
    tips[0] = TOUCH_POINTS[finger];
    tips[finger + 1] = TOUCH_POINTS[finger];
    return tips;
  };
  return {
    kind: "hand",
    keyframes: [
      { time: 0, tips: OPEN_TIPS },
      ...TOUCH_POINTS.map((_, finger) => ({ time: 0.2 * (finger + 1), tips: touching(finger) })),
      { time: 1, tips: OPEN_TIPS },
    ],
  };
}

const HAND_TRACKING_LOST: TranslationKey = "warmup.trackingLostHand";

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
    counter: "rep",
    direction: "up",
    unit: "deg",
    gauge: DEGREE_GAUGE,
    presets: {
      standard: { low: 30, high: 90 },
      gentle: { low: 30, high: 60 },
    },
    preferredPlane: { minDeg: 50, maxDeg: 130, feedback: "forward" },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demo: demoBetween({ elevationDeg: 10, elbowDeg: 175 }, { elevationDeg: 110, elbowDeg: 175 }),
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
    counter: "rep",
    direction: "up",
    unit: "deg",
    gauge: DEGREE_GAUGE,
    presets: {
      standard: { low: 30, high: 80 },
      gentle: { low: 30, high: 50 },
    },
    preferredPlane: { minDeg: -30, maxDeg: 40, feedback: "sideways" },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demo: demoBetween({ elevationDeg: 10, elbowDeg: 175 }, { elevationDeg: 100, elbowDeg: 175 }),
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
    counter: "rep",
    direction: "down",
    unit: "deg",
    gauge: DEGREE_GAUGE,
    presets: {
      standard: { low: 70, high: 140 },
      gentle: { low: 90, high: 125 },
    },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demo: demoBetween({ elevationDeg: 5, elbowDeg: 170 }, { elevationDeg: 5, elbowDeg: 60 }),
  },
  forward_reach: {
    id: "forward_reach",
    nameKey: "exercise.forwardReach.name",
    instructionKeys: [
      "exercise.forwardReach.step1",
      "exercise.forwardReach.step2",
      "exercise.forwardReach.step3",
    ],
    measure: "forwardReachRatio",
    counter: "rep",
    direction: "up",
    unit: "arm_ratio",
    hysteresis: 0.03,
    gauge: { min: 0, max: 1.1 },
    presets: {
      standard: { low: 0.45, high: 0.8 },
      gentle: { low: 0.4, high: 0.65 },
    },
    preferredPlane: { minDeg: 45, maxDeg: 135, feedback: "forward" },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    // A figure facing the viewer cannot show depth, so the arm rises as it straightens.
    demo: demoBetween({ elevationDeg: 20, elbowDeg: 100 }, { elevationDeg: 80, elbowDeg: 175 }),
    text: {
      feedback: {
        higher: "warmup.feedback.reachFurther",
        slow: "warmup.feedback.reachBack",
        forward: "warmup.feedback.reachForward",
      },
      waiting: "warmup.waiting.reachBack",
      best: "warmup.summary.bestReach",
    },
  },
  hand_open_close: {
    id: "hand_open_close",
    nameKey: "exercise.handOpenClose.name",
    instructionKeys: [
      "exercise.handOpenClose.step1",
      "exercise.handOpenClose.step2",
      "exercise.handOpenClose.step3",
    ],
    measure: "handApertureRatio",
    counter: "rep",
    direction: "up",
    unit: "palm_ratio",
    hysteresis: 0.04,
    gauge: { min: 0.8, max: 2 },
    presets: {
      standard: { low: 1.2, high: 1.6 },
      gentle: { low: 1.15, high: 1.45 },
    },
    targetReps: TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demo: openCloseDemo(),
    text: {
      feedback: { higher: "warmup.feedback.openWider", slow: "warmup.feedback.makeFist" },
      waiting: "warmup.waiting.makeFist",
      trackingLost: HAND_TRACKING_LOST,
      best: null,
    },
  },
  thumb_opposition: {
    id: "thumb_opposition",
    nameKey: "exercise.thumbOpposition.name",
    instructionKeys: [
      "exercise.thumbOpposition.step1",
      "exercise.thumbOpposition.step2",
      "exercise.thumbOpposition.step3",
    ],
    measure: "thumbFingerDistances",
    counter: "sequence",
    // The distance falls to a touch, and the best touch is the smallest.
    direction: "down",
    unit: "palm_ratio",
    gauge: { min: 0, max: 1.5 },
    presets: {
      standard: { low: 0.25, high: 0.25 + TOUCH_RELEASE_GAP },
      gentle: { low: 0.35, high: 0.35 + TOUCH_RELEASE_GAP },
    },
    targetReps: THUMB_TARGET_REPS,
    maxDurationSec: MAX_DURATION_SEC,
    demo: oppositionDemo(),
    text: {
      waiting: "warmup.waiting.spreadFingers",
      trackingLost: HAND_TRACKING_LOST,
      best: null,
    },
  },
};

/** The first exercises of the warm-up, in order. */
export const EXERCISE_ORDER: ExerciseId[] = [
  "shoulder_flexion",
  "shoulder_abduction",
  "elbow_flexion",
];

/** Every exercise, for tools such as the Exercise Lab. */
export const ALL_EXERCISE_IDS = Object.keys(EXERCISES) as ExerciseId[];

export interface ExerciseTargets {
  thresholds: Thresholds;
  /** The preset actually used: "personal" falls back to "standard" with no history. */
  preset: ThresholdPreset;
  /** Why the thresholds are what they are; null for a fixed preset chosen directly. */
  personalisation: PersonalisedTargets | null;
}

/** The thresholds to use today, and how they were chosen. */
export function getTargets(
  exercise: ExerciseDefinition,
  preset: ThresholdPreset,
  history: readonly WarmupHistoryEntry[] = [],
): ExerciseTargets {
  if (preset !== "personal") {
    return { thresholds: exercise.presets[preset], preset, personalisation: null };
  }
  const personalised = personaliseThresholds(exercise, history);
  return {
    thresholds: { low: personalised.low, high: personalised.high },
    preset: personalised.preset,
    personalisation: personalised,
  };
}

export function getThresholds(
  exercise: ExerciseDefinition,
  preset: ThresholdPreset,
  history?: readonly WarmupHistoryEntry[],
): Thresholds {
  return getTargets(exercise, preset, history).thresholds;
}
