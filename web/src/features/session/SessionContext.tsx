import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

import { useAuth } from "@/features/auth/AuthContext";
import {
  LATEST_CALIBRATION_KEY,
  PATIENT_KEY,
  useLatestCalibration,
} from "@/features/patient/usePatientData";
import { GAME_IDS } from "@/games/shared/registry";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type {
  Calibration,
  CalibrationCreate,
  DeviceInfo,
  GameId,
  SessionProgressUpdate,
  SessionRecord,
  SessionStep,
  Side,
} from "@/types/api";

import type { ExerciseResult } from "@/warmup/exerciseRunner";

import { browserName } from "./calibration";
import {
  createQueue,
  finishGame as finishInQueue,
  type GameQueue,
  loadQueue,
  nextAfter,
  saveQueue,
} from "./gameQueue";
import { queueFromServer, stepForPath } from "./sessionSteps";

const SESSION_KEY = ["session", "current"];
/** The active session, if any, without starting one; for the home page's resume offer. */
export const ACTIVE_SESSION_KEY = ["session", "active"];
/** The session just finished, so a refresh on the summary shows it rather than a new one. */
const SUMMARY_STORAGE_KEY = "motionlab.summarySession";
/** Progress saves share this scope, so they reach the server in the order they were made. */
const PROGRESS_SCOPE = "session-progress";

function isStatus(error: unknown, ...statuses: number[]): boolean {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status !== undefined && statuses.includes(status);
}

function readSummarySession(): number | null {
  try {
    const value = Number(sessionStorage.getItem(SUMMARY_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSummarySession(sessionId: number | null): void {
  try {
    if (sessionId === null) sessionStorage.removeItem(SUMMARY_STORAGE_KEY);
    else sessionStorage.setItem(SUMMARY_STORAGE_KEY, String(sessionId));
  } catch {
    // Not kept: a refresh on the summary then starts afresh.
  }
}

async function startOrResumeSession(): Promise<SessionRecord> {
  const device_info: DeviceInfo = { browser: browserName(navigator.userAgent) };
  return (await api.post<SessionRecord>("/sessions", { device_info })).data;
}

/** The active session, or null. Never starts one. */
export async function fetchActiveSession(): Promise<SessionRecord | null> {
  try {
    return (await api.get<SessionRecord>("/sessions/current")).data;
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

/** Starts or resumes the session, ready for the session pages to use. */
export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startOrResumeSession,
    // The button shows its own message.
    meta: SILENT,
    onSuccess: (session) => {
      writeSummarySession(null);
      queryClient.setQueryData(SESSION_KEY, session);
      queryClient.setQueryData(ACTIVE_SESSION_KEY, session);
    },
  });
}

/** Ends the old session as aborted and starts a new one, for "Start over". */
export function useStartOver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (oldSessionId: number) => {
      try {
        await api.post(`/sessions/${oldSessionId}/end`, { status: "aborted" });
      } catch (error) {
        // Already ended or gone: there is nothing to stop.
        if (!isStatus(error, 404, 409)) throw error;
      }
      return startOrResumeSession();
    },
    onSuccess: (session) => {
      writeSummarySession(null);
      queryClient.setQueryData(SESSION_KEY, session);
      queryClient.setQueryData(ACTIVE_SESSION_KEY, session);
      void queryClient.invalidateQueries({ queryKey: PATIENT_KEY });
    },
  });
}

interface SessionContextValue {
  sessionId: number | null;
  /** The session as last saved, with its step and queue. Null on a refreshed summary. */
  session: SessionRecord | null;
  affectedSide: Side | null;
  /** This session's saved calibration, for the pages after calibration. */
  calibration: Calibration | null;
  /** The patient's most recent calibration, which may be from an earlier session. */
  latestCalibration: Calibration | null;
  /** One result for each exercise done or skipped in this tab, held in memory. */
  warmupResults: ExerciseResult[];
  addWarmupResult: (result: ExerciseResult) => void;
  /** Today's games in order; saved on the server, so a refresh carries on at the right game. */
  gameQueue: GameQueue | null;
  /** Sets today's games, starting with the first. */
  startGames: (games: readonly GameId[]) => void;
  /** Marks a game as done and returns the next one, or null to move on to the cool-down. */
  finishGame: (gameId: GameId) => GameId | null;
  /** Saves the step the patient is on. Quietly: a failure only means a less exact resume. */
  saveStep: (step: SessionStep) => void;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  // Read once: on a refreshed summary, show the session that was just finished.
  const [summarySessionId] = useState(() =>
    stepForPath(pathname) === "summary" ? readSummarySession() : null,
  );

