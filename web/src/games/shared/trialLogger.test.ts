import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";

import type { GameRunStart, TrialCreate } from "@/types/api";

import { type HttpClient, retryDelayMs, type SaveStatus, TrialLogger } from "./trialLogger";

const RUN: GameRunStart = {
  game_id: "reach_activate",
  engine: "L0",
  input_source: "keyboard",
  params_initial: { distance_frac: 0.7 },
  trials_planned: 25,
};
const END = { status: "completed" as const, score: 300, summary: null };

function trial(trialNo: number, outcome: TrialCreate["outcome"] = "success"): TrialCreate {
  return {
    trial_no: trialNo,
    params: { distance_frac: 0.7 },
    target: null,
    outcome,
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: null,
      activation_done: null,
      end: 1000,
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: null,
      activation_latency_ms: null,
      activation_peak: null,
    },
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: [],
  };
}

const httpError = (status?: number) =>
  status === undefined
    ? new AxiosError("Network Error", "ERR_NETWORK")
    : new AxiosError(`Status ${status}`, "ERR_BAD_RESPONSE", undefined, undefined, {
        status,
      } as AxiosResponse);

/**
 * A mocked axios: answers each URL like the server, unless `fail` says to throw for that call.
 * Every call is recorded with its URL and body.
 */
function mockApi(fail: (url: string, call: number) => unknown = () => null) {
  let call = 0;
  const post = vi.fn(async (url: string, data?: unknown) => {
    call++;
    const error = fail(url, call);
    if (error) throw error;
    if (url.endsWith("/games")) return { data: { id: 77 } };
    return { data: { url, data } };
  });
  const http: HttpClient = { post: post as HttpClient["post"] };
  const urls = () => post.mock.calls.map(([url]) => url);
  const trialBatches = () =>
    post.mock.calls
      .filter(([url]) => url.endsWith("/trials"))
      .map(([, data]) => (data as TrialCreate[]).map((item) => item.trial_no));
  return { http, post, urls, trialBatches };
}

function createLogger(
  http: HttpClient,
  changes: Partial<ConstructorParameters<typeof TrialLogger>[0]> = {},
) {
  const delays: number[] = [];
  const logger = new TrialLogger({
    http,
    sessionId: 5,
    run: RUN,
    sleep: async (ms) => {
      delays.push(ms);
    },
    ...changes,
  });
  const statuses: SaveStatus[] = [];
  logger.subscribe((status) => statuses.push(status));
  return { logger, delays, statuses };
}

/** Lets queued uploads finish. */
const settle = async (logger: TrialLogger) => {
  await logger.flush();
};

