import { t, type TranslationKey } from "@/i18n";
import type { WarmupResult } from "@/types/api";

import type { ExerciseResult } from "./exerciseRunner";
import {
  type ExerciseDefinition,
  type ExerciseId,
  EXERCISES,
  type ThresholdPreset,
} from "./exercises";
import { formatMeasure } from "./feedback";
import { type PersonalisedTargets, targetOf, type WarmupHistoryEntry } from "./personalise";

/** A goal is reached with 90% of the target reps done in full, as on the server. */
export const GOAL_SHARE = 0.9;

export function goalReached(fullReps: number, targetReps: number, skipped = false): boolean {
  return !skipped && targetReps > 0 && fullReps >= GOAL_SHARE * targetReps;
}

/** How a target compares with the previous one: harder, the same, or easier. */
export type GoalMove = "harder" | "same" | "easier";

export function goalMove(exercise: ExerciseDefinition, target: number, previous: number): GoalMove {
  const sign = exercise.direction === "up" ? 1 : -1;
  const difference = sign * (target - previous);
  // Rounding in saved values must not read as a change.
  if (Math.abs(difference) < 1e-6) return "same";
  return difference > 0 ? "harder" : "easier";
}

const isHand = (exercise: ExerciseDefinition) => exercise.unit === "palm_ratio";

const HAND_GOALS: Record<
  "hand_open_close" | "thumb_opposition",
  Record<GoalMove | "first", TranslationKey>
> = {
  hand_open_close: {
    harder: "goal.open.harder",
    same: "goal.open.same",
    easier: "goal.open.easier",
    first: "goal.open.first",
  },
  thumb_opposition: {
    harder: "goal.touch.harder",
    same: "goal.touch.same",
    easier: "goal.touch.easier",
    first: "goal.touch.first",
  },
};

function handGoalKey(exercise: ExerciseDefinition, move: GoalMove | null): TranslationKey {
  const keys =
    exercise.id === "thumb_opposition" ? HAND_GOALS.thumb_opposition : HAND_GOALS.hand_open_close;
  return keys[move ?? "first"];
}

function valueGoalKey(exercise: ExerciseDefinition): TranslationKey {
  if (exercise.measure === "forwardReachRatio") return "goal.reach";
  return exercise.direction === "down" ? "goal.bend" : "goal.raise";
}

/**
 * Today's goal in plain words, such as "Today's goal: raise to 85° (up from 80°) — you did 10 of
 * 10 last time". Hand exercises describe the change rather than a ratio.
 */
export function goalText(
  exercise: ExerciseDefinition,
  target: number,
  personalisation: PersonalisedTargets | null,
): string {
  if (personalisation?.reason === "first_time") return t("goal.firstTime");

  const previous = personalisation?.previousHigh ?? null;
  const move = previous === null ? null : goalMove(exercise, target, previous);
  const parts: string[] = [];
  if (isHand(exercise)) {
    parts.push(t(handGoalKey(exercise, move)));
  } else {
    parts.push(t(valueGoalKey(exercise), { value: formatMeasure(target, exercise.unit) }));
    if (previous !== null) {
      const raw = target - previous;
      const key: TranslationKey =
        Math.abs(raw) < 1e-6 ? "goal.sameAsLast" : raw > 0 ? "goal.upFrom" : "goal.downFrom";
      parts.push(t(key, { value: formatMeasure(previous, exercise.unit) }));
    }
  }
  const evidence = personalisation?.evidence;
  if (evidence) {
    parts.push(t("goal.lastTime", { full: evidence.fullReps, target: evidence.targetReps }));
  }
  return parts.join(" ");
}

export type ChangeVsLast = "better" | "same" | "lower";

/** Changes smaller than these are the same, as measurement noise is about this size. */
const SAME_WITHIN = { deg: 2, arm_ratio: 0.02, palm_ratio: 0.02 } as const;

/** Today's best against last time's, in the direction that is better for the exercise. */
export function changeVsLast(
  exercise: ExerciseDefinition,
  today: number | null,
  previous: number | null,
): ChangeVsLast | null {
  if (today === null || previous === null) return null;
  const sign = exercise.direction === "up" ? 1 : -1;
  const difference = sign * (today - previous);
  if (Math.abs(difference) <= SAME_WITHIN[exercise.unit]) return "same";
  return difference > 0 ? "better" : "lower";
}

export type CompensationLevel = "low" | "some" | "high";

