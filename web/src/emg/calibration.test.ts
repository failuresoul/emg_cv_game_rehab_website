import { describe, expect, it } from "vitest";

import {
  attemptSpread,
  combineAttempts,
  downsample,
  evaluateAttempt,
  highestWindowMean,
  mvcStrongEnough,
  needsExtraAttempt,
  restResult,
  thresholdMv,
} from "./calibration";

describe("the rest level", () => {
  it("is the mean and SD of the relaxed envelope", () => {
    const envelope = Array.from({ length: 5000 }, (_, index) => 200 + (index % 2 === 0 ? 10 : -10));
    expect(restResult(envelope)).toEqual({ mean: 200, sd: 10, problem: null });
  });

  it("must be repeated for a flat line (electrode off) or an arm that was not still", () => {
    expect(restResult(Array(5000).fill(150)).problem).toBe("electrodeOff");
    const moving = Array.from({ length: 5000 }, (_, index) => 200 + (index % 2 === 0 ? 60 : -60));
    expect(restResult(moving).problem).toBe("unstable");
    const tense = Array.from({ length: 5000 }, (_, index) => 900 + (index % 2 === 0 ? 10 : -10));
    expect(restResult(tense).problem).toBe("unstable");
  });
});

describe("one maximum effort", () => {
  it("counts its highest 0.5 s mean, not a single spike", () => {
    // 3 s at 500 Hz: a 1 s plateau at 1500 with one spike of 3000... below saturation it is 2900.
    const envelope: number[] = Array.from({ length: 1500 }, (_, index) =>
      index >= 500 && index < 1000 ? 1500 : 200,
    );
    envelope[700] = 2900;
    const peak = highestWindowMean(envelope, 500);
    expect(peak).toBeCloseTo(1500 + 1400 / 250);
    expect(highestWindowMean([100, 200, 300], 500)).toBe(200); // shorter than 0.5 s
    expect(highestWindowMean([], 500)).toBe(0);
  });

  it("is repeated when any raw sample saturated", () => {
    const envelope = Array(1500).fill(1500);
    expect(evaluateAttempt(Array(1500).fill(1500), envelope, 500)).toEqual({
      peakMv: 1500,
      saturated: false,
    });
    const raw = Array(1500).fill(1500);
    raw[900] = 3050;
    expect(evaluateAttempt(raw, envelope, 500).saturated).toBe(true);
  });
});

describe("the MVC from the attempts", () => {
  it("averages three attempts within 15%", () => {
    const result = combineAttempts([1500, 1600, 1550]);
    expect(result.mvc).toBeCloseTo(1550);
    expect(result.spread).toBeCloseTo(100 / 1600);
    expect(result.consistent).toBe(true);
    expect(needsExtraAttempt([1500, 1600, 1550], false)).toBe(false);
  });

  it("asks for one extra attempt when they differ by more, then uses the three closest", () => {
    expect(attemptSpread([1000, 1600, 1550])).toBeCloseTo(600 / 1600);
    expect(needsExtraAttempt([1000, 1600, 1550], false)).toBe(true);
    expect(needsExtraAttempt([1000, 1600, 1550], true)).toBe(false); // only once
    expect(needsExtraAttempt([1000, 1600], false)).toBe(false); // not before three
    const result = combineAttempts([1000, 1600, 1550, 1580]);
    expect(result.used.sort()).toEqual([1550, 1580, 1600]);
    expect(result.mvc).toBeCloseTo(1576.67, 1);
    expect(result.consistent).toBe(true);
    // Still apart after the extra one: used, but not consistent.
    expect(combineAttempts([800, 1600, 1200, 400]).consistent).toBe(false);
  });

  it("must be at least 3 x the rest mean", () => {
    expect(mvcStrongEnough(600, 200)).toBe(true);
    expect(mvcStrongEnough(599, 200)).toBe(false);
  });

  it("gives the threshold as the server computes it", () => {
    expect(thresholdMv({ mean: 210, sd: 8 })).toBe(234);
  });

  it("shortens a trace for the summary plot", () => {
    const trace = downsample(
      Array.from({ length: 1500 }, (_, index) => index),
      60,
    );
    expect(trace).toHaveLength(60);
    expect(trace[0]).toBe(0);
    expect(trace.at(-1)).toBe(1499);
    expect(downsample([1, 2, 3], 60)).toEqual([1, 2, 3]);
  });
});