describe("TrialLogger", () => {
  it("starts the run in the session", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    expect(await logger.start()).toBe(true);
    expect(api.post).toHaveBeenCalledWith("/sessions/5/games", RUN);
    expect(logger.gameRunId).toBe(77);
  });

  it("reads the run's details when it starts, if given a function", async () => {
    const api = mockApi();
    let source: GameRunStart["input_source"] = "cv_grip";
    const { logger } = createLogger(api.http, { run: () => ({ ...RUN, input_source: source }) });
    source = "keyboard";
    await logger.start();
    expect(api.post).toHaveBeenCalledWith("/sessions/5/games", {
      ...RUN,
      input_source: "keyboard",
    });
  });

  it("uploads after every 10 trials and not before", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    await logger.start();
    for (let n = 1; n <= 9; n++) logger.log(trial(n));
    await Promise.resolve();
    expect(api.trialBatches()).toEqual([]);

    logger.log(trial(10));
    await settle(logger);
    expect(api.trialBatches()).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
    expect(logger.pendingCount).toBe(0);

    for (let n = 11; n <= 20; n++) logger.log(trial(n));
    await settle(logger);
    expect(api.trialBatches()).toHaveLength(2);
    expect(api.trialBatches()[1]).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("uploads the rest at the end, then ends the run", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    await logger.start();
    for (let n = 1; n <= 10; n++) logger.log(trial(n));
    await settle(logger);
    for (let n = 11; n <= 13; n++) logger.log(trial(n));
    expect(await logger.end(END)).toBe(true);
    expect(api.trialBatches()).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [11, 12, 13],
    ]);
    expect(api.urls().at(-1)).toBe("/games/77/end");
    expect(api.post).toHaveBeenLastCalledWith("/games/77/end", END);
    expect(logger.pendingCount).toBe(0);
  });

  it("starts the run itself if a trial arrives first", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    logger.log(trial(1));
    expect(await logger.end(END)).toBe(true);
    expect(api.urls()).toEqual(["/sessions/5/games", "/games/77/trials", "/games/77/end"]);
  });

  it("splits more than 50 waiting trials into requests of 50", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http, { uploadEvery: 1000 });
    for (let n = 1; n <= 120; n++) logger.log(trial(n));
    await logger.end(END);
    expect(api.trialBatches().map((batch) => batch.length)).toEqual([50, 50, 20]);
  });

  it("sends a trial logged twice only once, with its latest version", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    logger.log(trial(1, "reach_fail"));
    logger.log(trial(1, "success"));
    await logger.end(END);
    const sent = api.post.mock.calls.find(([url]) => url.endsWith("/trials"))?.[1] as TrialCreate[];
    expect(sent).toHaveLength(1);
    expect(sent[0].outcome).toBe("success");
    expect(logger.history).toHaveLength(1);
  });

  it("retries a failed upload three times, waiting 1, 2 and 4 seconds", async () => {
    let trialCalls = 0;
    const api = mockApi((url) =>
      url.endsWith("/trials") && ++trialCalls <= 3 ? httpError(503) : null,
    );
    const { logger, delays } = createLogger(api.http);
    for (let n = 1; n <= 10; n++) logger.log(trial(n));
    expect(await logger.flush()).toBe(true);
    expect(trialCalls).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(delays).toEqual([0, 1, 2].map(retryDelayMs));
    expect(logger.pendingCount).toBe(0);
  });

  it("keeps the trials after every retry fails, and sends them with the next upload", async () => {
    let failing = true;
    const api = mockApi((url) => (failing && url.endsWith("/trials") ? httpError() : null));
    const { logger, statuses } = createLogger(api.http, { uploadEvery: 1000 });
    for (let n = 1; n <= 10; n++) logger.log(trial(n));
    expect(await logger.flush()).toBe(false);
    expect(api.trialBatches()).toHaveLength(4); // One attempt and three retries.
    expect(logger.pendingCount).toBe(10);
    expect(logger.status).toBe("unsaved");
    expect(statuses).toContain("saving");

    failing = false;
    logger.log(trial(11));
    expect(await logger.end(END)).toBe(true);
    expect(api.trialBatches().at(-1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(logger.pendingCount).toBe(0);
    expect(logger.status).toBe("saved");
  });

  it("does not end the run while trials are unsent, and can be asked again", async () => {
    let failing = true;
    const api = mockApi((url) => (failing && url.endsWith("/trials") ? httpError(500) : null));
    const { logger } = createLogger(api.http);
    logger.log(trial(1));
    expect(await logger.end(END)).toBe(false);
    expect(api.urls()).not.toContain("/games/77/end");

    failing = false;
    expect(await logger.end(END)).toBe(true);
    expect(api.urls().filter((url) => url.endsWith("/end"))).toHaveLength(1);
  });

  it("does not retry an answer that will not change, such as 422", async () => {
    const api = mockApi((url) => (url.endsWith("/trials") ? httpError(422) : null));
    const { logger, delays } = createLogger(api.http);
    logger.log(trial(1));
    expect(await logger.flush()).toBe(false);
    expect(api.trialBatches()).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("retries starting the run, and keeps trials if it never starts", async () => {
    const api = mockApi((url) => (url.endsWith("/games") ? httpError() : null));
    const { logger, delays } = createLogger(api.http);
    expect(await logger.start()).toBe(false);
    expect(delays).toHaveLength(3);
    logger.log(trial(1));
    expect(await logger.end(END)).toBe(false);
    expect(logger.pendingCount).toBe(1);
  });

  it("ignores trials logged after the end", async () => {
    const api = mockApi();
    const { logger } = createLogger(api.http);
    await logger.end(END);
    logger.log(trial(1));
    expect(logger.pendingCount).toBe(0);
  });

  it("reports saving while a request runs, then saved", async () => {
    const api = mockApi();
    const { logger, statuses } = createLogger(api.http);
    await logger.start();
    expect(statuses).toEqual(["saving", "saved"]);
  });
});
