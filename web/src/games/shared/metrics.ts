import type { GameSummary, TrajectoryPoint, TrialCreate } from "@/types/api";

/** Movement starts once the fingertip is this far from where the trial began, in SW. */
export const MOVE_ONSET_SW = 0.05;

export interface PathMetrics {
  /** Relative to spawn; null if the fingertip never moved. */
  moveOnsetMs: number | null;
  pathLengthSw: number | null;
  straightDistSw: number | null;
  /** Straight distance over path length, from 0 to 1; 1 is a perfectly straight movement. */
  pathEfficiency: number | null;
  peakSpeedSwS: number | null;
}

/** Path measures from a recorded trajectory, up to `untilMs` (for example entering the target). */
export function pathMetrics(
  trajectory: readonly TrajectoryPoint[],
  untilMs = Infinity,
): PathMetrics {
  const points = trajectory.filter(([t]) => t <= untilMs);
  if (points.length < 2) {
    return {
      moveOnsetMs: null,
      pathLengthSw: null,
      straightDistSw: null,
      pathEfficiency: null,
      peakSpeedSwS: null,
    };
  }
  const [, startX, startY] = points[0];
  let length = 0;
  let peakSpeed = 0;
  let moveOnsetMs: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const [t0, x0, y0] = points[i - 1];
    const [t1, x1, y1] = points[i];
    const step = Math.hypot(x1 - x0, y1 - y0);
    length += step;
    if (t1 > t0) peakSpeed = Math.max(peakSpeed, step / ((t1 - t0) / 1000));
    if (moveOnsetMs === null && Math.hypot(x1 - startX, y1 - startY) >= MOVE_ONSET_SW) {
      moveOnsetMs = t1;
    }
  }
  const [, endX, endY] = points[points.length - 1];
  const straight = Math.hypot(endX - startX, endY - startY);
  return {
    moveOnsetMs,
    pathLengthSw: length,
    straightDistSw: straight,
    pathEfficiency: length > 0 ? Math.min(1, straight / length) : null,
    peakSpeedSwS: peakSpeed,
  };
}

const mean = (values: readonly number[]) =>
  values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;

/** The run summary the server stores, from the trials logged. Aborted trials still count. */
export function summariseTrials(trials: readonly TrialCreate[]): GameSummary {
  const successes = trials.filter((trial) => trial.outcome === "success");
  const numbers = (values: (number | null)[]) =>
    values.filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    successes: successes.length,
    success_rate: trials.length > 0 ? successes.length / trials.length : 0,
    mean_movement_ms: mean(numbers(successes.map((trial) => trial.metrics.movement_ms))),
    mean_path_efficiency: mean(numbers(successes.map((trial) => trial.metrics.path_efficiency))),
    compensated_trials: trials.filter((trial) => trial.compensation.flagged).length,
  };
}
