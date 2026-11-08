import { describe, expect, it } from "vitest";

import { RepCounter, type RepCounterConfig, type RepEvent } from "./repCounter";
import { cycles, hold, ramp, type Sample } from "./testSignals";

const UP: RepCounterConfig = { direction: "up", low: 30, high: 90 };
const DOWN: RepCounterConfig = { direction: "down", low: 70, high: 140 };

function run(config: RepCounterConfig, samples: Sample[]) {
  const counter = new RepCounter(config);
  const events: RepEvent[] = [];
  counter.subscribe((event) => events.push(event));
  for (const { value, timestamp } of samples) counter.update(value, timestamp);
  const feedback = events.flatMap((event) => (event.type === "feedback" ? [event.feedback] : []));
  const states = events.flatMap((event) => (event.type === "stateChanged" ? [event.state] : []));
  return { counter, events, feedback, states };
}

describe("RepCounter, direction up", () => {
  it("counts exactly 10 reps from 10 clean cycles", () => {
    const { counter } = run(UP, cycles({ rest: 10, peak: 120, cycles: 10 }));

    expect(counter.fullReps).toBe(10);
    expect(counter.partialReps).toBe(0);
  });

  it("counts exactly 10 reps from 10 noisy cycles", () => {
    const { counter } = run(UP, cycles({ rest: 10, peak: 120, cycles: 10, noiseDeg: 2 }));

    expect(counter.fullReps).toBe(10);
    expect(counter.partialReps).toBe(0);
  });

  it("goes through the states in order", () => {
    const { states } = run(UP, cycles({ rest: 10, peak: 120, cycles: 1 }));

    expect(states).toEqual(["MOVING", "AT_TARGET", "RETURNING", "REST"]);
  });

  it("does not double-count noise around the target line", () => {
    const samples = [
      ...ramp([
        [0, 10],
        [1000, 90],
      ]),
      ...hold(90, 2000, 1000, 6),
      ...ramp([
        [3000, 90],
        [4000, 10],
      ]),
    ];

    const { counter } = run(UP, samples);

    expect(counter.fullReps).toBe(1);
  });

  it("ignores noise around the rest line", () => {
    const { counter, feedback } = run(UP, hold(30, 5000, 0, 6));

    expect(counter.fullReps).toBe(0);
    expect(counter.partialReps).toBe(0);
    expect(feedback).toEqual([]);
  });

  it("counts a partial movement as partial, with almost feedback", () => {
    // 60% of the way from 30 to 90 is 66.
    const { counter, feedback, events } = run(UP, cycles({ rest: 10, peak: 75, cycles: 3 }));

    expect(counter.fullReps).toBe(0);
    expect(counter.partialReps).toBe(3);
    expect(feedback).toEqual(["almost", "almost", "almost"]);
    expect(events.filter((event) => event.type === "partialRep")).toHaveLength(3);
    expect(counter.reps[0].reachedTarget).toBe(false);
  });

  it("gives higher feedback for a smaller movement, without counting it", () => {
    const { counter, feedback } = run(UP, cycles({ rest: 10, peak: 55, cycles: 2 }));

    expect(counter.partialReps).toBe(0);
    expect(counter.fullReps).toBe(0);
    expect(feedback).toEqual(["higher", "higher"]);
  });

  it("respects a custom partial fraction", () => {
    const { counter } = run(
      { ...UP, partialFraction: 0.9 },
      cycles({ rest: 10, peak: 75, cycles: 1 }),
    );

    expect(counter.partialReps).toBe(0);
  });

  it("ignores cycles faster than the minimum", () => {
    const { counter, feedback } = run(
      UP,
      cycles({ rest: 10, peak: 120, cycles: 10, periodMs: 400, frameMs: 1000 / 60 }),
    );

    expect(counter.fullReps).toBe(0);
    expect(feedback).toEqual([]);
  });

  it("counts a rep just over the minimum duration", () => {
    const { counter } = run(UP, [
      { value: 10, timestamp: 0 },
      { value: 100, timestamp: 100 },
      { value: 10, timestamp: 700 },
    ]);

    expect(counter.fullReps).toBe(1);
  });

  it("counts a full rep when one frame jumps straight past the target", () => {
    const { counter } = run(UP, [
      { value: 10, timestamp: 0 },
      { value: 100, timestamp: 33 },
      { value: 100, timestamp: 400 },
      { value: 10, timestamp: 900 },
    ]);

    expect(counter.fullReps).toBe(1);
    expect(counter.partialReps).toBe(0);
    expect(counter.reps[0].peakValue).toBe(100);
  });

  it("resets a movement longer than the maximum, with slow feedback", () => {
    const samples = ramp([
      [0, 10],
      [2000, 100],
      [11000, 100],
      [12000, 10],
    ]);

    const { counter, feedback } = run(UP, samples);

    expect(counter.fullReps).toBe(0);
    expect(feedback).toContain("slow");
    expect(counter.state).toBe("REST");
  });

  it("needs the arm back at rest after a slow reset", () => {
    const samples = [
      ...ramp([
        [0, 10],
        [1000, 100],
        [10000, 100],
      ]),
      // Falls but stays above rest, then rises again: this must not start a rep.
      ...ramp([
        [10001, 60],
        [11000, 100],
        [12000, 60],
      ]),
    ];

    const { counter } = run(UP, samples);

    expect(counter.fullReps).toBe(0);
    expect(counter.state).toBe("REST");
  });

  it("does not count a rep if the arm starts raised", () => {
    const { counter } = run(
      UP,
      ramp([
        [0, 100],
        [1500, 10],
      ]),
    );

    expect(counter.fullReps).toBe(0);
  });

  it("records peaks, times and index for each rep", () => {
    const { counter } = run(UP, cycles({ rest: 10, peak: 120, cycles: 2 }));

    const [first, second] = counter.reps;
    expect(first.index).toBe(1);
    expect(second.index).toBe(2);
    expect(first.peakValue).toBeCloseTo(120, 0);
    expect(first.peakTs).toBeCloseTo(1500, -2);
    expect(first.startTs).toBeLessThan(first.peakTs);
    expect(first.peakTs).toBeLessThan(first.endTs);
    expect(first.durationMs).toBeCloseTo(first.endTs - first.startTs);
    expect(first.reachedTarget).toBe(true);
    expect(second.startTs).toBeGreaterThan(first.endTs - 1);
  });

  it("gives good feedback for a full rep", () => {
    const { feedback } = run(UP, cycles({ rest: 10, peak: 120, cycles: 1 }));

    expect(feedback).toEqual(["good"]);
  });

  it("works when a person pauses at the target before returning", () => {
    const samples = ramp([
      [0, 10],
      [1000, 100],
      [4000, 100],
      [5000, 10],
    ]);

    expect(run(UP, samples).counter.fullReps).toBe(1);
  });

  it("stops listening after unsubscribing", () => {
    const counter = new RepCounter(UP);
    const events: RepEvent[] = [];
    const unsubscribe = counter.subscribe((event) => events.push(event));

    unsubscribe();
    for (const { value, timestamp } of cycles({ rest: 10, peak: 120, cycles: 1 })) {
      counter.update(value, timestamp);
    }

    expect(events).toEqual([]);
  });
});

