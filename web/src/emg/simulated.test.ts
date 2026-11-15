import { describe, expect, it } from "vitest";

import {
  CONTRACTION_MV,
  RAMP_MS,
  REST_MV,
  SIMULATED_VERSION,
  SimulatedEmgStream,
} from "./simulated";
import { restResult } from "./calibration";
import type { EmgEvent } from "./stream";

/** A simulated stream on a fake clock: `advance` moves time on in 20 ms ticks. */
function setup(restWanderMv = 0) {
  let now = 0;
  const stream = new SimulatedEmgStream({
    restWanderMv,
    now: () => now,
    setTimer: () => 1,
    clearTimer: () => undefined,
    random: () => 0.5, // no noise
    keys: null,
  });
  const events: EmgEvent[] = [];
  stream.subscribe((event) => events.push(event));
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now += 20;
      stream.tick();
    }
  };
  const samples = () => events.flatMap((event) => (event.type === "samples" ? event.samples : []));
  return { stream, events, advance, samples };
}

describe("the simulated EMG source", () => {
  it("answers like the firmware", async () => {
    const { stream, events } = setup();
    await stream.connect();
    await stream.send("PING");
    await stream.send("SIM ON");
    await stream.send("RATE 300");
    await stream.send("RATE 5");
    expect(events.map((event) => event.type)).toEqual([
      "connected",
      "info",
      "pong",
      "ok",
      "ok",
      "error",
    ]);
    expect(events[2]).toEqual({ type: "pong", version: SIMULATED_VERSION });
    expect(events[4]).toEqual({ type: "ok", detail: "RATE,333" });
    expect(stream.connected).toBe(true);
  });

  it("sends 500 samples a second with a continuous counter, only while started", async () => {
    const { stream, advance, samples, events } = setup();
    await stream.connect();
    advance(200);
    expect(samples()).toHaveLength(0); // not started
    await stream.send("START");
    advance(1000);
    const received = samples();
    expect(received).toHaveLength(500);
    expect(received.map((sample) => sample.counter)).toEqual(
      Array.from({ length: 500 }, (_, i) => i),
    );
    expect(received.every((sample) => sample.mv === REST_MV)).toBe(true);
    // Delivered in bursts of about 10 (every 20 ms), like USB.
    expect(events.filter((event) => event.type === "samples").length).toBe(50);
    expect(events.some((event) => event.type === "status")).toBe(true);
    await stream.send("STOP");
    advance(500);
    expect(samples()).toHaveLength(500);
  });

  it("contracts over 300 ms while M is held, and relaxes when released", async () => {
    const { stream, advance, samples } = setup();
    await stream.connect();
    await stream.send("START");
    advance(100);
    stream.setPressed(true);
    advance(RAMP_MS / 2);
    const halfway = samples().at(-1)!.mv;
    expect(halfway).toBeGreaterThan(REST_MV + 500);
    expect(halfway).toBeLessThan(CONTRACTION_MV - 500);
    advance(RAMP_MS);
    expect(samples().at(-1)!.mv).toBe(CONTRACTION_MV);
    stream.setPressed(false);
    advance(RAMP_MS + 40);
    expect(samples().at(-1)!.mv).toBe(REST_MV);
  });

  it("listens to the M key while connected", async () => {
    const handlers = new Map<string, (event: Event) => void>();
    const keys = {
      addEventListener: (type: string, handler: (event: Event) => void) =>
        handlers.set(type, handler),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    let now = 0;
    const stream = new SimulatedEmgStream({
      restWanderMv: 0,
      now: () => now,
      setTimer: () => 1,
      clearTimer: () => undefined,
      random: () => 0.5,
      keys,
    });
    const mvs: number[] = [];
    stream.subscribe((event) => {
      if (event.type === "samples") mvs.push(...event.samples.map((sample) => sample.mv));
    });
    await stream.connect();
    await stream.send("START");
    handlers.get("keydown")!({ key: "M" } as KeyboardEvent);
    for (let tick = 0; tick < 20; tick += 1) {
      now += 20;
      stream.tick();
    }
    expect(mvs.at(-1)).toBe(CONTRACTION_MV);
    handlers.get("keyup")!({ key: "m" } as KeyboardEvent);
    await stream.disconnect();
    expect(handlers.size).toBe(0);
    expect(stream.connected).toBe(false);
  });

  it("rests with a slow wander that the calibration's rest check accepts", async () => {
    const { stream, advance, samples } = setup(7);
    await stream.connect();
    await stream.send("START");
    advance(10_000);
    const values = samples().map((sample) => sample.mv);
    // Smoothed over 250 ms, as an envelope is: not a flat line, and still relaxed.
    const smoothed = values.slice(125).map((_, index) => {
      const window = values.slice(index, index + 125);
      return window.reduce((total, value) => total + value, 0) / window.length;
    });
    expect(restResult(smoothed).problem).toBeNull();
    // Without the wander the same signal would look like an electrode off.
    const flat = setup(0);
    await flat.stream.connect();
    await flat.stream.send("START");
    flat.advance(2000);
    expect(restResult(flat.samples().map((sample) => sample.mv)).problem).toBe("electrodeOff");
  });
});
