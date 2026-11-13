import { describe, expect, it } from "vitest";

import type { TrialTimings } from "@/types/api";

import {
  buildTrialEmg,
  capTrace,
  emgCuesFor,
  type EmgTracePoint,
  EmgTraceRecorder,
  emgTrialMetrics,
  MAX_EMG_TRACE_POINTS,
  thresholdPercent,
} from "./trialEmg";

const TIMINGS: TrialTimings = {
  spawn: 0,
  move_onset: null,
  enter: null,
  dwell_done: null,
  activation_start: null,
  activation_done: null,
  end: null,
};

/** A synthetic 50 Hz trace from a function of time (ms). */
function trace(durationMs: number, at: (t: number) => number): EmgTracePoint[] {
  const out: EmgTracePoint[] = [];
  for (let t = 0; t <= durationMs; t += 20) out.push([t, at(t)]);
  return out;
}

describe("EmgTraceRecorder", () => {
  it("keeps at most one sample every 20 ms (50 Hz) and slices a trial", () => {
    const recorder = new EmgTraceRecorder();
    for (let t = 1000; t < 2000; t += 2) recorder.add(t, 40);
    expect(recorder.size).toBe(50);
    const slice = recorder.slice(1500, 1600);
    expect(slice[0]).toEqual([0, 40]);
    expect(slice.at(-1)?.[0]).toBeLessThanOrEqual(100);
    expect(slice.length).toBe(6);
  });

  it("clamps %MVC to 0-120 and forgets samples older than a minute", () => {
    const recorder = new EmgTraceRecorder();
    recorder.add(0, 150);
    recorder.add(20, -3);
    expect(recorder.slice(0, 20)).toEqual([
      [0, 120],
      [20, 0],
    ]);
    recorder.add(61_000, 10);
    expect(recorder.slice(0, 100)).toEqual([]);
    expect(recorder.size).toBe(1);
  });
});

describe("capTrace", () => {
  it("leaves a short trace alone", () => {
    const short = trace(1000, () => 5);
    expect(capTrace(short)).toEqual(short);
  });

  it("caps a long trace at 1500 points, keeping the first and last", () => {
    const long = trace(60_000, (t) => t / 1000);
    expect(long.length).toBeGreaterThan(MAX_EMG_TRACE_POINTS);
    const capped = capTrace(long);
    expect(capped.length).toBe(MAX_EMG_TRACE_POINTS);
    expect(capped[0]).toEqual(long[0]);
    expect(capped.at(-1)).toEqual(long.at(-1));
  });
});

describe("thresholdPercent", () => {
  it("is 3 rest SDs on the rest-to-MVC scale", () => {
    expect(thresholdPercent({ restMean: 100, restSd: 10, mvc: 1100 })).toBeCloseTo(3, 6);
    expect(thresholdPercent({ restMean: 100, restSd: 10, mvc: 100 })).toBe(0);
  });
});

describe("emgCuesFor", () => {
  it("reach_activate: cue at the dwell, release once activated", () => {
    const cues = emgCuesFor(
      "reach_activate",
      { ...TIMINGS, dwell_done: 1200, activation_done: 1900 },
      null,
    );
    expect(cues).toEqual({ cue: 1200, release: 1900, hold: null, band: null });
  });

  it("grip_hold: cue at the start, the hold window and the band in %MVC", () => {
    const cues = emgCuesFor(
      "grip_hold",
      { ...TIMINGS, activation_start: 800, activation_done: 3800 },
      { kind: "grip_band", center: 0.5, width: 0.2 },
    );
    expect(cues.cue).toBe(0);
    expect(cues.release).toBe(3800);
    expect(cues.hold).toEqual({ from: 800, to: 3800 });
    expect(cues.band?.low).toBeCloseTo(40, 6);
    expect(cues.band?.high).toBeCloseTo(60, 6);
  });

  it("bloom: open from the start, release when the close begins", () => {
    expect(emgCuesFor("bloom", { ...TIMINGS, activation_start: 2500 }, null)).toEqual({
      cue: 0,
      release: 2500,
      hold: null,
      band: null,
    });
  });
});

