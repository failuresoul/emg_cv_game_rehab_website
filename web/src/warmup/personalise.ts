import type { TranslationKey } from "@/i18n";

import type { ExerciseDefinition, Thresholds } from "./exercises";

/** One earlier result for an exercise, as personalisation needs it. Newest first in a history. */
export interface WarmupHistoryEntry {
  fullReps: number;
  targetReps: number;
  /** From 0 to 1. */
  compensationRate: number;
  /** The best unfiltered peak, in the measure's unit; null if nothing was recorded. */
  bestPeak: number | null;
  thresholds: Thresholds;
}

/** Why today's target is what it is. */
export type PersonaliseReason =
  | "first_time"
  | "raised"
  | "lowered_reps"
  | "lowered_compensation"
  | "kept"
  /** A limit moved the target differently from what the rule asked, so the limit is the reason. */
  | "limited";

/** A limit that stopped the target moving as far as the rule asked. */
export type PersonaliseLimit = "best_peak" | "standard_max" | "gentle_floor" | null;

export interface PersonalisedTargets extends Thresholds {
  /** "standard" when there is no history to personalise from. */
  preset: "personal" | "standard";
  /**
   * The target line: high for exercises that rise to a target, low for those that fall to one
   * (bending the elbow, or the thumb's touch distance). Null with no history.
   */
  previousHigh: number | null;
  newHigh: number;
  reason: PersonaliseReason;
  limit: PersonaliseLimit;
  /** The size of one step, in the measure's unit. */
  step: number;
  /** What the rule asked for: 1 harder, -1 easier, 0 the same. */
  change: -1 | 0 | 1;
  /** The result the decision was based on, or null with no history. */
  evidence: { fullReps: number; targetReps: number; compensationRate: number } | null;
}

const RAISE_SUCCESS = 0.9;
const RAISE_MAX_COMPENSATION = 0.2;
const LOWER_SUCCESS = 0.6;
const LOWER_COMPENSATION = 0.3;
/** The hardest a target may get, as a share past the standard target. */
const MAX_PAST_STANDARD = 0.15;
const ANGLE_STEP = 5;
const RATIO_STEP = 0.05;
const TOUCH_STEP = 0.03;
const ANGLE_GAP = 25;
const RATIO_GAP = 0.2;

export function stepFor(exercise: ExerciseDefinition): number {
  if (exercise.counter === "sequence") return TOUCH_STEP;
  return exercise.unit === "deg" ? ANGLE_STEP : RATIO_STEP;
}

