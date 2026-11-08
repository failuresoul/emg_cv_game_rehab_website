import { describe, expect, it } from "vitest";

import type { CounterFrame } from "./counter";
import { type SequenceEvent, SequenceCounter } from "./sequenceCounter";
import { cycles, FRAME_MS, hold, seededNoise } from "./testSignals";

const OPEN = 0.9;
const TOUCH = 0.1;
// The standard thumb opposition thresholds: touch below 0.25, release above 0.40.
const CONFIG = { low: 0.25, high: 0.4 };

/** All four fingers apart, with `finger` at this distance. */
function frame(timestamp: number, finger: number | null, distance: number): CounterFrame {
  const values = [OPEN, OPEN, OPEN, OPEN];
  if (finger !== null) values[finger] = distance;
  return { timestamp, value: null, values };
}

/** Feeds touches of the given fingers in order, each a smooth 0.6 s dip, starting apart. */
function touch(counter: SequenceCounter, fingers: number[], startTs = 0, gapMs = 200): number {
  let time = startTs;
  for (const sample of hold(OPEN, gapMs, time)) counter.feed(frame(sample.timestamp, null, OPEN));
  time += gapMs + FRAME_MS;
  for (const finger of fingers) {
    for (const sample of cycles({
      rest: OPEN,
      peak: TOUCH,
      cycles: 1,
      periodMs: 600,
      startTs: time,
    })) {
      counter.feed(frame(sample.timestamp, finger, sample.value));
    }
    time += 600 + FRAME_MS;
    for (const sample of hold(OPEN, gapMs, time)) counter.feed(frame(sample.timestamp, null, OPEN));
    time += gapMs + FRAME_MS;
  }
  return time;
}

function eventsOf(counter: SequenceCounter): SequenceEvent[] {
  const list: SequenceEvent[] = [];
  counter.subscribe((event) => list.push(event));
  return list;
}

const feedbackOf = (list: SequenceEvent[]) =>
  list.flatMap((event) => (event.type === "feedback" ? [event.feedback] : []));

