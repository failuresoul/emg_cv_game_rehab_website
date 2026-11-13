import type { FeedbackJob, FeedbackReportRead, Language } from "@/types/api";

/**
 * The life of a report request: idle -> preparing -> ready / fallback / error.
 * "fallback" is the template report: it is shown exactly like "ready".
 */
export type FeedbackState =
  | { status: "idle" }
  | { status: "preparing"; jobId: number | null }
  | { status: "ready" | "fallback"; jobId: number; read: FeedbackReportRead }
  | { status: "error"; jobId: number | null; reason: "failed" | "timeout" | "network" };

export interface FeedbackRequest {
  language?: Language;
  regenerate?: boolean;
}

/** The two calls the poller needs; the hook passes the API, tests a fake. */
export interface FeedbackClient {
  start(sessionId: number, request: FeedbackRequest): Promise<FeedbackJob>;
  job(jobId: number): Promise<FeedbackReportRead>;
}

export const POLL_INTERVAL_MS = 1500;
/** The server's own limit is 120 s per report; waiting longer would not help. */
export const POLL_TIMEOUT_MS = 120_000;

export interface PollOptions extends FeedbackRequest {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The finished state for a report read, or null while it is still being written. */
export function stateFromRead(read: FeedbackReportRead): FeedbackState | null {
  if (read.status === "done") return { status: "ready", jobId: read.job_id, read };
  if (read.status === "fallback") return { status: "fallback", jobId: read.job_id, read };
  if (read.status === "failed") return { status: "error", jobId: read.job_id, reason: "failed" };
  return null;
}

/**
 * Asks for the session's report, then polls its job every 1.5 s until it is finished, failed
 * or 120 s have passed. Every state is passed to `onState`; the last one is also returned.
 * After an abort it stops quietly and returns idle.
 */
export async function runFeedback(
  client: FeedbackClient,
  sessionId: number,
  options: PollOptions,
  onState: (state: FeedbackState) => void,
): Promise<FeedbackState> {
  const {
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    signal,
    now = Date.now,
    sleep = sleepFor,
  } = options;
  const idle: FeedbackState = { status: "idle" };
  const emit = (state: FeedbackState): FeedbackState => {
    if (!signal?.aborted) onState(state);
    return state;
  };

  emit({ status: "preparing", jobId: null });
  const started = now();
  let jobId: number | null = null;
  try {
    const request: FeedbackRequest = {};
    if (options.language) request.language = options.language;
    if (options.regenerate) request.regenerate = true;
    const job = await client.start(sessionId, request);
    jobId = job.job_id;
    if (signal?.aborted) return idle;
    emit({ status: "preparing", jobId });
    for (;;) {
      const read = await client.job(jobId);
      if (signal?.aborted) return idle;
      const finished = stateFromRead(read);
      if (finished) return emit(finished);
      if (now() - started >= timeoutMs) {
        return emit({ status: "error", jobId, reason: "timeout" });
      }
      await sleep(intervalMs, signal);
      if (signal?.aborted) return idle;
    }
  } catch {
    if (signal?.aborted) return idle;
    return emit({ status: "error", jobId, reason: "network" });
  }
}
