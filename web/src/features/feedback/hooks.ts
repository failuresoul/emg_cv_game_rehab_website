import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type {
  AdminReportDetail,
  AdminReportItem,
  FeedbackHealth,
  FeedbackJob,
  FeedbackReportRead,
  Language,
  PatientReportItem,
  RatingCreate,
  RatingRead,
  ReportStatus,
} from "@/types/api";

import { type FeedbackClient, type FeedbackState, runFeedback } from "./feedbackJob";

const FEEDBACK_KEY = "feedback";
const IN_PROGRESS: readonly ReportStatus[] = ["queued", "running"];

export const apiFeedbackClient: FeedbackClient = {
  start: async (sessionId, request) =>
    (await api.post<FeedbackJob>(`/sessions/${sessionId}/feedback`, request)).data,
  job: async (jobId) => (await api.get<FeedbackReportRead>(`/feedback/jobs/${jobId}`)).data,
};

/**
 * The session's report: asks for it (the questionnaire usually queued it already), then polls
 * until it is ready, the template (fallback), or an error. `retry` asks again.
 */
export function useFeedback(sessionId: number | null, language?: Language) {
  const [state, setState] = useState<FeedbackState>({ status: "preparing", jobId: null });
  const [attempt, setAttempt] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (sessionId === null) return undefined;
    const controller = new AbortController();
    void runFeedback(
      apiFeedbackClient,
      sessionId,
      language ? { language, signal: controller.signal } : { signal: controller.signal },
      (next) => {
        setState(next);
        if (next.status === "ready" || next.status === "fallback") {
          // The reports list and the home card show it too.
          void queryClient.invalidateQueries({ queryKey: [FEEDBACK_KEY] });
        }
      },
    );
    return () => controller.abort();
  }, [sessionId, language, attempt, queryClient]);

  return {
    state: sessionId === null ? ({ status: "idle" } as const) : state,
    retry: () => {
      setState({ status: "preparing", jobId: null });
      setAttempt((count) => count + 1);
    },
  };
}

/** The patient's reports, newest first. */
export function usePatientReports() {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "mine"],
    queryFn: async () => (await api.get<PatientReportItem[]>("/patient/reports")).data,
  });
}

/** One report (a job), polled while it is still being written. */
export function useReport(jobId: number | null) {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "job", jobId],
    queryFn: async () => (await api.get<FeedbackReportRead>(`/feedback/jobs/${jobId}`)).data,
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS.includes(query.state.data.status) ? 1500 : false,
  });
}

export function useRateReport(jobId: number) {
  return useMutation({
    mutationFn: async (rating: RatingCreate) =>
      (await api.post<RatingRead>(`/feedback/${jobId}/ratings`, rating)).data,
    // The form shows its own outcome (a 409 means it was already rated).
    meta: SILENT,
  });
}

// Admin

export function useAdminPatientReports(patientId: number) {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "admin", "patient", patientId],
    queryFn: async () =>
      (await api.get<AdminReportItem[]>(`/admin/patients/${patientId}/reports`)).data,
    refetchInterval: (query) =>
      query.state.data?.some((item) => IN_PROGRESS.includes(item.status)) ? 2000 : false,
  });
}

export function useAdminReport(jobId: number | null) {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "admin", "report", jobId],
    queryFn: async () => (await api.get<AdminReportDetail>(`/admin/reports/${jobId}`)).data,
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS.includes(query.state.data.status) ? 1500 : false,
  });
}

export function useAdminReportRatings(jobId: number) {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "admin", "ratings", jobId],
    queryFn: async () => (await api.get<RatingRead[]>(`/admin/reports/${jobId}/ratings`)).data,
  });
}

/** A session's current report for an admin; null when there is none yet. */
export function useAdminSessionReport(sessionId: number, language?: Language) {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "admin", "session", sessionId, language ?? "default"],
    queryFn: async () => {
      try {
        const params = language ? { language } : undefined;
        return (await api.get<FeedbackReportRead>(`/sessions/${sessionId}/feedback`, { params }))
          .data;
      } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS.includes(query.state.data.status) ? 1500 : false,
  });
}

/** Queues a report for a session (a new version with `regenerate`). */
export function useRequestReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      language,
      regenerate = false,
    }: {
      sessionId: number;
      language?: Language;
      regenerate?: boolean;
    }) => apiFeedbackClient.start(sessionId, language ? { language, regenerate } : { regenerate }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [FEEDBACK_KEY] }),
  });
}

export function useFeedbackHealth() {
  return useQuery({
    queryKey: [FEEDBACK_KEY, "health"],
    queryFn: async () => (await api.get<FeedbackHealth>("/feedback/health")).data,
    refetchInterval: 10_000,
  });
}
