import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  AdminAlert,
  AdminCalibration,
  AdminRecentSession,
  AdminSessionDetail,
  AdminWarmupHistory,
  AdminStats,
  Patient,
  PatientCreate,
  PatientUpdate,
  SessionSummary,
} from "@/types/api";

const ADMIN_KEY = "admin";

/** Every admin query starts with ADMIN_KEY, so a change refreshes lists, details and stats. */
function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: [ADMIN_KEY] });
}

export function useStats() {
  return useQuery({
    queryKey: [ADMIN_KEY, "stats"],
    queryFn: async () => (await api.get<AdminStats>("/admin/stats")).data,
  });
}

export function usePatients(search = "") {
  return useQuery({
    queryKey: [ADMIN_KEY, "patients", search],
    queryFn: async () => {
      const params = search ? { search } : undefined;
      return (await api.get<Patient[]>("/admin/patients", { params })).data;
    },
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id],
    queryFn: async () => (await api.get<Patient>(`/admin/patients/${id}`)).data,
  });
}

export function usePatientSessions(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "sessions"],
    queryFn: async () => (await api.get<SessionSummary[]>(`/admin/patients/${id}/sessions`)).data,
  });
}

/** Warm-up history per exercise, oldest first, without skipped exercises. */
export function usePatientWarmup(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "warmup"],
    queryFn: async () => (await api.get<AdminWarmupHistory[]>(`/admin/patients/${id}/warmup`)).data,
  });
}

export function usePatientCalibrations(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "calibrations"],
    queryFn: async () =>
      (await api.get<AdminCalibration[]>(`/admin/patients/${id}/calibrations`)).data,
  });
}

/** Every patient's sessions, newest first. */
export function useRecentSessions(limit = 10) {
  return useQuery({
    queryKey: [ADMIN_KEY, "sessions", "recent", limit],
    queryFn: async () =>
      (await api.get<AdminRecentSession[]>("/admin/sessions", { params: { limit } })).data,
  });
}

/** One session with its calibration, warm-up and every game trial. */
export function useAdminSession(id: string) {
  return useQuery({
    queryKey: [ADMIN_KEY, "session", id],
    queryFn: async () => (await api.get<AdminSessionDetail>(`/admin/sessions/${id}`)).data,
  });
}

/** Sessions whose questionnaire raised a safety flag, newest first. */
export function useAlerts(reviewed?: boolean) {
  return useQuery({
    queryKey: [ADMIN_KEY, "alerts", reviewed ?? "all"],
    queryFn: async () => {
      const params = reviewed === undefined ? undefined : { reviewed };
      return (await api.get<AdminAlert[]>("/admin/alerts", { params })).data;
    },
  });
}

/** Refreshes the alerts, the open-alerts count and the session page, even after a failure:
 * another admin may have reviewed the alert first. */
export function useReviewAlert() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ sessionId, note }: { sessionId: number; note: string }) => {
      const body = { note: note.trim() === "" ? null : note.trim() };
      return (await api.post<AdminAlert>(`/admin/alerts/${sessionId}/review`, body)).data;
    },
    onSettled: invalidate,
  });
}

export function useCreatePatient() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (payload: PatientCreate) =>
      (await api.post<Patient>("/admin/patients", payload)).data,
    onSuccess: invalidate,
  });
}

export function useUpdatePatient(id: number) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (payload: PatientUpdate) =>
      (await api.patch<Patient>(`/admin/patients/${id}`, payload)).data,
    onSuccess: invalidate,
  });
}

export function useSetPatientActive(id: number) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (active: boolean) => {
      const action = active ? "activate" : "deactivate";
      return (await api.post<Patient>(`/admin/patients/${id}/${action}`)).data;
    },
    onSuccess: invalidate,
  });
}
