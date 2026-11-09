import { useQuery } from "@tanstack/react-query";

import { PATIENT_KEY } from "@/features/patient/usePatientData";
import { api } from "@/lib/api";
import type { PatientProgress, SessionReport } from "@/types/api";

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
