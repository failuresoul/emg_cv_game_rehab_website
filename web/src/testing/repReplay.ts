/**
 * Rep accuracy (Day 19): plays a guided landmark recording's steps through the warm-up's own
 * measurer and counters (MotionMeasurer, frameForExercise, createCounter with the standard
 * preset), and compares each step's counted repetitions with how many the guide asked for.
 * Used by scripts/export-rep-counts.mjs, which analysis/validation/rep_accuracy.py runs.
 */

import type { Side } from "@/types/api";
import { MotionMeasurer } from "@/vision/measures";
import { createCounter, frameHasMeasure } from "@/warmup/counter";
import { EXERCISES, type ExerciseId, isInPlane } from "@/warmup/exercises";
import { frameForExercise } from "@/warmup/frames";

import { decodeFrame, type LandmarkRecording } from "./landmarkFormat";
import type { FeedFrame } from "./synthLandmarks";

/** Which warm-up exercise each guided step is, and how many repetitions the guide asked for. */
export const STEP_EXERCISES: { marker: string; exercise: ExerciseId; scripted: number }[] = [
  { marker: "raise_forward", exercise: "shoulder_flexion", scripted: 3 },
  { marker: "raise_sideways", exercise: "shoulder_abduction", scripted: 3 },
  { marker: "elbow", exercise: "elbow_flexion", scripted: 10 },
  { marker: "hand_open_close", exercise: "hand_open_close", scripted: 10 },
  // Two rounds of index, middle, ring and little: one repetition each.
  { marker: "thumb_touch", exercise: "thumb_opposition", scripted: 2 },
];

export interface RepCountRow {
  marker: string;
  exercise: ExerciseId;
  scripted: number;
  counted: number;
  partial: number;
  frames: number;
  framesWithMeasure: number;
  /** The counted measure's range over the step (the smallest distance for a sequence). */
  minValue: number | null;
  maxValue: number | null;
  /** The standard preset's thresholds. */
  low: number;
  high: number;
}

/** Counts one exercise's full and partial repetitions over frames, as the warm-up does. */
export function countReps(
  frames: readonly FeedFrame[],
  exercise: ExerciseId,
  side: Side,
  frameWidth = 640,
  frameHeight = 480,
): {
  counted: number;
  partial: number;
  framesWithMeasure: number;
  minValue: number | null;
  maxValue: number | null;
  low: number;
  high: number;
} {
  const definition = EXERCISES[exercise];
  const measurer = new MotionMeasurer(side);
  const counter = createCounter(definition, definition.presets.standard);
  let framesWithMeasure = 0;
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const frame of frames) {
    const state = measurer.process({
      timestamp: frame.t,
      hands: frame.hands,
      pose: frame.pose,
      poseWorld: frame.poseWorld,
      frameWidth,
      frameHeight,
    });
    const counted = frameForExercise(definition, state);
    if (!frameHasMeasure(counted)) continue;
    framesWithMeasure++;
    const value = counted.values ? Math.min(...counted.values) : (counted.value as number);
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
    // As the warm-up does: a raise in the wrong direction does not count.
    counter.feed({ ...counted, inPlane: isInPlane(definition, counted.planeDeg) });
  }
  const partial = "partialReps" in counter ? Number(counter.partialReps) : 0;
  const { low, high } = definition.presets.standard;
  const range = framesWithMeasure > 0;
  return {
    counted: counter.fullReps,
    partial,
    framesWithMeasure,
    minValue: range ? minValue : null,
    maxValue: range ? maxValue : null,
    low,
    high,
  };
}

/** Every guided step of a recording that has a marker, counted. */
export function repAccuracy(recording: LandmarkRecording, side: Side): RepCountRow[] {
  const rows: RepCountRow[] = [];
  for (const step of STEP_EXERCISES) {
    const marker = recording.markers?.find((item) => item.id === step.marker);
    if (!marker) continue;
    const frames = recording.frames
      .filter((frame) => frame.t >= marker.start && frame.t <= marker.end)
      .map(decodeFrame);
    const result = countReps(
      frames,
      step.exercise,
      side,
      recording.frameWidth,
      recording.frameHeight,
    );
    rows.push({ ...step, ...result, frames: frames.length });
  }
  return rows;
}
