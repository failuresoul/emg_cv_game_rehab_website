import { describe, expect, it } from "vitest";

import { EmgEngine } from "./engine";
import {
  type CheckId,
  evaluateReadiness,
  evaluateSqueeze,
  gatherReadiness,
  GreenLatch,
  isSensorReady,
  type ReadinessInput,
  steadyChecksGreen,
} from "./readiness";
import { READINESS } from "./readinessConfig";
import type { EmgEvent, EmgStream } from "./stream";

/** Everything green except the squeeze, which has not been tried. */
function input(changes: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    simulated: false,
    webSerialSupported: true,
    connected: true,
    now: 10_000,
    ping: { sentAt: 1000, answeredAt: 1040, version: "1.0.0" },
    rateHz: 500,
    gapsPct: 0,
    contactSdMv: 8,
    saturated: false,
    relaxed: { mean: 210, sd: 9 },
    squeeze: null,
    ...changes,
  };
}

function passes(results: ReturnType<typeof evaluateReadiness>): Record<CheckId, boolean> {
  return Object.fromEntries(results.map((check) => [check.id, check.pass])) as Record<
    CheckId,
    boolean
  >;
}

describe("the readiness checks", () => {
  it("are all green (but the squeeze) for a good connection, with their values", () => {
    const results = evaluateReadiness(input());
    expect(results.map((check) => check.id)).toEqual([
      "webSerial", "connected", "responding", "rate", "gaps", "contact", "saturation", "relaxed", "squeeze",
    ]); // prettier-ignore
    expect(passes(results)).toMatchObject({
      webSerial: true, connected: true, responding: true, rate: true, gaps: true,
      contact: true, saturation: true, relaxed: true, squeeze: false,
    }); // prettier-ignore
    expect(steadyChecksGreen(results)).toBe(true);
    const values = Object.fromEntries(results.map((check) => [check.id, check.value]));
    expect(values).toMatchObject({
      responding: "1.0.0",
      rate: "500/s",
      gaps: "0.0%",
      contact: "SD 8.0 mV",
    });
    expect(results.every((check) => check.hintKey.startsWith("emgCheck."))).toBe(true);
  });

  it.each<[CheckId, Partial<ReadinessInput>]>([
    ["webSerial", { webSerialSupported: false }],
    ["connected", { connected: false }],
    ["responding", { ping: { sentAt: 1000, answeredAt: null, version: null } }],
    ["responding", { ping: { sentAt: 1000, answeredAt: 3200, version: "1.0.0" } }], // over 2 s
    ["rate", { rateHz: 489 }],
    ["rate", { rateHz: 511 }],
    ["rate", { rateHz: 0 }],
    ["gaps", { gapsPct: 0.5 }],
    ["contact", { contactSdMv: 1.9 }], // a flat line: electrode off
    ["contact", { contactSdMv: null }],
    ["saturation", { saturated: true }],
    ["relaxed", { relaxed: { mean: 210, sd: READINESS.relaxedMaxSdMv + 1 } }],
    ["relaxed", { relaxed: { mean: READINESS.relaxedMaxMeanMv + 1, sd: 9 } }],
    ["relaxed", { relaxed: null }],
  ])("fails %s with %j", (id, changes) => {
    const results = passes(evaluateReadiness(input(changes)));
    expect(results[id]).toBe(false);
    expect(steadyChecksGreen(evaluateReadiness(input(changes)))).toBe(false);
  });

  it("passes the edges", () => {
    const results = passes(
      evaluateReadiness(
        input({ rateHz: 490, gapsPct: 0.49, contactSdMv: 2.01, relaxed: { mean: 800, sd: 40 } }),
      ),
    );
    expect(results).toMatchObject({ rate: true, gaps: true, contact: true, relaxed: true });
    expect(passes(evaluateReadiness(input({ rateHz: 510 }))).rate).toBe(true);
  });

  it("needs no Web Serial for the simulated sensor", () => {
    const results = evaluateReadiness(input({ simulated: true, webSerialSupported: false }));
    expect(results[0]).toMatchObject({ id: "webSerial", pass: true, value: "simulated" });
  });

  it("fails the signal checks while disconnected, whatever was last measured", () => {
    const results = passes(evaluateReadiness(input({ connected: false, rateHz: null })));
    for (const id of [
      "connected",
      "responding",
      "rate",
      "gaps",
      "contact",
      "saturation",
      "relaxed",
    ] as const) {
      expect(results[id]).toBe(false);
    }
  });
});

