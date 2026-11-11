import { afterEach, describe, expect, it, vi } from "vitest";

import { GAMES } from "@/games/shared/registry";
import type { EngineNextResponse, GameId } from "@/types/api";

import { type EngineEvent, type EngineRequest, RemoteProvider } from "./remoteProvider";
import { record } from "./testRecords";

const ADAPTABLE: Record<string, string[]> = {
  reach_activate: ["distance_frac", "target_radius_sw", "dwell_ms", "activation_demand"],
  finger_piano: ["sequence_length", "note_interval_ms", "hit_window_ms", "touch_threshold"],
};

function answer(params: Record<string, number>, changes: Partial<EngineNextResponse> = {}) {
  return {
    params,
    level: 4,
    cue: null,
    decision: "Start of the game.",
    safety_override: null,
    engine: "L1",
    ...changes,
  } satisfies EngineNextResponse;
}

function provider(request: EngineRequest, personal: Record<string, number> = {}) {
  return new RemoteProvider({
    engine: "L1",
    specsFor: (id) => GAMES[id].params,
    seed: 3,
    defaultsFor: () => personal,
    adaptableFor: (id: GameId) => ADAPTABLE[id] ?? [],
    request,
    timeoutMs: 300,
  });
}

/** A request that answers when the test says. */
function controlled() {
  const pending: { body: unknown; resolve: (value: EngineNextResponse) => void }[] = [];
  const request: EngineRequest = (body) =>
    new Promise((resolve) => pending.push({ body, resolve }));
  return { request, pending };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RemoteProvider", () => {
  it("uses the admin's defaults until the server answers, then the server's difficulty", async () => {
    const { request, pending } = controlled();
    const remote = provider(request);
    expect(remote.engine).toBe("L1");
    expect(remote.nextParams("reach_activate", [], 1).distance_frac).toBe(0.7);

    const started = remote.start(42, "reach_activate");
    expect(pending[0].body).toEqual({ run_id: 42, last_trial: null });
    pending[0].resolve(answer({ distance_frac: 0.85, target_radius_sw: 0.3, rest_ms: 99999 }));
    await started;

    const params = remote.nextParams("reach_activate", [], 1);
    expect(params.distance_frac).toBe(0.85);
    expect(params.target_radius_sw).toBe(0.3);
    // Only adaptable settings are taken from the server; the reach direction still rotates.
    expect(params.rest_ms).toBe(1500);
    expect(Number.isFinite(params.direction_deg)).toBe(true);
    expect(remote.level).toBe(4);
  });

  it("sends a compact summary of each trial", async () => {
    const { request, pending } = controlled();
    const remote = provider(request);
    void remote.start(7, "reach_activate");
    pending[0].resolve(answer({}));
    await Promise.resolve();
    remote.report("reach_activate", record("reach_fail", { movement_ms: 900 }, {}, 1));
    expect(pending[1].body).toEqual({
      run_id: 7,
      last_trial: {
        trial_no: 1,
        outcome: "reach_fail",
        failure_type: "reach_fail",
        compensated: false,
        movement_ms: 900,
        completion_ms: null,
        activation_peak: null,
      },
    });
  });

  it("keeps the previous settings after 300 ms without an answer, never blocking", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { request, pending } = controlled();
    const remote = provider(request);
    const started = remote.start(1, "reach_activate");
    pending[0].resolve(answer({ distance_frac: 0.6 }));
    await started;

    remote.report("reach_activate", record("success", {}, {}, 1));
    // The game asks at once: the last known settings, no waiting.
    expect(remote.nextParams("reach_activate", [], 2).distance_frac).toBe(0.6);
    await vi.advanceTimersByTimeAsync(301);
    expect(remote.fallbacks).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    // A late answer for that trial is not applied after it timed out.
    pending[1].resolve(answer({ distance_frac: 1.0 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(remote.nextParams("reach_activate", [], 2).distance_frac).toBe(0.6);
  });

  it("counts a failed request as a fallback too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = provider(() => Promise.reject(new Error("offline")));
    await remote.start(1, "reach_activate");
    expect(remote.fallbacks).toBe(1);
    expect(remote.nextParams("reach_activate", [], 1).distance_frac).toBe(0.7);
  });

  it("never lets an older answer replace a newer one", async () => {
    const { request, pending } = controlled();
    const remote = provider(request);
    void remote.start(1, "reach_activate");
    pending[0].resolve(answer({ distance_frac: 0.5 }));
    await Promise.resolve();
    remote.report("reach_activate", record("success", {}, {}, 1));
    remote.report("reach_activate", record("success", {}, {}, 2));
    pending[2].resolve(answer({ distance_frac: 0.9 }));
    await Promise.resolve();
    await Promise.resolve();
    pending[1].resolve(answer({ distance_frac: 0.4 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(remote.nextParams("reach_activate", [], 3).distance_frac).toBe(0.9);
  });

  it("ignores a late answer from an earlier run and starts the next run fresh", async () => {
    const { request, pending } = controlled();
    const remote = provider(request);
    void remote.start(1, "reach_activate");
    pending[0].resolve(answer({ distance_frac: 0.5 }));
    await Promise.resolve();
    await Promise.resolve();
    for (let n = 1; n <= 5; n++) remote.report("reach_activate", record("success", {}, {}, n));
    // A second run before the first run's last answers arrive.
    const second = remote.start(2, "reach_activate");
    expect(pending[6].body).toEqual({ run_id: 2, last_trial: null });
    pending[5].resolve(answer({ distance_frac: 0.95 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(remote.nextParams("reach_activate", [], 1).distance_frac).toBe(0.5);
    pending[6].resolve(answer({ distance_frac: 0.6 }, { level: 3 }));
    await second;
    expect(remote.nextParams("reach_activate", [], 1).distance_frac).toBe(0.6);
    expect(remote.level).toBe(3);
  });

  it("does nothing before the run has started", () => {
    const { request, pending } = controlled();
    provider(request).report("reach_activate", record("success"));
    expect(pending).toHaveLength(0);
  });

  it("keeps the patient's own warm-up values and builds the melody on the server's length", async () => {
    const { request, pending } = controlled();
    const remote = provider(request, { touch_threshold: 0.36 });
    const started = remote.start(1, "finger_piano");
    pending[0].resolve(answer({ sequence_length: 6, touch_threshold: 0.2 }));
    await started;
    const params = remote.nextParams("finger_piano", [], 1);
    expect(params.touch_threshold).toBe(0.36);
    expect(params.sequence_length).toBe(6);
    const notes = Object.keys(params).filter((name) => /^note_\d+$/.test(name));
    expect(notes).toHaveLength(6);
  });

  it("tells listeners the level and any cue", async () => {
    const { request, pending } = controlled();
    const remote = provider(request);
    const events: EngineEvent[] = [];
    const unsubscribe = remote.subscribe((event) => events.push(event));
    const started = remote.start(1, "reach_activate");
    pending[0].resolve(answer({}, { level: 3 }));
    await started;
    remote.report("reach_activate", record("miss", {}, {}, 1));
    pending[1].resolve(answer({}, { level: 2, cue: "encourage" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([
      { type: "level", level: 3, previous: null },
      { type: "level", level: 2, previous: 3 },
      { type: "cue", cue: "encourage" },
    ]);
    unsubscribe();
  });
});
