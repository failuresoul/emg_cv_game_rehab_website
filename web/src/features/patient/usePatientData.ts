import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { api } from "@/lib/api";
import type { Calibration, GameRun, SessionDetail, SessionSummary } from "@/types/api";

/** Every patient query starts with this, so a change can refresh them all. */
export const PATIENT_KEY = ["patient"];
export const LATEST_CALIBRATION_KEY = [...PATIENT_KEY, "calibration", "latest"];

export function useLatestCalibration() {
  return useQuery({
    queryKey: LATEST_CALIBRATION_KEY,
    queryFn: async (): Promise<Calibration | null> => {
      try {
        return (await api.get<Calibration>("/patient/calibration/latest")).data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useOwnSessions() {
  return useQuery({
    queryKey: [...PATIENT_KEY, "sessions"],
    queryFn: async () => (await api.get<SessionSummary[]>("/patient/sessions")).data,
  });
}

export function useOwnSession(id: string) {
  return useQuery({
    queryKey: [...PATIENT_KEY, "sessions", id],
    queryFn: async () => (await api.get<SessionDetail>(`/patient/sessions/${id}`)).data,
  });
}

/** One of the patient's own sessions' game runs, in the order they were played. */
export function useSessionGames(sessionId: number | null) {
  return useQuery({
    queryKey: [...PATIENT_KEY, "sessions", sessionId, "games"],
    queryFn: async () => (await api.get<GameRun[]>(`/sessions/${sessionId}/games`)).data,
    enabled: sessionId !== null,
  });
}
