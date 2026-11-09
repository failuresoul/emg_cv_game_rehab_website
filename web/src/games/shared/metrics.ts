import type { GameSummary, TrajectoryPoint, TrialCreate } from "@/types/api";

/** Movement starts when the fingertip's speed first goes above this. */
export const MOVE_ONSET_SPEED_SW_S = 0.15;
/**
 * Speed is measured across at least this span, centred on each point (two frames at 30 Hz), so
 * a single frame's tracking jitter does not look like movement.
 */
export const SPEED_SPAN_MS = 60;

export interface ReachPathMetrics {
  /** Spawn to the first point faster than 0.15 SW/s. Null if the fingertip never moved. */
  reactionMs: number | null;
  /** Move onset to entering the target. Null unless both happened. */
  movementMs: number | null;
  /** Along the path from move onset to entering the target (or the last point, if it never did). */
  pathLengthSw: number | null;
  /** Straight from the move-onset point to the entry point (or the last point). */
  straightDistSw: number | null;
  /** Straight distance over path length, from 0 to 1; 1 is a perfectly straight movement. */
  pathEfficiency: number | null;
  peakSpeedSwS: number | null;
}

const EMPTY: ReachPathMetrics = {
  reactionMs: null,
  movementMs: null,
  pathLengthSw: null,
  straightDistSw: null,
  pathEfficiency: null,
  peakSpeedSwS: null,
};

/** Each point's speed, from its neighbours at least SPEED_SPAN_MS apart; null at the ends. */
export function centredSpeeds(points: readonly TrajectoryPoint[]): (number | null)[] {
  return points.map((_, index) => {
    for (let k = 1; index - k >= 0 && index + k < points.length; k++) {
      const [t0, x0, y0] = points[index - k];
      const [t1, x1, y1] = points[index + k];
      if (t1 - t0 >= SPEED_SPAN_MS) return Math.hypot(x1 - x0, y1 - y0) / ((t1 - t0) / 1000);
    }
    return null;
  });
}

/**
 * Reach measures from a trial's raw trajectory (times relative to spawn). `enterMs` is when the
 * fingertip entered the target, or null if it never did; only the path up to it counts.
 */
export function reachPathMetrics(
  trajectory: readonly TrajectoryPoint[],
  enterMs: number | null,
): ReachPathMetrics {
  const points = trajectory.filter(([t]) => t >= 0 && (enterMs === null || t <= enterMs));
  if (points.length < 2) return EMPTY;

  const speeds = centredSpeeds(points);
  const onset = speeds.findIndex((speed) => speed !== null && speed > MOVE_ONSET_SPEED_SW_S);
  if (onset < 0) return EMPTY;

  let length = 0;
  let peak = 0;
  for (let i = onset; i < points.length; i++) {
    const speed = speeds[i];
    if (speed !== null) peak = Math.max(peak, speed);
    if (i > onset) {
      const [, x0, y0] = points[i - 1];
      const [, x1, y1] = points[i];
      length += Math.hypot(x1 - x0, y1 - y0);
    }
  }
  const [reactionMs, startX, startY] = points[onset];
  const [, endX, endY] = points[points.length - 1];
  const straight = Math.hypot(endX - startX, endY - startY);
  return {
    reactionMs,
    movementMs: enterMs === null ? null : Math.max(0, enterMs - reactionMs),
    pathLengthSw: length,
    straightDistSw: straight,
    pathEfficiency: length > 0 ? Math.min(1, straight / length) : null,
    peakSpeedSwS: peak,
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
