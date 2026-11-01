import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { createContext, type ReactNode, useContext } from "react";

import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import type { Calibration, CalibrationCreate, DeviceInfo, SessionRecord, Side } from "@/types/api";

import { browserName } from "./calibration";

const SESSION_KEY = ["session", "current"];
const LATEST_CALIBRATION_KEY = ["patient", "calibration", "latest"];
const DASHBOARD_KEY = ["patient", "dashboard"];

function isStatus(error: unknown, ...statuses: number[]): boolean {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status !== undefined && statuses.includes(status);
}

async function startOrResumeSession(): Promise<SessionRecord> {
  const device_info: DeviceInfo = { browser: browserName(navigator.userAgent) };
  return (await api.post<SessionRecord>("/sessions", { device_info })).data;
}

/** Starts or resumes the session, ready for the session pages to use. */
export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startOrResumeSession,
    onSuccess: (session) => queryClient.setQueryData(SESSION_KEY, session),
  });
}

interface SessionContextValue {
  sessionId: number | null;
  affectedSide: Side | null;
  /** This session's saved calibration, for the pages after calibration. */
  calibration: Calibration | null;
  /** The patient's most recent calibration, which may be from an earlier session. */
  latestCalibration: Calibration | null;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // Normally already filled by Start session. Otherwise, such as after a refresh, it resumes.
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: startOrResumeSession,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const latest = useQuery({
    queryKey: LATEST_CALIBRATION_KEY,
    queryFn: async (): Promise<Calibration | null> => {
      try {
        return (await api.get<Calibration>("/patient/calibration/latest")).data;
      } catch (error) {
        if (isStatus(error, 404)) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const sessionId = session.data?.id ?? null;
  const latestCalibration = latest.data ?? null;

  return (
    <SessionContext.Provider
      value={{
        sessionId,
        affectedSide: user?.patient_profile?.affected_side ?? null,
        calibration: latestCalibration?.session_id === sessionId ? latestCalibration : null,
        latestCalibration,
        isLoading: session.isPending || latest.isPending,
        isError: session.isError || latest.isError,
        retry: () => {
          void session.refetch();
          void latest.refetch();
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}

/** Ends the session. A session that has already ended or gone counts as success. */
export function useEndSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, status }: { sessionId: number; status: string }) => {
      try {
        await api.post(`/sessions/${sessionId}/end`, { status });
      } catch (error) {
        if (!isStatus(error, 404, 409)) throw error;
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
}

/** Call after leaving the session pages, so that the next visit starts or resumes afresh. */
export function useForgetSession() {
  const queryClient = useQueryClient();
  return () => queryClient.removeQueries({ queryKey: SESSION_KEY });
}

export function useSaveCalibration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      calibration,
      device,
    }: {
      sessionId: number;
      calibration: CalibrationCreate;
      device: DeviceInfo;
    }) => {
      // Useful, but not worth losing the calibration over.
      await api.patch(`/sessions/${sessionId}/device-info`, device).catch(() => undefined);
      return (await api.post<Calibration>(`/sessions/${sessionId}/calibration`, calibration)).data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(LATEST_CALIBRATION_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}
