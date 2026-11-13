import { describe, expect, it } from "vitest";

import type { FeedbackJob, FeedbackReportRead, ReportStatus } from "@/types/api";

import {
  type FeedbackClient,
  type FeedbackState,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  runFeedback,
} from "./feedbackJob";

function read(status: ReportStatus, jobId = 7): FeedbackReportRead {
  const finished = status === "done" || status === "fallback";
  return {
    job_id: jobId,
    session_id: 3,
    language: "en",
    status,
    report: finished
      ? {
          language: "en",
          patient_summary: "Well done.",
          highlights: [],
          suggestions: [],
          next_session_text: "More reaching.",
        }
      : null,
    safety_notices: finished ? [] : null,
    meta: null,
    created_at: "2026-11-13T10:00:00Z",
    finished_at: null,
  };
}

/** A fake API: the job answers with each status in turn (the last repeats), and a clock that
 * moves on only when the poller sleeps. */
function setup(statuses: ReportStatus[], start: FeedbackJob = { job_id: 7, status: "queued" }) {
  let clock = 0;
  const calls = { start: [] as unknown[], job: 0, sleeps: [] as number[] };
  const client: FeedbackClient = {
    start: async (sessionId, request) => {
      calls.start.push({ sessionId, ...request });
      return start;
    },
    job: async (jobId) => {
      const status = statuses[Math.min(calls.job, statuses.length - 1)]!;
      calls.job += 1;
      return read(status, jobId);
    },
  };
  const states: FeedbackState[] = [];
  const run = (options: Parameters<typeof runFeedback>[2] = {}) =>
    runFeedback(
      client,
      3,
      {
        now: () => clock,
        sleep: async (ms) => {
          calls.sleeps.push(ms);
          clock += ms;
        },
        ...options,
      },
      (state) => states.push(state),
    );
  return { run, states, calls };
}

describe("runFeedback", () => {
  it("goes from preparing to ready once the report is done", async () => {
    const { run, states, calls } = setup(["queued", "running", "done"]);
    const final = await run();
    expect(states.map((state) => state.status)).toEqual(["preparing", "preparing", "ready"]);
    expect(states[0]).toEqual({ status: "preparing", jobId: null });
    expect(states[1]).toEqual({ status: "preparing", jobId: 7 });
    expect(final.status).toBe("ready");
    expect(final.status === "ready" && final.read.report?.patient_summary).toBe("Well done.");
    expect(calls.job).toBe(3);
    // Polled every 1.5 s.
    expect(calls.sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
  });

  it("ends in fallback for the template report, shown like a ready one", async () => {
    const { run } = setup(["running", "fallback"]);
    const final = await run();
    expect(final.status).toBe("fallback");
    expect(final.status === "fallback" && final.read.report).not.toBeNull();
  });

  it("reuses a report that is already finished without waiting", async () => {
    const { run, calls } = setup(["done"], { job_id: 7, status: "done" });
    expect((await run()).status).toBe("ready");
    expect(calls.sleeps).toEqual([]);
  });

  it("stops with an error after 120 s", async () => {
    const { run, states, calls } = setup(["running"]);
    const final = await run();
    expect(final).toEqual({ status: "error", jobId: 7, reason: "timeout" });
    expect(states.at(-1)).toEqual(final);
    expect(calls.sleeps.length).toBe(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);
  });

  it("reports a failed job and a network error", async () => {
    expect(await setup(["failed"]).run()).toEqual({ status: "error", jobId: 7, reason: "failed" });

    const states: FeedbackState[] = [];
    const broken: FeedbackClient = {
      start: async () => {
        throw new Error("offline");
      },
      job: async () => read("done"),
    };
    const final = await runFeedback(broken, 3, {}, (state) => states.push(state));
    expect(final).toEqual({ status: "error", jobId: null, reason: "network" });
  });

  it("passes the language and regenerate to the request", async () => {
    const { run, calls } = setup(["done"]);
    await run({ language: "bn", regenerate: true });
    expect(calls.start).toEqual([{ sessionId: 3, language: "bn", regenerate: true }]);
  });

  it("stops quietly when aborted", async () => {
    const controller = new AbortController();
    const { run, states } = setup(["running"]);
    const final = await run({
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });
    expect(final).toEqual({ status: "idle" });
    expect(states.map((state) => state.status)).toEqual(["preparing", "preparing"]);
  });
});
