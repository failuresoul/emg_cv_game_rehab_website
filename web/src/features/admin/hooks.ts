import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tzOffsetMinutes } from "@/features/progress/progress";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import { GAME_SETTINGS_KEY } from "@/features/games/gameSettings";
import type {
  Alert,
  AlertFilters,
  AdminGameSetting,
  AdminCalibration,
  AdminRecentSession,
  AdminSessionDetail,
  AdminWarmupHistory,
  AdminStats,
  GameId,
  GameSettingUpdate,
  Patient,
  PatientCreate,
  LatestPlan,
  PatientLevels,
  PatientMetrics,
  PatientProgress,
  Programme,
  ProgrammeChange,
  ProgrammeUpdate,
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

/** Streak, this week and the trend series, in the admin's local days. */
export function useAdminPatientProgress(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "progress"],
    queryFn: async () =>
      (
        await api.get<PatientProgress>(`/admin/patients/${id}/progress`, {
          params: { tz_offset_minutes: tzOffsetMinutes() },
        })
      ).data,
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

/** Alerts, newest first, with the given filters (each list may hold several values). */
export function useAlerts(filters: AlertFilters = {}) {
  return useQuery({
    queryKey: [ADMIN_KEY, "alerts", filters],
    queryFn: async () =>
      (
        await api.get<Alert[]>("/admin/alerts", {
          params: filters,
          // Repeated keys (?status=open&status=acknowledged), as the server reads them.
          paramsSerializer: { indexes: null },
        })
      ).data,
    placeholderData: keepPreviousData,
  });
}

/** Acknowledge or resolve one alert, with a note. Refreshes the alerts and counts even after a
 * failure: another admin may have dealt with it first. */
export function useAlertAction() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      note,
    }: {
      id: number;
      action: "acknowledge" | "resolve";
      note: string;
    }) => {
      const body = { note: note.trim() === "" ? null : note.trim() };
      return (await api.post<Alert>(`/admin/alerts/${id}/${action}`, body)).data;
    },
    meta: SILENT,
    onSettled: invalidate,
  });
}

/** The session page's "Mark reviewed": resolves every unresolved alert of the session. */
export function useReviewAlert() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ sessionId, note }: { sessionId: number; note: string }) => {
      const body = { note: note.trim() === "" ? null : note.trim() };
      return (await api.post<Alert[]>(`/admin/sessions/${sessionId}/alerts/resolve`, body)).data;
    },
    onSettled: invalidate,
  });
}

export function useCreatePatient() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (payload: PatientCreate) =>
      (await api.post<Patient>("/admin/patients", payload)).data,
    // The form explains the error next to the field, so no toast.
    meta: SILENT,
    onSuccess: invalidate,
  });
}

export function useUpdatePatient(id: number) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (payload: PatientUpdate) =>
      (await api.patch<Patient>(`/admin/patients/${id}`, payload)).data,
    // The form explains the error next to the field, so no toast.
    meta: SILENT,
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

/** Every game's spec with the admin's setting. */
export function useAdminGames() {
  return useQuery({
    queryKey: [ADMIN_KEY, "games"],
    queryFn: async () => (await api.get<AdminGameSetting[]>("/admin/games")).data,
  });
}

/** Saving or resetting a game also refreshes the patient-side settings in this browser. */
function useInvalidateGames() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "games"] });
    void queryClient.invalidateQueries({ queryKey: [GAME_SETTINGS_KEY] });
  };
}

export function useUpdateGameSetting() {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: async ({ gameId, setting }: { gameId: GameId; setting: GameSettingUpdate }) =>
      (await api.put<AdminGameSetting>(`/admin/games/${gameId}`, setting)).data,
    onSuccess: invalidate,
  });
}

export function useResetGameSetting() {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: async (gameId: GameId) =>
      (await api.post<AdminGameSetting>(`/admin/games/${gameId}/reset`)).data,
    onSuccess: invalidate,
  });
}

/** Each catalogue measure's change against the patient's baseline, with every series. */
export function useAdminPatientMetrics(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "metrics"],
    queryFn: async () => (await api.get<PatientMetrics>(`/admin/patients/${id}/metrics`)).data,
  });
}

/** The patient's engine mode and current difficulty level in each game. */
export function useAdminPatientLevels(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "levels"],
    queryFn: async () => (await api.get<PatientLevels>(`/admin/patients/${id}/levels`)).data,
  });
}

/** The patient's most recent plan with its reasons, and the changes they made to it. */
export function useAdminPatientPlan(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "plan"],
    queryFn: async () => (await api.get<LatestPlan>(`/admin/patients/${id}/plan`)).data,
  });
}

/** The patient's programme: games and highest levels, session, warm-up, AI, sensor and goals. */
export function useAdminProgramme(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "programme"],
    queryFn: async () => (await api.get<Programme>(`/admin/patients/${id}/programme`)).data,
  });
}

/** Every change of the programme, newest first. */
export function useProgrammeHistory(id: number) {
  return useQuery({
    queryKey: [ADMIN_KEY, "patient", id, "programme", "history"],
    queryFn: async () =>
      (await api.get<ProgrammeChange[]>(`/admin/patients/${id}/programme/history`)).data,
  });
}

export function useSaveProgramme(id: number) {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (payload: ProgrammeUpdate) =>
      (await api.put<Programme>(`/admin/patients/${id}/programme`, payload)).data,
    // The save dialog explains the error.
    meta: SILENT,
    onSuccess: invalidate,
  });
}
