import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";

import type { ExerciseFeedback } from "./exerciseRunner";
import type { ExerciseDefinition, MeasureUnit } from "./exercises";
import type { RepDirection } from "./repCounter";

/** The words for a feedback event. Going too slowly means the arm must first return to rest. */
export function feedbackKey(feedback: ExerciseFeedback, direction: RepDirection): TranslationKey {
  switch (feedback) {
    case "good":
      return "warmup.feedback.good";
    case "higher":
      return "warmup.feedback.higher";
    case "lower":
      return "warmup.feedback.lower";
    case "almost":
      return "warmup.feedback.almost";
    case "slow":
      return direction === "up" ? "warmup.feedback.slowDown" : "warmup.feedback.slowStraighten";
    case "forward":
      return "warmup.feedback.forward";
    case "sideways":
      return "warmup.feedback.sideways";
    case "next_index":
      return "warmup.feedback.nextIndex";
    case "next_middle":
      return "warmup.feedback.nextMiddle";
    case "next_ring":
      return "warmup.feedback.nextRing";
    case "next_little":
      return "warmup.feedback.nextLittle";
    case "compensation_back":
      return "warmup.cue.back";
    case "compensation_shoulder":
      return "warmup.cue.shoulder";
  }
}

/** The words for a feedback event, using the exercise's own words where it has them. */
export function exerciseFeedbackKey(
  feedback: ExerciseFeedback,
  exercise: ExerciseDefinition,
): TranslationKey {
  return exercise.text?.feedback?.[feedback] ?? feedbackKey(feedback, exercise.direction);
}

/** Shown until the exercise's start position is seen. */
export function exerciseWaitingKey(exercise: ExerciseDefinition): TranslationKey {
  return exercise.text?.waiting ?? awaitingRestKey(exercise.direction);
}

export function trackingLostKey(exercise: ExerciseDefinition): TranslationKey {
  return exercise.text?.trackingLost ?? "warmup.trackingLost";
}

/** Degrees as "95°", a share of arm length as "80%", and a palm-length ratio as "1.45". */
export function formatMeasure(value: number, unit: MeasureUnit): string {
  switch (unit) {
    case "deg":
      return t("warmup.gauge.degrees", { value: formatNumber(value, 0) });
    case "arm_ratio":
      return t("warmup.gauge.percent", { value: formatNumber(value * 100, 0) });
    case "palm_ratio":
      return t("warmup.gauge.value", { value: formatNumber(value, 2) });
  }
}

/** One to three stars, so that any effort earns something. */
export function starsFor(fullReps: number, targetReps: number): number {
  if (fullReps <= 0) return 0;
  if (fullReps >= targetReps) return 3;
  return fullReps >= targetReps / 2 ? 2 : 1;
}

/** Shown while the arm has to reach its starting position before a rep can count. */
export function awaitingRestKey(direction: RepDirection): TranslationKey {
  return direction === "up" ? "warmup.waiting.lower" : "warmup.waiting.straighten";
}
