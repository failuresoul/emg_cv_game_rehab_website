import { describe, expect, it, vi } from "vitest";

import { EmgEngine } from "./engine";
import type { OnsetEvent } from "./processing";
import { SIMULATED_VERSION, SimulatedEmgStream } from "./simulated";
import type { EmgEvent, EmgStream } from "./stream";

function simulated() {
  let now = 0;
  const stream = new SimulatedEmgStream({
    now: () => now,
    setTimer: () => 1,
    clearTimer: () => undefined,
    random: () => 0.5,
    keys: null,
  });
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now += 20;
      stream.tick();
    }
  };
  return { stream, advance };
}

/** A stream the test drives by hand. */
class ManualStream implements EmgStream {
  readonly kind = "serial" as const;
  connected = false;
  sent: string[] = [];
  private listener: ((event: EmgEvent) => void) | null = null;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit({ type: "connected" });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit({ type: "disconnected", error: null });
  }

  async send(command: string): Promise<void> {
    this.sent.push(command);
  }

  subscribe(listener: (event: EmgEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(event: EmgEvent): void {
    this.listener?.(event);
  }

  /** `seconds` of samples at 500 Hz with the given value, arriving in 16 ms bursts. */
  stream(seconds: number, mv: (counter: number) => number, from = 0): void {
    const total = seconds * 500;
    for (let start = from; start < from + total; start += 8) {
      const samples = Array.from({ length: 8 }, (_, index) => ({
        counter: start + index,
        mv: mv(start + index),
      }));
      this.emit({ type: "samples", samples, arrivalMs: (start + 8) * 2 + 3 });
    }
  }
}

describe("the EMG engine", () => {
  it("connects the simulated source, pings, starts and reports its status", async () => {
    const engine = new EmgEngine();
    const { stream, advance } = simulated();
    let changes = 0;
    engine.subscribe(() => (changes += 1));
    await engine.connectSimulated(stream);
    advance(2000);
    const status = engine.getStatus();
    expect(status.connected && status.streaming).toBe(true);
    expect(status.source).toBe("simulated");
    expect(status.firmwareVersion).toBe(SIMULATED_VERSION);
    expect(status.mode).toBe("SIM");
    expect(status.sampleRate).toBe(500);
    expect(status.gapsPct).toBe(0);
    expect(status.electrodeOff).toBe(true); // no noise: a perfectly flat simulated line
    expect(engine.recent(1).mv).toHaveLength(500);
    // At most four status updates a second, not one per sample.
    expect(changes).toBeLessThan(20);
    await engine.disconnect();
    expect(engine.getStatus().connected).toBe(false);
  });

  it("gives %MVC and onset events once calibrated", async () => {
    const engine = new EmgEngine();
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    expect(stream.sent).toEqual(["PING", "START"]);
    stream.emit({ type: "ok", detail: "START" });
    expect(engine.percentMvc).toBeNull();

    const onsets: OnsetEvent[] = [];
    engine.onOnset((event) => onsets.push(event));
    engine.setCalibration({ restMean: 200, restSd: 10, mvc: 1800 });
    // 1.5 s of rest, 1 s of contraction at 1000 mV (50 %MVC), 0.5 s of rest.
    stream.stream(3, (counter) => (counter >= 750 && counter < 1250 ? 1000 : 200 + (counter % 5)));
    expect(onsets.map((event) => event.type)).toEqual(["onset", "offset"]);
    // Onset where the 50 ms smoothing first crossed rest + 3 SD, just after 1.5 s. Times carry
    // the least USB delay (5 ms here) once the first second has set the clock.
    expect(onsets[0]!.t - 5).toBeGreaterThanOrEqual(1500);
    expect(onsets[0]!.t - 5).toBeLessThan(1510);
    const percent = engine.recent(3).percent;
    expect(percent[1000]).toBeCloseTo(50);
    expect(engine.percentMvc).toBeCloseTo(0.1, 0);
    expect(engine.getStatus().calibrated).toBe(true);
  });

  it("flags saturation, a flat line and gaps", async () => {
    const engine = new EmgEngine();
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    stream.stream(1, () => 3100);
    let status = engine.getStatus();
    expect(status.saturation).toBe(true);
    expect(status.electrodeOff).toBe(true);
    // Every 10th sample lost.
    stream.emit({ type: "samples", samples: [], arrivalMs: 0 });
    const lossy = new EmgEngine();
    const second = new ManualStream();
    await lossy.connectSerial(second);
    const samples = Array.from({ length: 1000 }, (_, i) => i).filter((i) => i % 10 !== 9);
    for (let index = 0; index < samples.length; index += 9) {
      const batch = samples
        .slice(index, index + 9)
        .map((counter) => ({ counter, mv: 200 + (counter % 30) }));
      second.emit({ type: "samples", samples: batch, arrivalMs: batch.at(-1)!.counter * 2 + 3 });
    }
    status = lossy.getStatus();
    expect(status.gapsPct).toBeCloseTo(10, 0);
    expect(status.saturation).toBe(false);
    expect(status.electrodeOff).toBe(false);
  });

  it("follows the firmware's status line and a rate change", async () => {
    const engine = new EmgEngine();
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    stream.emit({ type: "status", counter: 10, dropped: 3, version: "1.0.0", mode: "ADC" });
    expect(engine.getStatus().dropped).toBe(3);
    expect(engine.getStatus().firmwareVersion).toBe("1.0.0");
    stream.emit({ type: "ok", detail: "RATE,250" });
    expect(engine.sampleRateHz).toBe(250);
    stream.emit({ type: "disconnected", error: "lost" });
    expect(engine.getStatus()).toMatchObject({ connected: false, streaming: false, error: "lost" });
  });

  it("records why a connection failed", async () => {
    const engine = new EmgEngine();
    const failing: EmgStream = {
      kind: "serial",
      connected: false,
      connect: () => Promise.reject(Object.assign(new Error("no port"), { code: "no_port" })),
      disconnect: async () => undefined,
      send: async () => undefined,
      subscribe: () => () => undefined,
    };
    await expect(engine.connectSerial(failing)).rejects.toThrow();
    expect(engine.getStatus().error).toBe("open_failed");
  });
});

describe("review: the simulated sensor in production", () => {
  it("refuses the simulated source in a production build without the setting", async () => {
    vi.stubEnv("DEV", false);
    try {
      const engine = new EmgEngine();
      const { stream } = simulated();
      await expect(engine.connectSimulated(stream)).rejects.toMatchObject({
        code: "not_supported",
      });
      expect(engine.getStatus().connected).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("review: a board that restarts", () => {
  const bootLine: EmgEvent = {
    type: "info",
    fields: { version: "1.0.0", rate: "500", mode: "ADC", streaming: "0" },
  };

  it("is started again when its start-up line says it is not streaming", async () => {
    const engine = new EmgEngine();
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    expect(stream.sent).toEqual(["PING", "START"]);
    stream.emit(bootLine);
    expect(stream.sent).toEqual(["PING", "START", "START"]);
  });

  it("is left stopped after STOP, and an INFO answer while streaming changes nothing", async () => {
    const engine = new EmgEngine();
    const stream = new ManualStream();
    await engine.connectSerial(stream);
    stream.emit({ ...bootLine, fields: { ...bootLine.fields, streaming: "1" } });
    expect(stream.sent).toEqual(["PING", "START"]);
    await engine.send("STOP");
    stream.emit(bootLine);
    expect(stream.sent).toEqual(["PING", "START", "STOP"]);
  });
});
