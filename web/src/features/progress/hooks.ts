import { useQuery } from "@tanstack/react-query";

import { PATIENT_KEY } from "@/features/patient/usePatientData";
import { api } from "@/lib/api";
import type { MetricSeries, PatientProgress, SessionReport } from "@/types/api";

import { tzOffsetMinutes } from "./progress";

/** Streak, this week, the last 28 days and one point per completed session, in local days. */
export function usePatientProgress() {
  return useQuery({
    queryKey: [...PATIENT_KEY, "progress"],
    queryFn: async () =>
      (
        await api.get<PatientProgress>("/patient/progress", {
          params: { tz_offset_minutes: tzOffsetMinutes() },
        })
      ).data,
  });
}

/** The end-of-session summary, with figures from earlier sessions to compare against. */
export function useSessionReport(sessionId: number | null) {
  return useQuery({
    queryKey: [...PATIENT_KEY, "sessions", sessionId, "report"],
    queryFn: async () => (await api.get<SessionReport>(`/sessions/${sessionId}/summary`)).data,
    enabled: sessionId !== null,
  });
}

/** The patient's own measures over their completed sessions, oldest first. */
export function usePatientMetricSeries(ids: readonly string[]) {
  return useQuery({
    queryKey: [...PATIENT_KEY, "progress", "metrics", ids.join(",")],
    queryFn: async () =>
      (
        await api.get<MetricSeries[]>("/patient/progress/metrics", {
          params: { ids: ids.join(",") },
        })
      ).data,
  });
}
