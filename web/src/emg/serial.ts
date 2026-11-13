/**
 * The ESP32 over the Web Serial API (Chrome and Edge only; no library). Opens the port the person
 * chooses at 230400 baud, decodes text, splits it into lines and reads them with the firmware's
 * rules (protocol.ts). Samples are passed on in batches, with the time they arrived.
 */

import { type EmgCommand, LineSplitter, parseLine } from "./protocol";
import { EmgError, type EmgEvent, type EmgStream, EventHub } from "./stream";

export const BAUD_RATE = 230400;

// The small part of the Web Serial API used here (TypeScript's DOM types do not include it).
export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

export interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
  removeEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
}

/** navigator.serial, or null where the browser has no Web Serial. */
export function webSerial(
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator,
): SerialLike | null {
  if (typeof nav !== "object" || nav === null || !("serial" in nav)) return null;
  return (nav as { serial: SerialLike }).serial ?? null;
}

export function isWebSerialSupported(nav?: unknown): boolean {
  return webSerial(nav) !== null;
}

export class SerialEmgStream implements EmgStream {
  readonly kind = "serial" as const;
  private readonly serial: SerialLike | null;
  private readonly now: () => number;
  private readonly hub = new EventHub();
  private readonly splitter = new LineSplitter();
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private pipeDone: Promise<void> | null = null;
  private reading: Promise<void> | null = null;
  private closing = false;
  private isConnected = false;
  /** The port was lost (unplugged), not closed on purpose: plugging in may reopen it. */
  private lost = false;
  private readonly replugListeners = new Set<() => void>();

  constructor(
    serial: SerialLike | null = webSerial(),
    now: () => number = () => performance.now(),
  ) {
    this.serial = serial;
    this.now = now;
    this.serial?.addEventListener("disconnect", this.onUnplugged);
    this.serial?.addEventListener("connect", this.onPlugged);
  }

  /** Called when a port is plugged in after this stream lost its own (see EmgEngine). */
  onReplug(listener: () => void): () => void {
    this.replugListeners.add(listener);
    return () => {
      this.replugListeners.delete(listener);
    };
  }

  get connected(): boolean {
    return this.isConnected;
  }

  subscribe(listener: (event: EmgEvent) => void): () => void {
    return this.hub.subscribe(listener);
  }

  /** Asks the person to choose the ESP32's port (call from a click), then opens it. */
  async connect(): Promise<void> {
    if (!this.serial) throw new EmgError("not_supported");
    let port: SerialPortLike;
    try {
      port = await this.serial.requestPort();
    } catch (error) {
      throw new EmgError("no_port", String(error));
    }
    await this.open(port);
  }

  /** Opens the port chosen before (after unplugging and plugging back in) without a chooser.
   * False when there is none to reopen. */
  async reconnect(): Promise<boolean> {
    if (!this.serial) throw new EmgError("not_supported");
    const ports = await this.serial.getPorts();
    const port = (this.port && ports.includes(this.port) ? this.port : ports[0]) ?? null;
    if (!port) return false;
    await this.open(port);
    return true;
  }

  private async open(port: SerialPortLike): Promise<void> {
    if (this.isConnected) await this.disconnect();
    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (error) {
      throw new EmgError("open_failed", String(error));
    }
    if (!port.readable) throw new EmgError("open_failed", "The port cannot be read");
    this.port = port;
    this.closing = false;
    this.lost = false;
    this.splitter.reset();
    const decoder = new TextDecoderStream();
    this.pipeDone = port.readable
      .pipeTo(decoder.writable as WritableStream<Uint8Array>)
      .catch(() => undefined);
    this.reader = decoder.readable.getReader();
    this.isConnected = true;
    this.hub.emit({ type: "connected" });
    this.reading = this.readLoop(this.reader);
  }

  private async readLoop(reader: ReadableStreamDefaultReader<string>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.handleText(value);
      }
    } catch {
      // The device went away while reading; reported below.
    }
    if (!this.closing) await this.finish("lost");
  }

  /** Lines in a chunk of text; samples are passed on together, with the chunk's arrival time. */
  handleText(text: string, arrivalMs = this.now()): void {
    const samples: { counter: number; mv: number }[] = [];
    for (const line of this.splitter.push(text)) {
      const parsed = parseLine(line);
      if (parsed === null || parsed.type === "unknown") continue;
      if (parsed.type === "sample") {
        samples.push({ counter: parsed.counter, mv: parsed.mv });
        continue;
      }
      if (samples.length > 0) this.flushSamples(samples, arrivalMs);
      this.hub.emit(parsed);
    }
    if (samples.length > 0) this.flushSamples(samples, arrivalMs);
  }

  private flushSamples(samples: { counter: number; mv: number }[], arrivalMs: number): void {
    this.hub.emit({ type: "samples", samples: samples.splice(0), arrivalMs });
  }

  async send(command: EmgCommand): Promise<void> {
    const writable = this.port?.writable;
    if (!this.isConnected || !writable) throw new EmgError("write_failed", "Not connected");
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${command}\n`));
    } catch (error) {
      throw new EmgError("write_failed", String(error));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    this.closing = true;
    try {
      await this.send("STOP");
    } catch {
      // Already gone.
    }
    await this.finish(null);
  }

  private async finish(error: "lost" | null): Promise<void> {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // Nothing to cancel.
    }
    await this.pipeDone;
    try {
      await this.port?.close();
    } catch {
      // Already closed (unplugged).
    }
    this.reader = null;
    this.pipeDone = null;
    this.lost = error === "lost";
    this.hub.emit({ type: "disconnected", error });
  }

  private readonly onPlugged = (): void => {
    if (!this.isConnected && this.lost) this.replugListeners.forEach((listener) => listener());
  };

  private readonly onUnplugged = (event: Event): void => {
    if (this.isConnected && (event.target === this.port || event.target === null)) {
      void this.finish("lost");
    }
  };

  /** For tests: resolves when the read loop has ended. */
  async whenClosed(): Promise<void> {
    await this.reading;
  }

  /** Stops listening to the browser's unplug events (the stream is no longer used). */
  dispose(): void {
    this.serial?.removeEventListener("disconnect", this.onUnplugged);
    this.serial?.removeEventListener("connect", this.onPlugged);
  }
}