/** The line a rep must reach: high going up, low going down. */
export function targetOf(exercise: ExerciseDefinition, thresholds: Thresholds): number {
  return exercise.direction === "up" ? thresholds.high : thresholds.low;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The other line, keeping the gap a rep must travel, or the touch's release gap. */
function withTarget(exercise: ExerciseDefinition, base: Thresholds, target: number): Thresholds {
  if (exercise.counter === "sequence") {
    return { low: target, high: round(target + (base.high - base.low)) };
  }
  const gap = exercise.unit === "deg" ? ANGLE_GAP : RATIO_GAP;
  return exercise.direction === "up"
    ? { low: round(Math.min(base.low, target - gap)), high: target }
    : { low: target, high: round(Math.max(base.high, target + gap)) };
}

/**
 * Today's thresholds from the most recent result: one step harder after a near-perfect set with
 * little compensation, one step easier after a difficult one, otherwise the same. Never past the
 * best peak so far plus a step, nor 15% past the standard target, nor easier than gentle.
 */
export function personaliseThresholds(
  exercise: ExerciseDefinition,
  history: readonly WarmupHistoryEntry[],
  presetBase: Thresholds = exercise.presets.standard,
): PersonalisedTargets {
  const step = stepFor(exercise);
  const recent = history[0];
  if (!recent) {
    return {
      ...presetBase,
      preset: "standard",
      previousHigh: null,
      newHigh: targetOf(exercise, presetBase),
      reason: "first_time",
      limit: null,
      step,
      change: 0,
      evidence: null,
    };
  }

  const success = recent.targetReps > 0 ? recent.fullReps / recent.targetReps : 0;
  const compensation = recent.compensationRate;
  let change: -1 | 0 | 1 = 0;
  let reason: PersonaliseReason = "kept";
  if (success >= RAISE_SUCCESS && compensation < RAISE_MAX_COMPENSATION) {
    change = 1;
    reason = "raised";
  } else if (compensation > LOWER_COMPENSATION) {
    change = -1;
    reason = "lowered_compensation";
  } else if (success < LOWER_SUCCESS) {
    change = -1;
    reason = "lowered_reps";
  }

  // Work in "difficulty", which rises as the exercise gets harder, whichever way it moves.
  const sign = exercise.direction === "up" ? 1 : -1;
  const previous = targetOf(exercise, recent.thresholds);
  let difficulty = sign * previous + change * step;
  let limit: PersonaliseLimit = null;

  const peaks = history.flatMap((entry) =>
    entry.bestPeak !== null && Number.isFinite(entry.bestPeak) ? [sign * entry.bestPeak] : [],
  );
  if (peaks.length > 0) {
    const ceiling = Math.max(...peaks) + step;
    if (difficulty > ceiling) {
      difficulty = ceiling;
      limit = "best_peak";
    }
  }
  const standardTarget = targetOf(exercise, exercise.presets.standard);
  const hardest = sign * standardTarget * (1 + sign * MAX_PAST_STANDARD);
  if (difficulty > hardest) {
    difficulty = hardest;
    limit = "standard_max";
  }
  const easiest = sign * targetOf(exercise, exercise.presets.gentle);
  if (difficulty < easiest) {
    difficulty = easiest;
    limit = "gentle_floor";
  }

  const target = round(sign * difficulty);
  // "Raised" would be untrue if a limit then held the target still or moved it down.
  const moved = Math.sign(sign * (target - previous));
  if (limit !== null && moved !== change) reason = "limited";
  return {
    ...withTarget(exercise, presetBase, target),
    preset: "personal",
    previousHigh: previous,
    newHigh: target,
    reason,
    limit,
    step,
    change,
    evidence: {
      fullReps: recent.fullReps,
      targetReps: recent.targetReps,
      compensationRate: compensation,
    },
  };
}

const REASON_KEYS: Record<PersonaliseReason, TranslationKey> = {
  first_time: "warmup.reason.firstTime",
  raised: "warmup.reason.raised",
  lowered_reps: "warmup.reason.loweredReps",
  lowered_compensation: "warmup.reason.loweredCompensation",
  kept: "warmup.reason.kept",
  limited: "warmup.reason.limited",
};

const LIMIT_KEYS: Record<NonNullable<PersonaliseLimit>, TranslationKey> = {
  best_peak: "warmup.reason.limitBest",
  standard_max: "warmup.reason.limitStandard",
  gentle_floor: "warmup.reason.limitGentle",
};

export interface ReasonText {
  key: TranslationKey;
  params: Record<string, number>;
}

/** The reason, then any limit, as translation keys with their numbers. */
export function reasonTexts(targets: PersonalisedTargets): ReasonText[] {
  const evidence = targets.evidence;
  const params: Record<string, number> = evidence
    ? {
        full: evidence.fullReps,
        target: evidence.targetReps,
        percent: Math.round(evidence.compensationRate * 100),
      }
    : {};
  const texts: ReasonText[] = [{ key: REASON_KEYS[targets.reason], params }];
  if (targets.limit) texts.push({ key: LIMIT_KEYS[targets.limit], params: {} });
  return texts;
}

/** A stable English summary for the saved record, such as "raised: 10/10 reps, 10% compensated". */
export function reasonSummary(targets: PersonalisedTargets): string {
  const evidence = targets.evidence;
  if (!evidence) return "first time: standard target";
  const words: Record<PersonaliseReason, string> = {
    first_time: "first time",
    raised: "raised",
    lowered_reps: "lowered",
    lowered_compensation: "lowered for compensation",
    kept: "kept",
    limited: "adjusted",
  };
  const percent = Math.round(evidence.compensationRate * 100);
  const limit = targets.limit ? `; limited by ${targets.limit.replace("_", " ")}` : "";
  return `${words[targets.reason]}: ${evidence.fullReps}/${evidence.targetReps} reps, ${percent}% compensated${limit}`;
}
