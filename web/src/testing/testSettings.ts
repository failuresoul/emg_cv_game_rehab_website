/**
 * Shorter sessions for the fast end-to-end tests (Day 18): fewer warm-up repetitions and game
 * trials, read from localStorage "muvi-test-settings" (JSON). Only in test mode; everywhere else
 * these functions change nothing, and the build removes the reading code.
 */

import type { GameDefinition } from "@/games/shared/types";
import type { ExerciseDefinition } from "@/warmup/exercises";

export const TEST_SETTINGS_KEY = "muvi-test-settings";

export interface TestSettings {
  /** Repetitions per warm-up exercise (instead of 10, or 5 for the thumb). */
  warmupReps?: number;
  /** Trials per game (instead of the plan's or the game's own). */
  gameTrials?: number;
}

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

export function readTestSettings(): TestSettings {
  if (!(import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === "true")) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TEST_SETTINGS_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    return { warmupReps: positive(parsed.warmupReps), gameTrials: positive(parsed.gameTrials) };
  } catch {
    return {};
  }
}

export function withTestReps(exercise: ExerciseDefinition): ExerciseDefinition {
  const reps = readTestSettings().warmupReps;
  return reps ? { ...exercise, targetReps: reps } : exercise;
}

export function withTestTrials(game: GameDefinition): GameDefinition {
  const trials = readTestSettings().gameTrials;
  return trials ? { ...game, trialsDefault: trials } : game;
}