describe("SequenceCounter", () => {
  it("counts 5 full sequences", () => {
    const counter = new SequenceCounter(CONFIG);

    touch(counter, Array.from({ length: 5 }, () => [0, 1, 2, 3]).flat());

    expect(counter.fullReps).toBe(5);
    expect(counter.partialReps).toBe(0);
    expect(counter.sequenceStep).toBe(0);
    expect(counter.state).toBe("REST");
  });

  it("records each sequence's time and its loosest touch", () => {
    const counter = new SequenceCounter(CONFIG);

    touch(counter, [0, 1, 2, 3]);

    const [rep] = counter.reps;
    expect(rep.index).toBe(1);
    expect(rep.reachedTarget).toBe(true);
    expect(rep.peakValue).toBeCloseTo(TOUCH, 2);
    expect(rep.rawPeakValue).toBeCloseTo(TOUCH, 2);
    // Four 0.6 s touches with 0.2 s gaps, from the first touch to the last release.
    expect(rep.durationMs).toBeGreaterThan(2000);
    expect(rep.durationMs).toBeLessThan(3000);
    expect(rep.endTs - rep.startTs).toBe(rep.durationMs);
  });

  it("says which finger comes next", () => {
    const counter = new SequenceCounter(CONFIG);
    const list = eventsOf(counter);

    touch(counter, [0, 1, 2, 3]);

    expect(feedbackOf(list)).toEqual([
      "next_index",
      "next_middle",
      "next_ring",
      "next_little",
      "good",
    ]);
    expect(list.filter((event) => event.type === "repCompleted")).toHaveLength(1);
  });

  it("ignores touches in the wrong order", () => {
    const counter = new SequenceCounter(CONFIG);

    touch(counter, [1, 0, 2, 3]);
    expect(counter.fullReps).toBe(0);
    // Only the index finger counted: the middle came too early, the ring and little too soon.
    expect(counter.sequenceStep).toBe(1);

    touch(counter, [1, 2, 3], 4000);
    expect(counter.fullReps).toBe(1);
  });

  it("counts jitter around the touch line as one touch", () => {
    const counter = new SequenceCounter(CONFIG);
    const noise = seededNoise(3);
    counter.feed(frame(0, null, OPEN));

    // Hovers between 0.21 and 0.29, crossing the touch line many times, then lets go.
    for (let index = 1; index <= 60; index++) {
      counter.feed(frame(index * FRAME_MS, 0, CONFIG.low + 0.04 * noise()));
    }
    // Then hovers around the release line, which must not start a second touch.
    for (let index = 61; index <= 120; index++) {
      counter.feed(frame(index * FRAME_MS, 0, CONFIG.high + 0.03 * noise()));
    }
    counter.feed(frame(121 * FRAME_MS, 0, OPEN));

    expect(counter.sequenceStep).toBe(1);
    expect(counter.state).toBe("MOVING");
  });

  it("starts again when the next finger takes more than 6 seconds", () => {
    const counter = new SequenceCounter(CONFIG);
    const list = eventsOf(counter);

    const afterIndex = touch(counter, [0]);
    expect(counter.sequenceStep).toBe(1);
    for (const sample of hold(OPEN, 6500, afterIndex)) {
      counter.feed(frame(sample.timestamp, null, OPEN));
    }

    expect(counter.sequenceStep).toBe(0);
    expect(feedbackOf(list).at(-1)).toBe("next_index");

    // The middle finger is not next any more, so it is ignored.
    touch(counter, [1], afterIndex + 6600);
    expect(counter.sequenceStep).toBe(0);
  });

  it("keeps a slow sequence that never waits 6 seconds for one finger", () => {
    const counter = new SequenceCounter(CONFIG);

    touch(counter, [0, 1, 2, 3], 0, 4000);

    expect(counter.fullReps).toBe(1);
  });

  it("does not count a touch already held at the start", () => {
    const counter = new SequenceCounter(CONFIG);

    for (const sample of hold(TOUCH, 500)) counter.feed(frame(sample.timestamp, 0, TOUCH));
    expect(counter.awaitingRest).toBe(true);
    counter.feed(frame(600, 0, OPEN));

    expect(counter.awaitingRest).toBe(false);
    expect(counter.sequenceStep).toBe(0);
  });

  it("does not complete a sequence across a pause", () => {
    const counter = new SequenceCounter(CONFIG);
    const list = eventsOf(counter);

    touch(counter, [0, 1, 2]);
    counter.pause();
    // Ignored while paused.
    touch(counter, [3], 3000);
    counter.resume();
    expect(counter.awaitingRest).toBe(true);
    touch(counter, [3], 5000);

    expect(counter.fullReps).toBe(0);
    expect(list.some((event) => event.type === "repCompleted")).toBe(false);
  });

  it("counts normally after a pause, from the first finger", () => {
    const counter = new SequenceCounter(CONFIG);

    touch(counter, [0, 1]);
    counter.pause();
    counter.resume();
    touch(counter, [0, 1, 2, 3], 3000);

    expect(counter.fullReps).toBe(1);
  });

  it("ignores frames without all four distances", () => {
    const counter = new SequenceCounter(CONFIG);
    counter.feed(frame(0, null, OPEN));

    counter.feed({ timestamp: 33, value: null, values: [TOUCH, OPEN] });
    counter.feed({ timestamp: 66, value: null, values: [NaN, OPEN, OPEN, OPEN] });
    counter.feed({ timestamp: 99, value: null, values: null });

    expect(counter.state).toBe("REST");
  });

  it("rejects thresholds in the wrong order", () => {
    expect(() => new SequenceCounter({ low: 0.4, high: 0.25 })).toThrow(RangeError);
  });
});