describe("RepCounter, pause", () => {
  it("does not complete a rep paused in the middle", () => {
    const counter = new RepCounter(UP);
    const up = ramp([
      [0, 10],
      [1000, 100],
    ]);
    for (const { value, timestamp } of up) counter.update(value, timestamp);
    expect(counter.state).toBe("AT_TARGET");

    counter.pause();
    counter.update(10, 1500);
    counter.resume();
    counter.update(10, 2000);

    expect(counter.fullReps).toBe(0);
    expect(counter.partialReps).toBe(0);
    expect(counter.state).toBe("REST");
  });

  it("does not create a rep from a return seen after the pause", () => {
    const counter = new RepCounter(UP);
    const up = ramp([
      [0, 10],
      [1000, 100],
    ]);
    for (const { value, timestamp } of up) counter.update(value, timestamp);

    counter.pause();
    counter.resume();
    const down = ramp([
      [1500, 100],
      [2500, 10],
    ]);
    for (const { value, timestamp } of down) counter.update(value, timestamp);

    expect(counter.fullReps).toBe(0);
  });

  it("ignores updates while paused", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.pause();

    for (const { value, timestamp } of cycles({ rest: 10, peak: 120, cycles: 3 })) {
      counter.update(value, timestamp);
    }

    expect(counter.fullReps).toBe(0);
    expect(counter.state).toBe("REST");
  });

  it("counts normally again once the arm returns to rest", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.pause();
    counter.resume();

    for (const { value, timestamp } of cycles({ rest: 10, peak: 120, cycles: 2, startTs: 100 })) {
      counter.update(value, timestamp);
    }

    expect(counter.fullReps).toBe(2);
  });
});

