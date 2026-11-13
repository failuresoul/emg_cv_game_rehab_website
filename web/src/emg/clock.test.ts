import { describe, expect, it } from "vitest";

import { SampleClock } from "./clock";

/** A seeded random number generator, so the bursts are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("sample times from the counter", () => {
  it("spaces bursty arrivals evenly, within 1 ms of the true sampling times", () => {
    const fs = 500;
    const clock = new SampleClock(fs);
    const random = seeded(7);
    const startMs = 1000;
    const minimumDelay = 3; // the fastest a sample ever arrives
    const times: number[] = [];
    const truth: number[] = [];
    // USB delivers about every 16 ms; each burst arrives 3-12 ms after its last sample.
    let counter = 0;
    while (counter < fs * 6) {
      const burst = 4 + Math.floor(random() * 8);
      const last = counter + burst - 1;
      const arrival = startMs + (last * 1000) / fs + minimumDelay + random() * 9;
      for (; counter <= last; counter += 1) {
        const t = clock.push(counter, arrival);
        expect(t).not.toBeNull();
        times.push(t!);
        truth.push(startMs + (counter * 1000) / fs);
      }
    }
    // After the first second (whose offset comes from the very first, delayed sample) the offset
    // is the least delayed sample's.
    for (let index = Math.round(fs * 1.2); index < times.length; index += 1) {
      expect(Math.abs(times[index]! - times[index - 1]! - 2)).toBeLessThan(1);
      expect(Math.abs(times[index]! - truth[index]! - minimumDelay)).toBeLessThan(1);
    }
    expect(clock.stats().measuredHz).toBeCloseTo(500, -1);
  });

  it("keeps exactly 1/fs between samples within a second", () => {
    const clock = new SampleClock(500);
    const first = clock.push(0, 50)!;
    const later = [1, 2, 3].map((counter) => clock.push(counter, 60)!);
    expect(later.map((t) => t - first)).toEqual([2, 4, 6]);
  });

  it("counts gaps from the counter and ignores duplicates", () => {
    const clock = new SampleClock(500);
    for (const counter of [0, 1, 2, 5, 6, 6, 7, 10]) clock.push(counter, counter * 2);
    const stats = clock.stats();
    expect(stats.received).toBe(7);
    expect(stats.missing).toBe(4); // 3, 4, 8, 9
    expect(stats.gapsPct).toBeCloseTo((4 / 11) * 100);
    expect(clock.push(10, 30)).toBeNull();
  });

  it("starts a new time base when the counter goes back (START again)", () => {
    const clock = new SampleClock(500);
    clock.push(0, 0);
    clock.push(1, 2);
    const restarted = clock.push(0, 5000);
    expect(restarted).toBe(5000);
    expect(clock.stats().restarts).toBe(1);
    expect(clock.stats().missing).toBe(0);
  });
});
