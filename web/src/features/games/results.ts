import type { TranslationKey } from "@/i18n";
import {
  type GameId,
  type GameRun,
  type GameRunDetail,
  type GameSummary,
  isSpatialTarget,
  type LastSessionGame,
  type TrialOutcome,
  type TrialRead,
} from "@/types/api";

/** Summary `details` keys the games fill in. */
export const DETAIL_HIGHEST_POPPED = "highest_popped_frac";
export const DETAIL_WIDEST_CATCH = "widest_catch_frac";

/** Runs the patient finished or stopped; a run left open has no result yet. */
export function finishedRuns<T extends Pick<GameRun, "status">>(runs: readonly T[]): T[] {
  return runs.filter((run) => run.status !== "active");
}

/** The session's game score: every finished run's score added up. Null if none has a score. */
export function totalScore(
  runs: readonly (Pick<GameRun, "status" | "score"> | LastSessionGame)[],
): number | null {
  const scores = runs
    .filter((run) => !("status" in run) || run.status !== "active")
    .map((run) => run.score)
    .filter((score): score is number => score !== null);
  return scores.length > 0 ? scores.reduce((total, score) => total + score, 0) : null;
}

/** Average reach time in seconds, to one decimal, or null when there is none. */
export function meanReachSeconds(run: Pick<GameRun, "summary">): number | null {
  const ms = run.summary?.mean_movement_ms;
  return ms === null || ms === undefined ? null : Math.round(ms / 100) / 10;
}

/** A share from 0 to 1 as a whole percentage. */
export function percent(share: number | null | undefined): number | null {
  return share === null || share === undefined ? null : Math.round(share * 100);
}

export interface MainMeasure {
  labelKey: TranslationKey;
  /** The value's text and its numbers, or null when the game has nothing to show yet. */
  value: { key: TranslationKey; params: Record<string, number> } | null;
}

const detail = (summary: GameSummary | null, key: string): number | null => {
  const value = summary?.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * Each game's headline figure, shown on the results screen, in history and to the admin: the
 * average reach time for Reach and squeeze, the highest balloon popped for Balloon pop, and the
 * widest catch for Fruit catch. The last two are shares of the patient's own reach.
 */
export function mainMeasure(gameId: GameId, summary: GameSummary | null): MainMeasure {
  if (gameId === "balloon_pop") {
    const share = percent(detail(summary, DETAIL_HIGHEST_POPPED));
    return {
      labelKey: "measure.highestBalloon",
      value: share === null ? null : { key: "measure.ofReach", params: { value: share } },
    };
  }
  if (gameId === "fruit_catch") {
    const share = percent(detail(summary, DETAIL_WIDEST_CATCH));
    return {
      labelKey: "measure.widestCatch",
      value: share === null ? null : { key: "measure.ofReach", params: { value: share } },
    };
  }
  const seconds = summary ? meanReachSeconds({ summary }) : null;
  return {
    labelKey: "measure.meanReach",
    value: seconds === null ? null : { key: "game.results.seconds", params: { value: seconds } },
  };
}

/** The largest value among successful trials, or null if there were none. */
export function bestOfSuccesses(
  trials: readonly { outcome: TrialOutcome; value: number | null | undefined }[],
): number | null {
  const values = trials
    .filter((trial) => trial.outcome === "success")
    .map((trial) => trial.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export interface TargetMarker {
  key: string;
  /** In the body frame, in shoulder widths. */
  x: number;
  y: number;
  outcome: TrialOutcome;
  compensated: boolean;
}

/** Where every trial's target was, across all runs, for drawing on the reach map. */
export function targetMarkers(runs: readonly GameRunDetail[]): TargetMarker[] {
  return runs.flatMap((run) =>
    run.trials.flatMap((trial) =>
      isSpatialTarget(trial.target)
        ? [
            {
              key: `${run.id}-${trial.trial_no}`,
              x: trial.target.x_sw,
              y: trial.target.y_sw,
              outcome: trial.outcome,
              compensated: trial.compensation.flagged,
            },
          ]
        : [],
    ),
  );
}

export interface MovementPoint {
  trialNo: number;
  /** Seconds; null for a trial that never reached the target. */
  seconds: number | null;
  outcome: TrialOutcome;
}

/** Movement time per trial, in trial order. */
export function movementSeries(trials: readonly TrialRead[]): MovementPoint[] {
  return [...trials]
    .sort((a, b) => a.trial_no - b.trial_no)
    .map((trial) => ({
      trialNo: trial.trial_no,
      seconds:
        trial.metrics.movement_ms === null
          ? null
          : Math.round(trial.metrics.movement_ms / 10) / 100,
      outcome: trial.outcome,
    }));
}