describe("emgTrialMetrics", () => {
  it("finds the onset after the cue and the offset after the release", () => {
    // Rest, contraction 1000-3000 ms at 60 %MVC, rest again.
    const synthetic = trace(4000, (t) => (t >= 1000 && t < 3000 ? 60 : 1));
    const metrics = emgTrialMetrics(
      synthetic,
      { cue: 700, release: 2800, hold: null, band: null },
      5,
    );
    expect(metrics.onset_ms).toBe(1000);
    expect(metrics.onset_latency_ms).toBe(300);
    expect(metrics.offset_ms).toBe(3000);
    expect(metrics.relaxation_ms).toBe(200);
    expect(metrics.peak_mvc).toBe(60);
    expect(metrics.mean_mvc_active).toBe(60);
    expect(metrics.time_in_band_pct).toBeNull();
    expect(metrics.steadiness).toBeNull();
  });

  it("ignores a blip shorter than 50 ms", () => {
    const synthetic = trace(2000, (t) => (t === 400 || (t >= 1000 && t < 1600) ? 50 : 0));
    const metrics = emgTrialMetrics(
      synthetic,
      { cue: 0, release: null, hold: null, band: null },
      5,
    );
    expect(metrics.onset_ms).toBe(1000);
    expect(metrics.relaxation_ms).toBeNull();
  });

  it("has no onset or offset when the muscle never acts", () => {
    const metrics = emgTrialMetrics(
      trace(2000, () => 1),
      { cue: 0, release: 1000, hold: null, band: null },
      5,
    );
    expect(metrics.onset_latency_ms).toBeNull();
    expect(metrics.mean_mvc_active).toBeNull();
    // Relaxed throughout: the offset is right at the release.
    expect(metrics.relaxation_ms).toBe(0);
  });

  it("measures the time in band and the steadiness of a hold", () => {
    // Hold 1000-3000 ms alternating 45 and 55 %MVC (all in a 40-60 band): SD 0.05.
    const synthetic = trace(3500, (t) => {
      if (t < 1000) return 2;
      if (t <= 3000) return (t / 20) % 2 === 0 ? 45 : 55;
      return 2;
    });
    const metrics = emgTrialMetrics(
      synthetic,
      { cue: 0, release: 3000, hold: { from: 1000, to: 3000 }, band: { low: 40, high: 60 } },
      5,
    );
    expect(metrics.time_in_band_pct).toBe(100);
    expect(metrics.steadiness).toBeCloseTo(0.05, 3);
  });

  it("counts the share of the hold outside the band", () => {
    const synthetic = trace(2000, (t) => (t < 1000 ? 50 : 70));
    const metrics = emgTrialMetrics(
      synthetic,
      { cue: 0, release: null, hold: { from: 0, to: 1980 }, band: { low: 40, high: 60 } },
      5,
    );
    expect(metrics.time_in_band_pct).toBe(50);
  });
});

describe("buildTrialEmg", () => {
  it("saves the site, a capped trace and the measures", () => {
    const long = trace(40_000, (t) => (t > 1000 && t < 39_000 ? 50 : 0));
    const record = buildTrialEmg({
      site: "flexors",
      trace: long,
      gameId: "grip_hold",
      timings: { ...TIMINGS, activation_start: 1100, activation_done: 38_000 },
      target: { kind: "grip_band", center: 0.5, width: 0.3 },
      calibration: { restMean: 50, restSd: 5, mvc: 550 },
    });
    expect(record.site).toBe("flexors");
    expect(record.trace.length).toBe(MAX_EMG_TRACE_POINTS);
    expect(record.metrics.peak_mvc).toBe(50);
    expect(record.metrics.time_in_band_pct).toBe(100);
    expect(record.metrics.onset_latency_ms).toBe(1020);
  });
});
