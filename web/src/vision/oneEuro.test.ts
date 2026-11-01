import { describe, expect, it } from "vitest";

import type { Point } from "./geometry";
import { OneEuroFilter2D } from "./oneEuro";

const FRAME_MS = 1000 / 30;

/** Repeatable random numbers from -1 to 1, so the test cannot fail by chance. */
function seededNoise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
}

/** Average size of the frame-to-frame steps. */
function jitter(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total / (points.length - 1);
}

describe("OneEuroFilter2D", () => {
  it("has less jitter than a noisy signal around a still point", () => {
    const noise = seededNoise(42);
    const filter = new OneEuroFilter2D();
    const noisy = Array.from({ length: 300 }, () => ({
      x: 1 + noise() * 0.02,
      y: 0.5 + noise() * 0.02,
    }));

    const smooth = noisy.map((point, index) => filter.filter(point, index * FRAME_MS));

    expect(jitter(smooth)).toBeLessThan(jitter(noisy) * 0.5);
  });

  it("has less jitter on a slow movement and still follows it", () => {
    const noise = seededNoise(7);
    const filter = new OneEuroFilter2D();
    const clean = Array.from({ length: 300 }, (_, index) => {
      const seconds = (index * FRAME_MS) / 1000;
      return { x: Math.sin(seconds), y: Math.cos(seconds) };
    });
    const noisy = clean.map((point) => ({
      x: point.x + noise() * 0.02,
      y: point.y + noise() * 0.02,
    }));

    const smooth = noisy.map((point, index) => filter.filter(point, index * FRAME_MS));

    // Compare with the clean signal, so that real movement does not count as jitter.
    const withoutMovement = (points: readonly Point[]) =>
      points.map((point, index) => ({
        x: point.x - clean[index].x,
        y: point.y - clean[index].y,
      }));
    expect(jitter(withoutMovement(smooth))).toBeLessThan(jitter(withoutMovement(noisy)) * 0.5);
    const finalError = Math.hypot(smooth[299].x - clean[299].x, smooth[299].y - clean[299].y);
    expect(finalError).toBeLessThan(0.2);
  });

  it("returns the first point unchanged", () => {
    const filter = new OneEuroFilter2D();

    expect(filter.filter({ x: 1, y: 2 }, 0)).toEqual({ x: 1, y: 2 });
  });

  it("does not move when a timestamp repeats", () => {
    const filter = new OneEuroFilter2D();
    filter.filter({ x: 0, y: 0 }, 0);
    const first = filter.filter({ x: 1, y: 1 }, 33);

    expect(filter.filter({ x: 9, y: 9 }, 33)).toEqual(first);
  });

  it("jumps to the new point after a reset", () => {
    const filter = new OneEuroFilter2D();
    filter.filter({ x: 0, y: 0 }, 0);
    filter.reset();

    expect(filter.filter({ x: 5, y: 5 }, 1000)).toEqual({ x: 5, y: 5 });
  });
});