/** Matches personalisation: under 20% raises a target, and over 30% lowers it. */
export function compensationLevel(rate: number): CompensationLevel {
  if (rate < 0.2) return "low";
  return rate <= 0.3 ? "some" : "high";
}

/** One exercise's line in a warm-up table, from a live result or a saved one. */
export interface WarmupRow {
  exerciseId: ExerciseId;
  preset: ThresholdPreset;
  skipped: boolean;
  fullReps: number;
  targetReps: number;
  /** Unfiltered, in the measure's unit. */
  best: number | null;
  /** The target line, in the measure's unit. */
  target: number;
  /** The previous target line, if the target was personalised from one. */
  previousTarget: number | null;
  firstTime: boolean;
  goalReached: boolean;
  compensationRate: number;
  /** Null without an earlier result to compare with. */
  change: ChangeVsLast | null;
}

/** Rows from today's results, compared with each exercise's most recent earlier result. */
export function rowsFromResults(
  results: readonly ExerciseResult[],
  previous: Partial<Record<ExerciseId, WarmupHistoryEntry | undefined>> = {},
): WarmupRow[] {
  return results.map((result) => {
    const exercise = EXERCISES[result.exerciseId];
    const before = previous[result.exerciseId];
    return {
      exerciseId: result.exerciseId,
      preset: result.preset,
      skipped: result.skipped,
      fullReps: result.fullReps,
      targetReps: exercise.targetReps,
      best: result.bestRawPeak,
      target: targetOf(exercise, result.thresholds),
      previousTarget: result.personalisation?.previousHigh ?? null,
      firstTime: result.personalisation?.reason === "first_time",
      goalReached: goalReached(result.fullReps, exercise.targetReps, result.skipped),
      compensationRate: result.compensationRate,
      change: result.skipped
        ? null
        : changeVsLast(exercise, result.bestRawPeak, before?.bestPeak ?? null),
    };
  });
}

/** Rows from a saved session, which has nothing to compare with. */
export function rowsFromSaved(results: readonly WarmupResult[]): WarmupRow[] {
  return results.map((result) => {
    const exercise = EXERCISES[result.exercise_id];
    return {
      exerciseId: result.exercise_id,
      preset: result.preset,
      skipped: result.skipped,
      fullReps: result.full_reps,
      targetReps: result.target_reps,
      best: result.best_peak,
      target: targetOf(exercise, result.thresholds),
      previousTarget: result.personalisation?.previous_high ?? null,
      firstTime: result.personalisation !== null && result.personalisation.previous_high === null,
      goalReached: goalReached(result.full_reps, result.target_reps, result.skipped),
      compensationRate: result.compensation_rate,
      change: null,
    };
  });
}

/** The goal in a few words, for a table cell. */
export function shortGoal(row: WarmupRow): string {
  const exercise = EXERCISES[row.exerciseId];
  if (!isHand(exercise)) return formatMeasure(row.target, exercise.unit);
  if (row.firstTime) return t("goal.short.first");
  if (row.preset === "gentle") return t("goal.short.gentle");
  if (row.previousTarget === null) return t("goal.short.standard");
  const move = goalMove(exercise, row.target, row.previousTarget);
  const keys: Record<GoalMove, TranslationKey> =
    exercise.id === "thumb_opposition"
      ? { harder: "goal.short.closer", same: "goal.short.same", easier: "goal.short.easier" }
      : { harder: "goal.short.wider", same: "goal.short.same", easier: "goal.short.easier" };
  return t(keys[move]);
}

export interface Encouragement {
  key: TranslationKey;
  params: Record<string, number>;
}

/** One short, encouraging sentence, by fixed rules. It never comments on health. */
export function encouragement(rows: readonly WarmupRow[]): Encouragement {
  const done = rows.filter((row) => !row.skipped);
  const reps = done.reduce((total, row) => total + row.fullReps, 0);
  const reached = done.filter((row) => row.goalReached).length;
  const better = done.filter((row) => row.change === "better").length;

  if (done.length === 0 || reps === 0) return { key: "encourage.thanks", params: {} };
  if (reached === done.length) return { key: "encourage.allGoals", params: {} };
  if (better >= 2) return { key: "encourage.better", params: { count: better } };
  if (reached * 2 >= done.length) {
    return { key: "encourage.most", params: { count: reached, total: done.length } };
  }
  return { key: "encourage.effort", params: {} };
}
