import { describe, expect, it } from "vitest";

import {
  FLAT_SD_MV,
  isFlatLine,
  isSaturated,
  isSaturating,
  MAX_PERCENT_MVC,
  MovingAverage,
  OnsetDetector,
  type OnsetEvent,
  percentMvc,
  RingBuffer,
  SATURATION_MV,
  windowStats,
} from "./processing";

describe("signal checks", () => {
  it("flags saturation near the ADC maximum", () => {
    expect(isSaturated(SATURATION_MV - 1)).toBe(false);
    expect(isSaturated(SATURATION_MV)).toBe(true);
    expect(isSaturating([...Array(500).fill(1800), 3100, 3100, 3100, 3100])).toBe(false);
    expect(isSaturating([...Array(500).fill(1800), ...Array(5).fill(3100)])).toBe(true);
  });

  it("finds a flat line (an electrode off) but not a resting muscle", () => {
    const flat = Array.from({ length: 500 }, (_, index) => 200 + (index % 2));
    expect(windowStats(flat).sd).toBeLessThan(FLAT_SD_MV);
    expect(isFlatLine(flat, 250)).toBe(true);
    const resting = Array.from({ length: 500 }, (_, index) => 200 + ((index * 7) % 15) - 7);
    expect(isFlatLine(resting, 250)).toBe(false);
    // Too little signal yet to say.
    expect(isFlatLine(flat.slice(0, 100), 250)).toBe(false);
  });

  it("gives the mean, SD, peak and minimum of a window", () => {
    expect(windowStats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
      count: 8,
      mean: 5,
      sd: 2,
      peak: 9,
      min: 2,
    });
    expect(windowStats([])).toEqual({ count: 0, mean: 0, sd: 0, peak: 0, min: 0 });
  });
});

describe("smoothing", () => {
  it("averages the last 50 ms (25 samples at 500 Hz)", () => {
    const average = new MovingAverage(500);
    let out = 0;
    for (let index = 0; index < 25; index += 1) out = average.push(100);
    expect(out).toBe(100);
    for (let index = 0; index < 5; index += 1) out = average.push(600);
    expect(out).toBe(200); // (20 x 100 + 5 x 600) / 25
    for (let index = 0; index < 25; index += 1) out = average.push(600);
    expect(out).toBe(600);
    average.reset();
    expect(average.push(50)).toBe(50);
  });
});

describe("%MVC", () => {
  const calibration = { restMean: 200, restSd: 10, mvc: 1800 };

  it("scales between rest and MVC", () => {
    expect(percentMvc(200, calibration)).toBe(0);
    expect(percentMvc(1000, calibration)).toBe(50);
    expect(percentMvc(1800, calibration)).toBe(100);
  });

  it("clamps to 0-120", () => {
    expect(percentMvc(100, calibration)).toBe(0);
    expect(percentMvc(1960, calibration)).toBeCloseTo(110);
    expect(percentMvc(3000, calibration)).toBe(MAX_PERCENT_MVC);
    expect(percentMvc(Number.NaN, calibration)).toBe(0);
  });

  it("is 0 for a calibration with no range", () => {
    expect(percentMvc(900, { restMean: 500, restSd: 5, mvc: 400 })).toBe(0);
    expect(percentMvc(900, { restMean: 500, restSd: 5, mvc: 500 })).toBe(0);
  });
});

describe("onset and offset", () => {
  /** Feeds 2 ms samples: each [value, ms] pair holds the value for that long. */
  function feed(detector: OnsetDetector, parts: [number, number][]): OnsetEvent[] {
    const events: OnsetEvent[] = [];
    let t = 0;
    for (const [value, ms] of parts) {
      for (let elapsed = 0; elapsed < ms; elapsed += 2) {
        const event = detector.push(t, value);
        if (event) events.push(event);
        t += 2;
      }
    }
    return events;
  }

  const calibration = { restMean: 200, restSd: 10 }; // threshold 230 mV

  it("needs 50 ms above rest + 3 SD for an onset, timed at the crossing", () => {
    const detector = new OnsetDetector(calibration);
    expect(detector.threshold).toBe(230);
    const events = feed(detector, [
      [200, 100], // rest
      [400, 40], // a blip shorter than 50 ms: nothing
      [200, 60],
      [400, 200], // a contraction from 200 ms
    ]);
    expect(events).toEqual([{ type: "onset", t: 200 }]);
    expect(detector.isActive).toBe(true);
  });

  it("needs 100 ms below for an offset, so short dips do not end a contraction", () => {
    const detector = new OnsetDetector(calibration);
    const events = feed(detector, [
      [400, 100], // onset at 0
      [210, 80], // a dip of 80 ms: still contracting
      [400, 100],
      [210, 150], // relaxes from 280 ms
    ]);
    expect(events).toEqual([
      { type: "onset", t: 0 },
      { type: "offset", t: 280 },
    ]);
    expect(detector.isActive).toBe(false);
  });

  it("does not count a value exactly at the threshold as above", () => {
    const detector = new OnsetDetector(calibration);
    expect(feed(detector, [[230, 200]])).toEqual([]);
  });
});

describe("the ring buffer", () => {
  it("keeps the last values, oldest first", () => {
    const ring = new RingBuffer(4);
    [1, 2, 3].forEach((value) => ring.push(value));
    expect(Array.from(ring.last())).toEqual([1, 2, 3]);
    [4, 5, 6].forEach((value) => ring.push(value));
    expect(ring.length).toBe(4);
    expect(Array.from(ring.last())).toEqual([3, 4, 5, 6]);
    expect(Array.from(ring.last(2))).toEqual([5, 6]);
    expect(Array.from(ring.last(10))).toEqual([3, 4, 5, 6]);
    ring.clear();
    expect(ring.length).toBe(0);
  });
});