describe("green for 2 s", () => {
  it("needs checks 1-8 green without a break for 2 s, then stays", () => {
    const latch = new GreenLatch();
    expect(latch.update(true, 0)).toBe(false);
    expect(latch.update(true, 1500)).toBe(false);
    expect(latch.update(false, 1600)).toBe(false); // a break starts the 2 s again
    expect(latch.update(true, 1700)).toBe(false);
    expect(latch.update(true, 3600)).toBe(false);
    expect(latch.update(true, 3700)).toBe(true);
    // Once ready, a red check (squeezing: no longer relaxed) does not undo it.
    expect(latch.update(false, 4000)).toBe(true);
    expect(latch.isLatched).toBe(true);
  });

  it("is ready only with the squeeze passed as well", () => {
    expect(isSensorReady(true, false)).toBe(false);
    expect(isSensorReady(false, true)).toBe(false);
    expect(isSensorReady(true, true)).toBe(true);
  });
});

describe("the test squeeze", () => {
  const times = Array.from({ length: 1000 }, (_, index) => index * 2);
  const relaxed = { mean: 200, sd: 10 };

  it("passes with a peak of 3 x the relaxed mean and an onset", () => {
    const envelope = times.map((t) => (t > 400 && t < 1600 ? 1500 : 200));
    expect(evaluateSqueeze(times, envelope, relaxed)).toEqual({
      pass: true,
      peakMv: 1500,
      ratio: 7.5,
      onset: true,
    });
  });

  it("fails when the peak is under 3 x the mean, or there is no lasting onset", () => {
    const weak = times.map((t) => (t > 400 && t < 1600 ? 500 : 200)); // 2.5 x
    expect(evaluateSqueeze(times, weak, relaxed)).toMatchObject({
      pass: false,
      onset: true,
      ratio: 2.5,
    });
    const blip = times.map((t) => (t > 400 && t < 430 ? 1500 : 200)); // 30 ms: no onset
    expect(evaluateSqueeze(times, blip, relaxed)).toMatchObject({ pass: false, onset: false });
    expect(
      evaluateSqueeze(
        times,
        times.map(() => 200),
        relaxed,
      ).pass,
    ).toBe(false);
  });
});

/** A stream the test feeds by hand. */
class ManualStream implements EmgStream {
  readonly kind = "serial" as const;
  connected = false;
  private listener: ((event: EmgEvent) => void) | null = null;
  async connect() {
    this.connected = true;
    this.listener?.({ type: "connected" });
  }
  async disconnect() {}
  async send() {}
  subscribe(listener: (event: EmgEvent) => void) {
    this.listener = listener;
    return () => undefined;
  }
  emit(event: EmgEvent) {
    this.listener?.(event);
  }
}

describe("gathering the numbers from the engine", () => {
  it("measures rate, gaps, contact, saturation and the relaxed level over their windows", async () => {
    let now = 0;
    const engine = new EmgEngine(() => now);
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    stream.emit({ type: "pong", version: "1.0.0" });
    // 6 s at 500 Hz in 16 ms bursts, every 50th sample lost, resting with a little noise.
    for (let start = 0; start < 3000; start += 8) {
      const samples = [];
      for (let counter = start; counter < start + 8; counter += 1) {
        if (counter % 50 !== 49) samples.push({ counter, mv: 200 + ((counter * 7) % 21) - 10 });
      }
      now = (start + 8) * 2 + 3;
      stream.emit({ type: "samples", samples, arrivalMs: now });
    }
    const gathered = gatherReadiness(engine, engine.getStatus(), {
      simulated: false,
      webSerialSupported: true,
      now,
      squeeze: null,
    });
    expect(gathered.rateHz).toBeCloseTo(490, -1);
    expect(gathered.gapsPct).toBeCloseTo(2, 0);
    expect(gathered.contactSdMv!).toBeGreaterThan(2);
    expect(gathered.saturated).toBe(false);
    expect(gathered.relaxed!.mean).toBeCloseTo(200, -1);
    const checks = passes(evaluateReadiness(gathered));
    expect(checks).toMatchObject({
      connected: true,
      responding: true,
      gaps: false,
      contact: true,
      relaxed: true,
    });

    // With nothing arriving for 3 s, the data rate falls to 0.
    const later = gatherReadiness(engine, engine.getStatus(), {
      simulated: false, webSerialSupported: true, now: now + 3000, squeeze: null,
    }); // prettier-ignore
    expect(later.rateHz).toBe(0);
  });
});
