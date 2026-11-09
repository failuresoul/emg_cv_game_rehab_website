import { describe, expect, it } from "vitest";

import { ActivationDetector, type ActivationState } from "./activationDetector";

const FRAME_MS = 33;

/** Feeds one level per 33 ms frame, from `from` up to and including `to`. */
function feed(
  detector: ActivationDetector,
  from: number,
  to: number,
  level: (t: number) => number,
): ActivationState {
  let state = detector.current;
  for (let t = from; t <= to; t += FRAME_MS) state = detector.update(level(t), t);
  return state;
}

const create = (changes: Partial<ConstructorParameters<typeof ActivationDetector>[0]> = {}) =>
  new ActivationDetector({ demand: 0.6, holdMs: 500, windowMs: 3000, ...changes });

describe("ActivationDetector", () => {
  it("activates after holding at the demand for holdMs", () => {
    const detector = create();
    detector.start(1000);
    feed(detector, 1000, 1300, () => 0.1);
    const holding = detector.update(0.7, 1400);
    expect(holding.status).toBe("holding");
    expect(detector.update(0.7, 1650).holdProgress).toBeCloseTo(0.5);

    const state = detector.update(0.7, 1900);
    expect(state.status).toBe("activated");
    expect(state.holdProgress).toBe(1);
  });

  it("reports latency from the window start to the hold's start, and the peak level", () => {
    const detector = create();
    detector.start(1000);
    detector.update(0.2, 1200);
    detector.update(0.65, 1400);
    detector.update(0.9, 1600);
    const state = detector.update(0.75, 1950);
    expect(state.status).toBe("activated");
    expect(state.latencyMs).toBe(400);
    expect(state.onsetMs).toBe(400);
    expect(state.doneMs).toBe(900);
    expect(state.peakLevel).toBe(0.9);
  });

  it("waits with no latency while the level stays below the demand", () => {
    const detector = create();
    detector.start(0);
    const state = feed(detector, 0, 2000, () => 0.5);
    expect(state.status).toBe("waiting");
    expect(state.latencyMs).toBeNull();
    expect(state.peakLevel).toBe(0.5);
  });

  it("fails at the end of the window without a complete hold", () => {
    const detector = create();
    detector.start(0);
    expect(feed(detector, 0, 2970, () => 0.4).status).toBe("waiting");
    const state = detector.update(0.4, 3000);
    expect(state.status).toBe("failed");
    expect(state.latencyMs).toBeNull();
    expect(state.doneMs).toBeNull();
    expect(state.peakLevel).toBe(0.4);
  });

  it("fails when the hold would only finish after the window", () => {
    const detector = create();
    detector.start(0);
    detector.update(0.8, 2700); // Needs until 3200.
    expect(detector.update(0.8, 2990).status).toBe("holding");
    expect(detector.update(0.8, 3200).status).toBe("failed");
  });

  it("keeps a hold through a dip within the hysteresis", () => {
    const detector = create();
    detector.start(0);
    detector.update(0.65, 100);
    expect(detector.update(0.56, 300).status).toBe("holding"); // 0.04 below the demand.
    const state = detector.update(0.62, 600);
    expect(state.status).toBe("activated");
    expect(state.onsetMs).toBe(100);
  });

  it("restarts the hold after a dip beyond the hysteresis", () => {
    const detector = create();
    detector.start(0);
    detector.update(0.65, 100);
    expect(detector.update(0.54, 300).status).toBe("waiting"); // 0.06 below the demand.
    // Back at the demand needs a full new hold: 0.56 alone would not start one.
    expect(detector.update(0.57, 400).status).toBe("waiting");
    detector.update(0.6, 500);
    expect(detector.update(0.6, 900).status).toBe("holding");
    const state = detector.update(0.6, 1000);
    expect(state.status).toBe("activated");
    expect(state.latencyMs).toBe(500);
  });

  it("honours a custom hysteresis", () => {
    const detector = create({ hysteresis: 0 });
    detector.start(0);
    detector.update(0.65, 100);
    expect(detector.update(0.59, 300).status).toBe("waiting");
  });

  it("keeps its result once activated or failed", () => {
    const detector = create();
    detector.start(0);
    detector.update(1, 0);
    const done = detector.update(1, 500);
    expect(detector.update(0, 4000)).toEqual(done);

    const failing = create({ windowMs: 1000 });
    failing.start(0);
    const failed = failing.update(0.1, 1000);
    expect(failing.update(1, 1100)).toEqual(failed);
  });

  it("activates at once with no hold time", () => {
    const detector = create({ holdMs: 0 });
    detector.start(0);
    expect(detector.update(0.6, 250).status).toBe("activated");
    expect(detector.current.latencyMs).toBe(250);
  });

  it("starts a fresh window on start()", () => {
    const detector = create({ windowMs: 1000 });
    detector.start(0);
    detector.update(0.1, 1000);
    expect(detector.current.status).toBe("failed");

    detector.start(5000);
    expect(detector.current.status).toBe("waiting");
    expect(detector.current.peakLevel).toBe(0);
    detector.update(0.9, 5100);
    expect(detector.update(0.9, 5600).latencyMs).toBe(100);
  });

  it("needs start() before update()", () => {
    expect(() => create().update(0.5, 0)).toThrow();
  });

  it("rejects an impossible configuration", () => {
    expect(() => create({ windowMs: 0 })).toThrow(RangeError);
    expect(() => create({ holdMs: -1 })).toThrow(RangeError);
  });
});