  // Normally already filled by Start session. Otherwise, such as after a refresh, it resumes.
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: startOrResumeSession,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: summarySessionId === null,
  });

  const latest = useLatestCalibration();
  const record = summarySessionId === null ? (session.data ?? null) : null;
  const sessionId = summarySessionId ?? record?.id ?? null;

  // Kept with their session, so Start over begins with none.
  const [warmup, setWarmup] = useState<{ sessionId: number | null; results: ExerciseResult[] }>({
    sessionId: null,
    results: [],
  });
  const warmupResults = useMemo(
    () => (warmup.sessionId === sessionId ? warmup.results : []),
    [warmup, sessionId],
  );
  const addWarmupResult = useCallback(
    (result: ExerciseResult) => {
      setWarmup((current) => ({
        sessionId,
        results: [
          ...(current.sessionId === sessionId ? current.results : []).filter(
            (item) => item.exerciseId !== result.exerciseId,
          ),
          result,
        ],
      }));
    },
    [sessionId],
  );
  const latestCalibration = latest.data ?? null;

  const { mutate: saveProgress } = useMutation({
    mutationFn: async ({ id, update }: { id: number; update: SessionProgressUpdate }) =>
      (await api.patch<SessionRecord>(`/sessions/${id}/progress`, update)).data,
    meta: SILENT,
    // One at a time, in order, so "plan" saved on arrival cannot land after "game" from Start.
    scope: { id: PROGRESS_SCOPE },
    onSuccess: (saved) => {
      // Only while it is still the session in use, not one replaced by Start over.
      queryClient.setQueryData<SessionRecord>(SESSION_KEY, (current) =>
        current?.id === saved.id ? saved : current,
      );
    },
  });

  const [queueState, setGameQueue] = useState<GameQueue | null>(null);
  // Before anything is set in this tab: the server's queue, else one saved in this tab.
  const gameQueue = useMemo(() => {
    if (queueState?.sessionId === sessionId) return queueState;
    if (sessionId === null) return null;
    return (
      queueFromServer(sessionId, record?.game_queue, GAME_IDS) ?? loadQueue(sessionId, GAME_IDS)
    );
  }, [queueState, sessionId, record?.game_queue]);

  const saveStep = useCallback(
    (step: SessionStep) => {
      if (record === null || record.status !== "active" || record.current_step === step) return;
      saveProgress({ id: record.id, update: { current_step: step } });
    },
    [record, saveProgress],
  );

  const startGames = useCallback(
    (games: readonly GameId[]) => {
      if (sessionId === null) return;
      const queue = createQueue(sessionId, games);
      saveQueue(queue);
      setGameQueue(queue);
      saveProgress({
        id: sessionId,
        update: { current_step: "game", game_queue: { games: queue.games, index: 0 } },
      });
    },
    [sessionId, saveProgress],
  );
  const finishGame = useCallback(
    (gameId: GameId) => {
      const next = nextAfter(gameQueue, gameId);
      if (gameQueue) {
        const queue = finishInQueue(gameQueue, gameId);
        saveQueue(queue);
        setGameQueue(queue);
        saveProgress({
          id: queue.sessionId,
          update: {
            current_step: next ? "game" : "cooldown",
            game_queue: { games: queue.games, index: queue.index },
          },
        });
      }
      return next;
    },
    [gameQueue, saveProgress],
  );

  return (
    <SessionContext.Provider
      value={{
        sessionId,
        session: record,
        affectedSide: user?.patient_profile?.affected_side ?? null,
        calibration: latestCalibration?.session_id === sessionId ? latestCalibration : null,
        latestCalibration,
        warmupResults,
        addWarmupResult,
        gameQueue,
        startGames,
        finishGame,
        saveStep,
        isLoading: (summarySessionId === null && session.isPending) || latest.isPending,
        // Only a failed first load: a failed background refresh must not wipe a page in progress.
        isError: session.isLoadingError || latest.isLoadingError,
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

/**
 * Every session page calls this with its step, so a refresh or a return resumes there. It saves
 * once on arriving at the step, not again when the saved session changes, so a later save (such
 * as "cooldown" after the last game) is never overwritten by the page still showing.
 */
export function useSessionStep(step: SessionStep): void {
  const { saveStep } = useSession();
  const saveRef = useRef(saveStep);
  useEffect(() => {
    saveRef.current = saveStep;
  }, [saveStep]);
  useEffect(() => saveRef.current(step), [step]);
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
      return { sessionId, status };
    },
    onSuccess: ({ sessionId, status }) => {
      // Kept for the summary, so a refresh there shows this session.
      writeSummarySession(status === "completed" ? sessionId : null);
      queryClient.setQueryData(ACTIVE_SESSION_KEY, null);
      void queryClient.invalidateQueries({ queryKey: PATIENT_KEY });
    },
  });
}

/** Saves the step just before the session ends, so the summary is its last step. */
export function useSaveFinalStep() {
  return useMutation({
    mutationFn: async ({ sessionId, step }: { sessionId: number; step: SessionStep }) => {
      await api.patch(`/sessions/${sessionId}/progress`, { current_step: step });
    },
    meta: SILENT,
    scope: { id: PROGRESS_SCOPE },
  });
}

/** Call after leaving the session pages, so that the next visit starts or resumes afresh. */
export function useForgetSession() {
  const queryClient = useQueryClient();
  return () => {
    writeSummarySession(null);
    queryClient.removeQueries({ queryKey: SESSION_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
  };
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
      void queryClient.invalidateQueries({ queryKey: PATIENT_KEY });
    },
  });
}
