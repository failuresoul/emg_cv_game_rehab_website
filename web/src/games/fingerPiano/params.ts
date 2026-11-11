import type { GameParams, ParamSpec } from "@/games/shared/types";
import { FINGERS, type Finger, touchThresholdFromWarmup } from "@/input/fingerTouch";
import type { ExerciseResult } from "@/warmup/exerciseRunner";

/** A setting the adaptive engine may not change: its range is a single value. */
const fixed = (spec: Omit<ParamSpec, "min" | "max" | "step" | "component">): ParamSpec => ({
  ...spec,
  min: spec.default,
  max: spec.default,
  step: 0,
  component: "fixed",
});

/**
 * Which fingers play. Settings are numbers, so `finger_count` holds them as 2 (index and middle),
 * 3 (index, middle and ring) or 4 (all).
 */
export type FingerSet = "index_middle" | "three" | "all";

export const MIN_TOUCH_THRESHOLD = 0.2;
export const MAX_TOUCH_THRESHOLD = 0.4;
export const MAX_SEQUENCE_LENGTH = 8;

export const FINGER_PIANO_PARAMS: readonly ParamSpec[] = [
  {
    name: "finger_count",
    component: "precision",
    labelKey: "param.fingerCount",
    min: 2,
    max: 4,
    step: 1,
    default: 4,
    unit: "count",
    harder: "higher",
  },
  {
    name: "sequence_length",
    component: "precision",
    labelKey: "param.sequenceLength",
    min: 3,
    max: MAX_SEQUENCE_LENGTH,
    step: 1,
    default: 4,
    unit: "count",
    harder: "higher",
  },
  {
    name: "note_interval_ms",
    component: "speed",
    labelKey: "param.noteIntervalMs",
    min: 1200,
    max: 3000,
    step: 100,
    default: 2000,
    unit: "ms",
    harder: "lower",
  },
  {
    name: "hit_window_ms",
    component: "speed",
    labelKey: "param.hitWindowMs",
    min: 600,
    max: 1500,
    step: 100,
    default: 1200,
    unit: "ms",
    harder: "lower",
  },
  {
    name: "touch_threshold",
    component: "precision",
    labelKey: "param.touchThreshold",
    min: MIN_TOUCH_THRESHOLD,
    max: MAX_TOUCH_THRESHOLD,
    step: 0.02,
    default: 0.3,
    unit: "palm_ratio",
    harder: "lower",
  },
  fixed({
    name: "preview_ms",
    labelKey: "param.previewMs",
    default: 2000,
    unit: "ms",
    harder: null,
  }),
  fixed({ name: "rest_ms", labelKey: "param.restMs", default: 1500, unit: "ms", harder: null }),
];

/** One trial is one short melody. */
export const FINGER_PIANO_TRIALS = 12;

const FINGER_SETS: Record<number, FingerSet> = { 2: "index_middle", 3: "three", 4: "all" };

/** The fingers in play, index first. */
export function activeFingers(count: number): Finger[] {
  return FINGERS.slice(0, Math.min(4, Math.max(2, Math.round(count))));
}

export function fingerSet(count: number): FingerSet {
  return FINGER_SETS[activeFingers(count).length];
}

/** The melody travels in the settings as note_1, note_2 … : each a finger, 0 (index) to 3. */
export const noteParam = (position: number) => `note_${position + 1}`;

export function melodyToParams(notes: readonly Finger[]): GameParams {
  return Object.fromEntries(
    notes.map((finger, index) => [noteParam(index), FINGERS.indexOf(finger)]),
  );
}

export interface FingerPianoParams {
  fingers: Finger[];
  /** The melody, or an empty list when the settings carry none. */
  notes: Finger[];
  noteIntervalMs: number;
  hitWindowMs: number;
  touchThreshold: number;
  previewMs: number;
  restMs: number;
}

const DEFAULTS = Object.fromEntries(
  FINGER_PIANO_PARAMS.map((spec) => [spec.name, spec.default]),
) as Record<string, number>;

/** Reads one trial's settings, falling back to the defaults for anything missing. */
export function readParams(params: GameParams): FingerPianoParams {
  const value = (name: string) =>
    Number.isFinite(params[name]) ? params[name] : (DEFAULTS[name] as number);
  const fingers = activeFingers(value("finger_count"));
  const notes: Finger[] = [];
  for (let position = 0; position < MAX_SEQUENCE_LENGTH; position++) {
    const index = params[noteParam(position)];
    if (!Number.isInteger(index) || !FINGERS[index]) break;
    notes.push(FINGERS[index]);
  }
  return {
    fingers,
    notes,
    noteIntervalMs: value("note_interval_ms"),
    hitWindowMs: value("hit_window_ms"),
    touchThreshold: Math.min(
      MAX_TOUCH_THRESHOLD,
      Math.max(MIN_TOUCH_THRESHOLD, value("touch_threshold")),
    ),
    previewMs: value("preview_ms"),
    restMs: value("rest_ms"),
  };
}

type ThumbWarmupResult = Pick<ExerciseResult, "exerciseId" | "skipped" | "thresholds" | "preset">;

/**
 * Starting settings from the patient's latest thumb opposition warm-up: its touch distance (kept
 * within this game's range), and only the index and middle finger when it used the gentle preset.
 */
export function fingerPianoDefaults(results: readonly ThumbWarmupResult[]): GameParams {
  const defaults: GameParams = {};
  const { threshold, origin } = touchThresholdFromWarmup(results);
  if (origin === "warmup") {
    defaults.touch_threshold = Math.min(
      MAX_TOUCH_THRESHOLD,
      Math.max(MIN_TOUCH_THRESHOLD, threshold),
    );
  }
  const thumb = results.findLast((item) => item.exerciseId === "thumb_opposition");
  if (thumb && !thumb.skipped && thumb.preset === "gentle") defaults.finger_count = 2;
  return defaults;
}
