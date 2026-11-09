import type { GameRun, GameRunEnd, GameRunStart, TrialCreate } from "@/types/api";

import type { TrialHistoryEntry } from "./types";

/** Uploads happen every this many trials, and at the end. */
export const UPLOAD_EVERY = 10;
/** The server accepts at most this many trials in one request. */
export const MAX_BATCH = 50;
/** Further attempts after a failure. */
export const RETRIES = 3;

/** 1, 2 and 4 seconds, so a brief network problem has time to clear. */
export const retryDelayMs = (attempt: number) => 1000 * 2 ** attempt;

/** The part of axios the logger uses, so tests can pass a mock. */
export interface HttpClient {
  post<T>(url: string, data?: unknown): Promise<{ data: T }>;
}

/**
 * idle: nothing sent yet; saving: a request is running; saved: the last request succeeded;
 * unsaved: the last request failed after every retry, and its trials are kept for the next one.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "unsaved";

export interface TrialLoggerOptions {
  http: HttpClient;
  sessionId: number;
  /** The run to start, or a function giving it when the run is actually started. */
  run: GameRunStart | (() => GameRunStart);
  uploadEvery?: number;
  retries?: number;
  retryDelay?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : undefined;
}

/** A 4xx answer will not change by asking again; a network error or 5xx might. */
const isWorthRetrying = (error: unknown) => {
  const status = statusOf(error);
  return status === undefined || status >= 500 || status === 408 || status === 429;
};

/**
 * Saves one game run: starts it on the server, uploads trials in batches, and ends it. Requests
 * run one at a time in order. Trials that fail to upload stay in memory and go with the next
 * upload; the server replaces a trial sent twice, so resending is always safe.
 */
export class TrialLogger {
  private readonly http: HttpClient;
  private readonly sessionId: number;
  private readonly runStart: GameRunStart | (() => GameRunStart);
  private readonly uploadEvery: number;
  private readonly retries: number;
  private readonly retryDelay: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly listeners = new Set<(status: SaveStatus) => void>();

  private runId: number | null = null;
  /** No more trials are accepted once end() has been called. */
  private ended = false;
  /** The server has confirmed the end, so calling end() again only uploads. */
  private runEnded = false;
  /** Logged but not yet confirmed by the server, by trial_no. */
  private readonly pending = new Map<number, TrialCreate>();
  private readonly logged: TrialHistoryEntry[] = [];
  private sinceUpload = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private running = 0;
  private lastFailed = false;
  private currentStatus: SaveStatus = "idle";

  constructor({
    http,
    sessionId,
    run,
    uploadEvery = UPLOAD_EVERY,
    retries = RETRIES,
    retryDelay = retryDelayMs,
    sleep = defaultSleep,
  }: TrialLoggerOptions) {
    this.http = http;
    this.sessionId = sessionId;
    this.runStart = run;
    this.uploadEvery = uploadEvery;
    this.retries = retries;
    this.retryDelay = retryDelay;
    this.sleep = sleep;
  }

  get status(): SaveStatus {
    return this.currentStatus;
  }

  get gameRunId(): number | null {
    return this.runId;
  }

  /** Trials not yet confirmed by the server. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Every trial logged in this run, oldest first, for choosing the next trial's settings. */
  get history(): readonly TrialHistoryEntry[] {
    return this.logged;
  }

  subscribe(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts the run on the server. Resolves to false if that failed after every retry. */
  start(): Promise<boolean> {
    return this.enqueue(() => this.ensureRun());
  }

  /** Queues a trial, and uploads once enough have gathered. */
  log(trial: TrialCreate): void {
    if (this.ended) return;
    this.pending.set(trial.trial_no, trial);
    const index = this.logged.findIndex((entry) => entry.trialNo === trial.trial_no);
    const entry = {
      trialNo: trial.trial_no,
      params: trial.params,
      outcome: trial.outcome,
      metrics: trial.metrics,
    };
    if (index >= 0) this.logged[index] = entry;
    else this.logged.push(entry);
    this.sinceUpload++;
    if (this.sinceUpload >= this.uploadEvery) {
      this.sinceUpload = 0;
      void this.flush();
    }
  }

  /** Uploads every pending trial. Resolves to true when none are left. */
  flush(): Promise<boolean> {
    return this.enqueue(() => this.uploadPending());
  }

  /**
   * Uploads what is left, then ends the run. Resolves to true if everything was saved. After a
   * failure, call it again to retry: the trials are still in memory.
   */
  end(payload: GameRunEnd): Promise<boolean> {
    this.ended = true;
    return this.enqueue(async () => {
      // An ended run refuses trials, so it may only end once every trial is on the server.
      if (!(await this.uploadPending()) || this.runId === null) return false;
      if (this.runEnded) return true;
      const runId = this.runId;
      const ok = await this.attempt(() => this.http.post<GameRun>(`/games/${runId}/end`, payload));
      if (ok === null) return false;
      this.runEnded = true;
      return true;
    });
  }

  private enqueue(task: () => Promise<boolean>): Promise<boolean> {
    const result = this.queue.then(async () => {
      this.running++;
      this.updateStatus();
      try {
        const ok = await task();
        this.lastFailed = !ok;
        return ok;
      } finally {
        this.running--;
        this.updateStatus();
      }
    });
    // A failure must not stop later requests.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async ensureRun(): Promise<boolean> {
    if (this.runId !== null) return true;
    const response = await this.attempt(() =>
      this.http.post<GameRun>(
        `/sessions/${this.sessionId}/games`,
        typeof this.runStart === "function" ? this.runStart() : this.runStart,
      ),
    );
    if (response === null) return false;
    this.runId = response.data.id;
    return true;
  }

  private async uploadPending(): Promise<boolean> {
    if (this.pending.size === 0) return this.ensureRun();
    if (!(await this.ensureRun())) return false;
    const runId = this.runId as number;
    const trials = [...this.pending.values()].sort((a, b) => a.trial_no - b.trial_no);
    for (let start = 0; start < trials.length; start += MAX_BATCH) {
      const batch = trials.slice(start, start + MAX_BATCH);
      const response = await this.attempt(() => this.http.post(`/games/${runId}/trials`, batch));
      if (response === null) return false;
      // A trial logged again during the upload is newer than the one sent, so keep it.
      for (const trial of batch) {
        if (this.pending.get(trial.trial_no) === trial) this.pending.delete(trial.trial_no);
      }
    }
    return this.pending.size === 0;
  }

  /** The request's response, or null once every retry has failed. */
  private async attempt<T>(request: () => Promise<T>): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (attempt >= this.retries || !isWorthRetrying(error)) return null;
        await this.sleep(this.retryDelay(attempt));
      }
    }
  }

  private updateStatus(): void {
    let next: SaveStatus;
    if (this.running > 0) next = "saving";
    else if (this.lastFailed) next = "unsaved";
    else next = this.runId === null ? "idle" : "saved";
    if (next === this.currentStatus) return;
    this.currentStatus = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