describe("RepCounter, direction down", () => {
  it("counts elbow bends from straight", () => {
    const { counter } = run(DOWN, cycles({ rest: 170, peak: 40, cycles: 10, noiseDeg: 2 }));

    expect(counter.fullReps).toBe(10);
  });

  it("records the minimum as the peak", () => {
    const { counter } = run(DOWN, cycles({ rest: 170, peak: 40, cycles: 1 }));

    expect(counter.reps[0].peakValue).toBeCloseTo(40, 0);
  });

  it("counts a partial bend, using the distance from the rest line", () => {
    // 60% of the way from 140 to 70 is 98.
    const { counter, feedback } = run(DOWN, cycles({ rest: 170, peak: 90, cycles: 1 }));

    expect(counter.fullReps).toBe(0);
    expect(counter.partialReps).toBe(1);
    expect(feedback).toEqual(["almost"]);
  });

  it("gives lower feedback for a small bend", () => {
    const { feedback, counter } = run(DOWN, cycles({ rest: 170, peak: 115, cycles: 1 }));

    expect(feedback).toEqual(["lower"]);
    expect(counter.partialReps).toBe(0);
  });

  it("does not double-count noise around the target line", () => {
    const samples = [
      ...ramp([
        [0, 170],
        [1000, 70],
      ]),
      ...hold(70, 2000, 1000, 6),
      ...ramp([
        [3000, 70],
        [4000, 170],
      ]),
    ];

    expect(run(DOWN, samples).counter.fullReps).toBe(1);
  });
});

describe("RepCounter, bad input", () => {
  it.each([
    ["swapped", 90, 30],
    ["equal", 60, 60],
    ["not a number", NaN, 90],
  ])("rejects thresholds that are %s", (_, low, high) => {
    expect(() => new RepCounter({ direction: "up", low, high })).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])("ignores an angle of %s", (bad) => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);

    counter.update(bad, 100);

    expect(counter.state).toBe("REST");
    for (const { value, timestamp } of cycles({ rest: 10, peak: 120, cycles: 1, startTs: 200 })) {
      counter.update(value, timestamp);
    }
    expect(counter.fullReps).toBe(1);
    expect(counter.reps[0].peakValue).toBeCloseTo(120, 0);
  });

  it("keeps a movement going through a bad angle", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.update(100, 300);

    counter.update(NaN, 400);

    expect(counter.state).toBe("AT_TARGET");
    counter.update(10, 1000);
    expect(counter.fullReps).toBe(1);
  });
});

