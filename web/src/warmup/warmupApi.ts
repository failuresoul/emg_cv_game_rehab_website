import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { PATIENT_KEY } from "@/features/patient/usePatientData";
import { api } from "@/lib/api";
import type { WarmupRep, WarmupResult, WarmupResultCreate } from "@/types/api";

import type { ExerciseResult } from "./exerciseRunner";
import { ALL_EXERCISE_IDS, type ExerciseDefinition, type ExerciseId, EXERCISES } from "./exercises";
import { reasonSummary, type WarmupHistoryEntry } from "./personalise";

/** As many earlier results as personalisation looks at. */
const HISTORY_LIMIT = 5;
const HAND_MEASURES = new Set(["handApertureRatio", "thumbFingerDistances"]);

export const warmupHistoryKey = (exerciseId: ExerciseId) => [
  ...PATIENT_KEY,
  "warmup",
  "history",
  exerciseId,
];

export function toHistoryEntry(result: WarmupResult): WarmupHistoryEntry {
  return {
    fullReps: result.full_reps,
    targetReps: result.target_reps,
    compensationRate: result.compensation_rate,
    bestPeak: result.best_peak,
    thresholds: { low: result.thresholds.low, high: result.thresholds.high },
    sessionId: result.session_id,
  };
}

/** Each exercise's history without the given session, so a warm-up is not compared with itself. */
export function historiesBefore(
  histories: Record<ExerciseId, WarmupHistoryEntry[]>,
  sessionId: number | null,
): Record<ExerciseId, WarmupHistoryEntry[]> {
  return Object.fromEntries(
    Object.entries(histories).map(([exerciseId, entries]) => [
      exerciseId,
      entries.filter((entry) => sessionId === null || entry.sessionId !== sessionId),
    ]),
  ) as Record<ExerciseId, WarmupHistoryEntry[]>;
}

export interface WarmupHistories {
  /** True until every request has finished, successfully or not. */
  isPending: boolean;
  /** Newest first. Empty for an exercise whose request failed, which means standard targets. */
  histories: Record<ExerciseId, WarmupHistoryEntry[]>;
}

/** The patient's recent results for every exercise, one request each, in parallel. */
export function useWarmupHistories(): WarmupHistories {
  return useQueries({
    queries: ALL_EXERCISE_IDS.map((exerciseId) => ({
      queryKey: warmupHistoryKey(exerciseId),
      queryFn: async () =>
        (
          await api.get<WarmupResult[]>("/patient/warmup/history", {
            params: { exercise_id: exerciseId, limit: HISTORY_LIMIT },
          })
        ).data.map(toHistoryEntry),
      // A failure only means standard targets today, so do not keep the patient waiting.
      retry: 1,
      staleTime: 0,
    })),
    combine: (results) => ({
      isPending: results.some((result) => result.isPending),
      histories: Object.fromEntries(
        ALL_EXERCISE_IDS.map((exerciseId, index) => [exerciseId, results[index].data ?? []]),
      ) as Record<ExerciseId, WarmupHistoryEntry[]>,
    }),
  });
}

/** The saved form of a result: unfiltered peaks, and the reason for a personal target. */
export function toWarmupPayload(
  result: ExerciseResult,
  definition: ExerciseDefinition = EXERCISES[result.exerciseId],
): WarmupResultCreate {
  const reps: WarmupRep[] = result.reps.map((rep) => ({
    index: rep.index,
    peak: rep.rawPeakValue,
    duration_ms: rep.durationMs,
    compensated: rep.compensated,
    compensation_type: rep.compensationTypes.length > 0 ? rep.compensationTypes.join("+") : null,
  }));
  const personalisation = result.personalisation;
  return {
    exercise_id: result.exerciseId,
    preset: result.preset,
    thresholds: { ...result.thresholds, unit: definition.unit },
    personalisation: personalisation
      ? {
          previous_high: personalisation.previousHigh,
          new_high: personalisation.newHigh,
          reason: reasonSummary(personalisation),
        }
      : null,
    full_reps: result.fullReps,
    partial_reps: result.partialReps,
    target_reps: definition.targetReps,
    best_peak: result.bestRawPeak,
    mean_duration_ms: result.meanDurationMs,
    active_time_ms: result.activeTimeMs,
    paused_time_ms: result.pausedTimeMs,
    measure_source: result.measureSource,
    // Hand measures do not depend on the trunk at all.
    trunk_reference: HAND_MEASURES.has(definition.measure) ? "n/a" : result.trunkReference,
    compensated_reps: result.compensatedReps,
    compensation_rate: result.compensationRate,
    reps,
    skipped: result.skipped,
  };
}

export interface SaveOptions {
  /** Further attempts after a failure, waiting 1, 2, 4… seconds between them. */
  retries?: number;
}

/** 1, 2, 4… seconds, so a brief network problem has time to clear. */
export const saveRetryDelay = (attempt: number) => 1000 * 2 ** attempt;

/** Saves results; saving an exercise again replaces its earlier result in this session. */
export function useSaveWarmupResults({ retries = 0 }: SaveOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: retries,
    retryDelay: saveRetryDelay,
    mutationFn: async ({ sessionId, results }: { sessionId: number; results: ExerciseResult[] }) =>
      (
        await api.post<WarmupResult[]>(
          `/sessions/${sessionId}/warmup`,
          results.map((result) => toWarmupPayload(result)),
        )
      ).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: PATIENT_KEY }),
  });
}

/** One saved session's warm-up results, for its history page. */
export function useSessionWarmup(sessionId: number | null) {
  return useQuery({
    queryKey: [...PATIENT_KEY, "sessions", sessionId, "warmup"],
    queryFn: async () => (await api.get<WarmupResult[]>(`/sessions/${sessionId}/warmup`)).data,
    enabled: sessionId !== null,
  });
}
