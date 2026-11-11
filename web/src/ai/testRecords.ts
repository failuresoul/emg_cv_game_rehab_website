import type { TrialCreate, TrialMetrics, TrialTimings } from "@/types/api";

/** A trial as a game logs it, for tests: only what each test sets differs. */
export function record(
  outcome: TrialCreate["outcome"],
  metrics: Partial<TrialMetrics> = {},
  timings: Partial<TrialTimings> = {},
  trialNo = 3,
): TrialCreate {
  return {
    trial_no: trialNo,
    params: {},
    target: null,
    outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: null,
      activation_done: null,
      end: 4200,
      ...timings,
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: null,
      activation_latency_ms: null,
      activation_peak: null,
      ...metrics,
    },
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: [],
  };
}
