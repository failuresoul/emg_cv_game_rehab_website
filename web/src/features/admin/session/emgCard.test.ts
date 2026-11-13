import { describe, expect, it } from "vitest";

import { dotState } from "@/features/emg/EmgStatusDot";
import type { GameRunDetail, TrialRead } from "@/types/api";

import { emgRunTraces, readinessRows, tracePath, traceX } from "./emgCard";

const METRICS = {
  peak_mvc: 60,
  mean_mvc_active: 50,
  onset_latency_ms: 300,
  relaxation_ms: 200,
  onset_ms: 1000,
  offset_ms: 3000,
  time_in_band_pct: null,
  steadiness: null,
};

function run(gameId: GameRunDetail["game_id"], trials: Partial<TrialRead>[]): GameRunDetail {
  return { id: trials.length + 1, game_id: gameId, trials } as unknown as GameRunDetail;
}

describe("readinessRows", () => {
  it("lists the known checks in order, with pass or not", () => {
    const rows = readinessRows({
      contact: { pass: false, value: "flat" },
      connected: { pass: true, value: null },
      mystery: { pass: true },
    });
    expect(rows.map((row) => row.id)).toEqual(["connected", "contact"]);
    expect(rows[0]?.labelKey).toBe("emgCheck.connected");
    expect(rows[1]?.pass).toBe(false);
  });
});

describe("emgRunTraces", () => {
  it("keeps EMG games' trials that saved a trace", () => {
    const runs = emgRunTraces([
      run("grip_hold", [
        { trial_no: 1, emg: { site: "flexors", trace: [[0, 1]], metrics: METRICS } },
        { trial_no: 2, emg: null },
      ]),
      run("balloon_pop", [{ trial_no: 1 }]),
      run("bloom", [{ trial_no: 1 }]),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.gameId).toBe("grip_hold");
    expect(runs[0]?.trials.map((trial) => trial.trialNo)).toEqual([1]);
  });
});

describe("trace drawing", () => {
  it("draws %MVC 0 at the bottom and 120 at the top", () => {
    expect(
      tracePath(
        [
          [0, 0],
          [1000, 120],
        ],
        100,
        60,
      ),
    ).toBe("M0.0,60.0 L100.0,0.0");
    expect(tracePath([], 100, 60)).toBe("");
  });

  it("places onset and offset marks on the time axis", () => {
    const trace: [number, number][] = [
      [0, 0],
      [4000, 0],
    ];
    expect(traceX(trace, 1000, 200)).toBe(50);
    expect(traceX(trace, null, 200)).toBeNull();
    expect(traceX(trace, 9000, 200)).toBe(200);
  });
});

describe("dotState with the muscle sensor", () => {
  it("is amber when an electrode is off or samples are lost", () => {
    const streaming = { connected: true, streaming: true, error: null };
    expect(dotState(streaming)).toBe("on");
    expect(dotState({ ...streaming, electrodeOff: true })).toBe("paused");
    expect(dotState({ ...streaming, gapsPct: 2 })).toBe("paused");
    expect(dotState({ ...streaming, gapsPct: 0.5 })).toBe("on");
  });
});
