import { describe, expect, it } from "vitest";

import { generateFrames, SYNTH_FRAME_HEIGHT, SYNTH_FRAME_WIDTH } from "@/testing/synthLandmarks";

import { AngleSampler, anglesCsv, loadRows, saveRows, type AngleRow } from "./angleSamples";
import { LatencyLog, summarise } from "./latency";

function frameInput(steps: Record<string, unknown>[], side: "left" | "right" = "left") {
  const frame = generateFrames({ affectedSide: side, jitterM: 0, steps: steps as never }).at(-1)!;
  return {
    pose: frame.pose,
    poseWorld: frame.poseWorld,
    frameWidth: SYNTH_FRAME_WIDTH,
    frameHeight: SYNTH_FRAME_HEIGHT,
  };
}

describe("angle validation samples", () => {
  it("gives elbow flexion in the clinical convention (0 straight)", () => {
    const sampler = new AngleSampler("elbow", "left");
    sampler.add(
      frameInput([
        { do: "arm", angles: { elevationDeg: 5, planeDeg: 90, elbowDeg: 120 }, ms: 300 },
      ]),
    );
    const { mp3d_deg, mp2d_deg, visibility } = sampler.mean();
    expect(mp3d_deg).toBeCloseTo(60, 0);
    expect(mp2d_deg).not.toBeNull();
    expect(visibility).toBeGreaterThan(0.9);
  });

  it("gives shoulder flexion and abduction as the arm's angle from hanging down", () => {
    const flexion = new AngleSampler("shoulder_flexion", "right");
    flexion.add(frameInput([{ do: "raise", plane: "forward", deg: 80, ms: 300 }], "right"));
    expect(flexion.mean().mp3d_deg).toBeCloseTo(80, 0);
    const abduction = new AngleSampler("shoulder_abduction", "right");
    abduction.add(frameInput([{ do: "raise", plane: "sideways", deg: 70, ms: 300 }], "right"));
    expect(abduction.mean().mp3d_deg).toBeCloseTo(70, 0);
    // In the image's plane, a sideways raise reads about right in 2D too.
    expect(Math.abs((abduction.mean().mp2d_deg ?? 0) - 70)).toBeLessThan(10);
  });

  it("averages every frame added and has nothing before the first", () => {
    const sampler = new AngleSampler("shoulder_flexion", "left");
    expect(sampler.mean()).toEqual({ mp3d_deg: null, mp2d_deg: null, visibility: null });
    sampler.add(frameInput([{ do: "raise", plane: "forward", deg: 40, ms: 300 }]));
    sampler.add(frameInput([{ do: "raise", plane: "forward", deg: 60, ms: 300 }]));
    expect(sampler.frames).toBe(2);
    expect(sampler.mean().mp3d_deg).toBeCloseTo(50, 0);
  });

  it("writes the CSV run_validation.py reads, and keeps rows in storage", () => {
    const rows: AngleRow[] = [
      {
        id: "a",
        joint: "elbow",
        reference_deg: 90,
        mp3d_deg: 87.5,
        mp2d_deg: null,
        visibility: 0.98,
        timestamp: "2026-11-17T10:00:00.000Z",
      },
    ];
    expect(anglesCsv(rows)).toBe(
      "joint,reference_deg,mp3d_deg,mp2d_deg,visibility,timestamp\nelbow,90,87.5,,0.98,2026-11-17T10:00:00.000Z\n",
    );
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    saveRows(storage, rows);
    expect(loadRows(storage)).toEqual(rows);
    expect(loadRows({ getItem: () => "not json" })).toEqual([]);
    expect(loadRows(null)).toEqual([]);
  });
});

describe("latency log", () => {
  it("times each stage per frame and summarises mean and p95", () => {
    const log = new LatencyLog();
    for (let i = 0; i < 20; i++) {
      const t = 1000 + i * 33;
      log.add({
        timestamp: t,
        detectedAt: t + 20 + (i % 5),
        renderedAt: t + 30 + (i % 5),
        above: i >= 10,
        fps: 30,
      });
    }
    const summary = log.summary();
    expect(summary.detect.n).toBe(20);
    expect(summary.detect.mean).toBeCloseTo(22, 5);
    expect(summary.render.mean).toBeCloseTo(10, 5);
    expect(summary.total.p95).toBeCloseTo(34, 5);
    const csv = log.toCsv().trim().split("\n");
    expect(csv[0]).toBe("frame,t_ms,detect_ms,render_ms,total_ms,above,fps");
    expect(csv).toHaveLength(21);
    expect(csv[1]).toBe("1,0,20,10,30,0,30");
    expect(csv[20].split(",")[5]).toBe("1");
  });

  it("stops at its limit, clears, and summarises nothing as NaN", () => {
    const log = new LatencyLog(3);
    for (let i = 0; i < 5; i++)
      log.add({ timestamp: i, detectedAt: i + 1, renderedAt: i + 2, above: false, fps: 30 });
    expect(log.length).toBe(3);
    log.clear();
    expect(log.length).toBe(0);
    expect(summarise([]).mean).toBeNaN();
    expect(summarise([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).p95).toBeCloseTo(9.55, 5);
  });
});
