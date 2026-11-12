import type { GameParams } from "@/games/shared/types";
import { api } from "@/lib/api";
import type {
  EngineCue,
  EngineLastTrial,
  EngineNextResponse,
  GameId,
  TrialCreate,
} from "@/types/api";

import { FixedProvider, type FixedProviderOptions, type ParamsProvider } from "./paramsProvider";
import { applyTarget, type EngineTarget, TARGET_GAMES, targetOf } from "./targets";
import { trialSummary } from "./trialSummary";

/** How long the game waits for the server's next settings before keeping the previous ones. */
export const ENGINE_TIMEOUT_MS = 300;

export interface EngineRequestBody {
  run_id: number;
  last_trial: EngineLastTrial | null;
}

export type EngineRequest = (
  body: EngineRequestBody,
  timeoutMs: number,
) => Promise<EngineNextResponse>;

export const postEngineNext: EngineRequest = async (body, timeoutMs) =>
  (await api.post<EngineNextResponse>("/engine/next", body, { timeout: timeoutMs })).data;

export type EngineEvent =
  { type: "level"; level: number; previous: number | null } | { type: "cue"; cue: EngineCue };

export type EngineListener = (event: EngineEvent) => void;

export interface RemoteProviderOptions extends FixedProviderOptions {
  engine: "L1" | "L2";
  /** The settings the server may change for a game: its adaptable ones. */
  adaptableFor: (gameId: GameId) => readonly string[];
  request?: EngineRequest;
  timeoutMs?: number;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`no answer in ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * The server's adaptive engine (L1, L2) behind the same interface as FixedProvider.
 *
 * - **Difficulty:** each trial's difficulty settings come from the server's latest answer.
 * - **Turn-by-turn choices:** the existing rotation still makes them (the reach direction, the
 *   fruit's side, the path's shape, the melody), built on the server's settings.
 * - **Personal values:** a patient's own warm-up values still come first.
 * - **Never blocking:** nextParams() answers at once from what is known. After each trial,
 *   report() asks the server for the next settings in the background. With no answer in 300 ms,
 *   or an error, the previous settings stay and the fallback is counted.
 */
export class RemoteProvider implements ParamsProvider {
  readonly engine: "L1" | "L2";
  private readonly fixed: FixedProvider;
  private readonly adaptableFor: (gameId: GameId) => readonly string[];
  private readonly request: EngineRequest;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<EngineListener>();
  private difficulty: GameParams = {};
  private runId: number | null = null;
  /** The newest trial whose answer was used, so a slow answer never overwrites a newer one. */
  private newestApplied = -1;
  private currentLevel: number | null = null;
  /** Where the engine puts the next target (L2), or null to keep the rotation's choice. */
  private target: EngineTarget | null = null;
  private fallbackCount = 0;

  constructor({
    engine,
    adaptableFor,
    request = postEngineNext,
    timeoutMs = ENGINE_TIMEOUT_MS,
    defaultsFor = () => ({}),
    ...options
  }: RemoteProviderOptions) {
    this.engine = engine;
    this.adaptableFor = adaptableFor;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.fixed = new FixedProvider({
      ...options,
      // The server's difficulty, then the patient's own warm-up values on top.
      defaultsFor: (gameId) => ({ ...this.difficulty, ...defaultsFor(gameId) }),
    });
  }

  /** How many times the previous settings were kept because the server did not answer. */
  get fallbacks(): number {
    return this.fallbackCount;
  }

  get level(): number | null {
    return this.currentLevel;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The run has started: asks for its first settings (eased a little in a new session). */
  start(runId: number, gameId: GameId): Promise<void> {
    this.runId = runId;
    this.newestApplied = -1;
    this.target = null;
    return this.send(gameId, null);
  }

  /** A trial has ended: asks for the next settings in the background. */
  report(gameId: GameId, record: TrialCreate): void {
    if (this.runId === null) return;
    void this.send(gameId, trialSummary(gameId, record));
  }

  nextParams(
    gameId: GameId,
    history: Parameters<FixedProvider["nextParams"]>[1],
    trialNo?: number,
  ) {
    const params = this.fixed.nextParams(gameId, history, trialNo);
    // L2 chooses where the target goes; otherwise the rotation's choice stays.
    return this.target && TARGET_GAMES.has(gameId)
      ? applyTarget(gameId, params, this.target)
      : params;
  }

  /** The target the engine chose for the next trial, if any (L2). */
  get nextTarget(): EngineTarget | null {
    return this.target;
  }

  private async send(gameId: GameId, last: EngineLastTrial | null): Promise<void> {
    const runId = this.runId;
    if (runId === null) return;
    const trialNo = last?.trial_no ?? 0;
    try {
      const response = await withTimeout(
        this.request({ run_id: runId, last_trial: last }, this.timeoutMs),
        this.timeoutMs,
      );
      // An answer for an earlier run, or older than one already used, is ignored.
      if (runId !== this.runId || trialNo < this.newestApplied) return;
      this.newestApplied = trialNo;
      this.apply(gameId, response);
    } catch (error) {
      this.fallbackCount++;
      console.warn(
        `Keeping the previous settings: no engine answer for trial ${trialNo} (${String(error)})`,
      );
    }
  }

  private apply(gameId: GameId, response: EngineNextResponse): void {
    const allowed = new Set(this.adaptableFor(gameId));
    this.difficulty = Object.fromEntries(
      Object.entries(response.params).filter(
        ([name, value]) => allowed.has(name) && Number.isFinite(value),
      ),
    );
    this.target = targetOf(response);
    const previous = this.currentLevel;
    this.currentLevel = response.level;
    this.emit({ type: "level", level: response.level, previous });
    if (response.cue) this.emit({ type: "cue", cue: response.cue });
  }

  private emit(event: EngineEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
