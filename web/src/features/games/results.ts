import type { GameRun, GameRunDetail, LastSessionGame, TrialOutcome, TrialRead } from "@/types/api";

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
      trial.target
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
