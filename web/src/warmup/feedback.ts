import type { TranslationKey } from "@/i18n";

import type { ExerciseFeedback } from "./exerciseRunner";
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
  }
}

/** Shown while the arm has to reach its starting position before a rep can count. */
export function awaitingRestKey(direction: RepDirection): TranslationKey {
  return direction === "up" ? "warmup.waiting.lower" : "warmup.waiting.straighten";
}
