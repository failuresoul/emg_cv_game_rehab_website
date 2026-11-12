import type { EngineLastTrial, GameId, TrialCreate } from "@/types/api";

import { targetLocation } from "./targets";

export type FailureType = EngineLastTrial["failure_type"];

/**
 * Which kind of failure a trial was, so the engine eases the right kind of difficulty:
 * "reach_fail" the distance or accuracy (spatial, then precision), "activation_fail" the squeeze
 * or hand opening (activation), "miss" the time allowed (speed, then spatial). Null for a
 * success or a stopped trial.
 */
export function failureType(gameId: GameId, record: TrialCreate): FailureType {
  const { outcome, timings, metrics } = record;
  if (outcome === "success" || outcome === "aborted") return null;
  if (outcome === "reach_fail" || outcome === "activation_fail") return outcome;
  // A miss: what did the patient not manage?
  switch (gameId) {
    case "balloon_pop":
      // Touched but not squeezed in time; otherwise it floated away before it was reached.
      return timings.enter !== null ? "activation_fail" : "miss";
    case "bloom":
    case "grip_hold":
      // A phase ran out: the hand did not open, close or relax enough in time.
      return "activation_fail";
    case "path_trace":
      // Too little of the trace inside the corridor.
      return "reach_fail";
    case "paint_wall":
      // No full sweep at all: the range asked for was too much; some: not enough time.
      return (metrics.full_sweeps ?? 0) === 0 ? "reach_fail" : "miss";
    case "pick_place":
      // Never grasped: the object was too far or too small; grasped: not carried in time.
      return metrics.grasp_latency_ms == null ? "reach_fail" : "miss";
    default:
      // Fruit catch, Finger piano and Reach and squeeze's time-outs: not in time.
      return "miss";
  }
}

const finite = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The squeeze or hand-opening peak of a trial, for the safety layer's tiring check: the
 * activation peak where a game squeezes, the grip or openness peak in the hand games.
 */
function activationPeak(record: TrialCreate): number | null {
  const { metrics } = record;
  return (
    finite(metrics.activation_peak) ?? finite(metrics.peak_grip) ?? finite(metrics.peak_openness)
  );
}

/** The last trial as the engine and its safety rules need it. */
export function trialSummary(gameId: GameId, record: TrialCreate): EngineLastTrial {
  const movement = finite(record.metrics.movement_ms);
  const end = finite(record.timings.end);
  const spawn = finite(record.timings.spawn) ?? 0;
  return {
    trial_no: record.trial_no,
    outcome: record.outcome,
    failure_type: failureType(gameId, record),
    compensated: record.compensation.flagged,
    movement_ms: movement,
    // Games without a movement time: how long the trial took.
    completion_ms: movement === null && end !== null ? Math.max(0, end - spawn) : null,
    activation_peak: activationPeak(record),
    // Where the target was, so L2 credits the sector played.
    ...targetLocation(gameId, record),
  };
}
