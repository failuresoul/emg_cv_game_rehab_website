import { describe, expect, it } from "vitest";

import {
  BAUD_RATE,
  isWebSerialSupported,
  SerialEmgStream,
  type SerialLike,
  type SerialPortLike,
} from "./serial";
import { EmgEngine, REPLUG_DELAY_MS } from "./engine";
import type { EmgEvent } from "./stream";

/** A fake ESP32 port: `send` delivers bytes to the browser; writes are collected. */
class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  opened: { baudRate: number } | null = null;
  closed = false;
  written: string[] = [];
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  failOpen = false;

  async open(options: { baudRate: number }): Promise<void> {
    if (this.failOpen) throw new Error("Failed to open serial port.");
    this.opened = options;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    const decoder = new TextDecoder();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(decoder.decode(chunk));
      },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  send(text: string): void {
    this.controller?.enqueue(new TextEncoder().encode(text));
  }

  unplug(): void {
    this.controller?.error(new Error("The device has been lost."));
  }
}

class FakeSerial implements SerialLike {
  port = new FakePort();
  refuse = false;
  listeners = new Map<string, (event: Event) => void>();

  async requestPort(): Promise<SerialPortLike> {
    if (this.refuse) throw new DOMException("No port selected by the user.", "NotFoundError");
    return this.port;
  }

  async getPorts(): Promise<SerialPortLike[]> {
    return [this.port];
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
}

/** Lets the read loop handle what was sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function connected() {
  const serial = new FakeSerial();
  let now = 1000;
  const stream = new SerialEmgStream(serial, () => now);
  const events: EmgEvent[] = [];
  stream.subscribe((event) => events.push(event));
  await stream.connect();
  return { serial, stream, events, setNow: (value: number) => (now = value) };
}

describe("Web Serial support", () => {
  it("is only where the browser has navigator.serial", () => {
    expect(isWebSerialSupported({})).toBe(false);
    expect(isWebSerialSupported(null)).toBe(false);
    expect(isWebSerialSupported({ serial: new FakeSerial() })).toBe(true);
  });

  it("explains a missing Web Serial, a cancelled chooser and a busy port", async () => {
    await expect(new SerialEmgStream(null).connect()).rejects.toMatchObject({
      code: "not_supported",
    });
    const serial = new FakeSerial();
    serial.refuse = true;
    await expect(new SerialEmgStream(serial).connect()).rejects.toMatchObject({ code: "no_port" });
    serial.refuse = false;
    serial.port.failOpen = true;
    await expect(new SerialEmgStream(serial).connect()).rejects.toMatchObject({
      code: "open_failed",
    });
  });
});

describe("the serial EMG stream", () => {
  it("opens the chosen port at 230400 baud and sends commands as lines", async () => {
    const { serial, stream, events } = await connected();
    expect(serial.port.opened).toEqual({ baudRate: BAUD_RATE });
    expect(stream.connected).toBe(true);
    expect(events).toEqual([{ type: "connected" }]);
    await stream.send("PING");
    await stream.send("SIM ON");
    await stream.send("START");
    expect(serial.port.written).toEqual(["PING\n", "SIM ON\n", "START\n"]);
  });

  it("reads lines cut across chunks, batching samples with their arrival time", async () => {
    const { serial, events, setNow } = await connected();
    serial.port.send("I,version=1.0.0,rate=500,mode=SIM,streaming=0\nPONG,1.0");
    await settle();
    setNow(1016);
    serial.port.send(".0\r\nOK,START\r\nE,0,200\r\nE,1,2");
    await settle();
    setNow(1032);
    serial.port.send("05\r\nE,2,210\r\nets Jun  8 2016\r\nE,3\r\nS,2,0,1.0.0,SIM\r\nE,3,215\r\n");
    await settle();

    expect(events.slice(1)).toEqual([
      { type: "info", fields: { version: "1.0.0", rate: "500", mode: "SIM", streaming: "0" } },
      { type: "pong", version: "1.0.0" },
      { type: "ok", detail: "START" },
      { type: "samples", samples: [{ counter: 0, mv: 200 }], arrivalMs: 1016 },
      {
        type: "samples",
        samples: [
          { counter: 1, mv: 205 },
          { counter: 2, mv: 210 },
        ],
        arrivalMs: 1032,
      },
      { type: "invalid", line: "E,3" },
      { type: "status", counter: 2, dropped: 0, version: "1.0.0", mode: "SIM" },
      { type: "samples", samples: [{ counter: 3, mv: 215 }], arrivalMs: 1032 },
    ]);
  });

  it("stops the stream and closes the port on disconnect", async () => {
    const { serial, stream, events } = await connected();
    await stream.disconnect();
    expect(serial.port.written).toEqual(["STOP\n"]);
    expect(serial.port.closed).toBe(true);
    expect(stream.connected).toBe(false);
    expect(events.at(-1)).toEqual({ type: "disconnected", error: null });
    await expect(stream.send("PING")).rejects.toMatchObject({ code: "write_failed" });
  });

  it("reports a lost device, and reopens it without the chooser", async () => {
    const { serial, stream, events } = await connected();
    serial.port.unplug();
    await stream.whenClosed();
    expect(events.at(-1)).toEqual({ type: "disconnected", error: "lost" });
    expect(stream.connected).toBe(false);

    serial.port = new FakePort();
    expect(await stream.reconnect()).toBe(true);
    expect(stream.connected).toBe(true);
    expect(serial.port.opened).toEqual({ baudRate: BAUD_RATE });
  });

  it("notices the browser's disconnect event for its port", async () => {
    const { serial, stream, events } = await connected();
    serial.listeners.get("disconnect")!({ target: serial.port } as unknown as Event);
    await settle();
    expect(stream.connected).toBe(false);
    expect(events.at(-1)).toEqual({ type: "disconnected", error: "lost" });
    stream.dispose();
    expect(serial.listeners.has("disconnect")).toBe(false);
  });
});

describe("review: plugging the ESP32 back in", () => {
  it("tells its listeners only after a lost port, not after closing on purpose", async () => {
    const { serial, stream } = await connected();
    let replugs = 0;
    stream.onReplug(() => (replugs += 1));
    const plugIn = () => serial.listeners.get("connect")!({} as Event);

    plugIn();
    expect(replugs).toBe(0); // still connected

    serial.port.unplug();
    await stream.whenClosed();
    plugIn();
    expect(replugs).toBe(1);

    serial.port = new FakePort();
    await stream.reconnect();
    await stream.disconnect();
    plugIn();
    expect(replugs).toBe(1); // closed on purpose
    stream.dispose();
    expect(serial.listeners.has("connect")).toBe(false);
  });

  it("the engine reopens the port, pings and starts again, keeping the calibration", async () => {
    const serial = new FakeSerial();
    const stream = new SerialEmgStream(serial);
    const engine = new EmgEngine();
    await engine.connectSerial(stream);
    engine.setCalibration({ restMean: 200, restSd: 10, mvc: 1500 });
    expect(serial.port.written).toEqual(["PING\n", "START\n"]);

    serial.port.unplug();
    await stream.whenClosed();
    expect(engine.getStatus().connected).toBe(false);
    expect(engine.getStatus().error).toBe("lost");

    serial.port = new FakePort();
    serial.listeners.get("connect")!({} as Event);
    await new Promise((resolve) => setTimeout(resolve, REPLUG_DELAY_MS + 50));
    expect(engine.getStatus().connected).toBe(true);
    expect(serial.port.written).toEqual(["PING\n", "START\n"]);
    expect(engine.getStatus().calibrated).toBe(true);
    await engine.disconnect();
  });
});