describe("RepCounter, more pause cases", () => {
  it("does not start a rep during a pause", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.pause();

    counter.update(100, 500);
    expect(counter.state).toBe("REST");

    counter.resume();
    counter.update(100, 800);
    counter.update(10, 1500);

    expect(counter.fullReps).toBe(0);
    expect(counter.partialReps).toBe(0);
  });

  it("does not count a movement already raised when resuming, until back at rest", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.pause();
    counter.resume();
    expect(counter.awaitingRest).toBe(true);

    counter.update(100, 500);
    expect(counter.state).toBe("REST");

    counter.update(10, 1000);
    expect(counter.awaitingRest).toBe(false);
    expect(counter.fullReps).toBe(0);
  });

  it("emits no rep or feedback events when paused during a movement", () => {
    const counter = new RepCounter(UP);
    const events: RepEvent[] = [];
    counter.update(10, 0);
    counter.update(100, 300);
    counter.subscribe((event) => events.push(event));

    counter.pause();

    expect(events).toEqual([{ type: "stateChanged", state: "REST" }]);
  });

  it("handles pausing twice and resuming without a pause", () => {
    const counter = new RepCounter(UP);
    counter.pause();
    counter.pause();
    counter.resume();
    counter.resume();

    for (const { value, timestamp } of cycles({ rest: 10, peak: 120, cycles: 1 })) {
      counter.update(value, timestamp);
    }

    expect(counter.fullReps).toBe(1);
  });
});

describe("RepCounter, raw peaks", () => {
  it("keeps the raw peak alongside the filtered one", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0, 11);
    counter.update(95, 300, 104);
    counter.update(100, 500, 101);
    counter.update(10, 1000, 9);

    expect(counter.reps[0].peakValue).toBe(100);
    expect(counter.reps[0].rawPeakValue).toBe(104);
  });

  it("uses the smallest raw value for the elbow", () => {
    const counter = new RepCounter(DOWN);
    counter.update(170, 0, 170);
    counter.update(60, 300, 52);
    counter.update(55, 500, 58);
    counter.update(170, 1000, 170);

    expect(counter.reps[0].peakValue).toBe(55);
    expect(counter.reps[0].rawPeakValue).toBe(52);
  });

  it("uses the filtered value when there is no raw value", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0);
    counter.update(100, 500);
    counter.update(10, 1200);

    expect(counter.reps[0].rawPeakValue).toBe(100);
  });

  it("ignores a bad raw value", () => {
    const counter = new RepCounter(UP);
    counter.update(10, 0, 10);
    counter.update(100, 500, NaN);
    counter.update(10, 1200, 10);

    expect(counter.reps[0].rawPeakValue).toBe(100);
  });
});

describe("RepCounter, hysteresis", () => {
  it("counts small ratio movements with a small hysteresis", () => {
    const counter = new RepCounter({ direction: "up", low: 1.2, high: 1.6, hysteresis: 0.04 });
    for (const { value, timestamp } of cycles({ rest: 1.0, peak: 1.8, cycles: 3 })) {
      counter.update(value, timestamp);
    }

    expect(counter.fullReps).toBe(3);
  });

  it("cannot count them with the default, which suits degrees", () => {
    // A movement must rise 3 above the rest line before it starts: 4.2, beyond any hand opening.
    const counter = new RepCounter({ direction: "up", low: 1.2, high: 1.6 });
    for (const { value, timestamp } of cycles({ rest: 1.0, peak: 1.8, cycles: 3 })) {
      counter.update(value, timestamp);
    }

    expect(counter.fullReps).toBe(0);
  });

  it("does not double-count ratio jitter around the target", () => {
    const counter = new RepCounter({ direction: "up", low: 1.2, high: 1.6, hysteresis: 0.04 });
    const signal = [
      ...ramp([
        [0, 1.0],
        [800, 1.6],
      ]),
      ...hold(1.6, 1000, 833, 0.03),
      ...ramp([
        [1866, 1.6],
        [2666, 1.0],
      ]),
    ];
    for (const { value, timestamp } of signal) counter.update(value, timestamp);

    expect(counter.fullReps).toBe(1);
  });
});
