/**
 * A mock ESP32 behind the Web Serial interface, playing the real firmware protocol
 * (firmware/emg_stream/emg_stream.ino) byte for byte: the commands START, STOP, PING, RATE <hz>,
 * SIM ON|OFF and INFO (any case, one per line), the replies OK,... / ERR,... / PONG,<version> /
 * I,key=value,..., samples E,<counter>,<mv> and a status line S,<counter>,<dropped>,<version>,<mode>
 * once a second, and the start-up I line when the port opens.
 *
 * It lets the whole browser path (SerialEmgStream -> EmgEngine -> readiness -> calibration ->
 * %MVC -> games) run without hardware, in tests and on /dev/emg-monitor. Time is virtual: call
 * advance(ms) (tests), or autoRun() to follow the real clock (the development page).
 *
 * Faults to try: a wrong rate, noise, lost counters, firmware drops, saturation, a flat line (an
 * electrode off), garbled lines, a slow PONG, unplugging and plugging back in.
 * Only tests and development pages import it, so a production build never contains it.
 */

import type { SerialLike, SerialPortLike } from "./serial";

export const MOCK_VERSION = "1.0.0";

export interface MockBoardOptions {
  /** The firmware's starting rate (RATE changes it), Hz. */
  rateHz?: number;
  /** Samples actually produced per sample due: 1 is exact; 0.9 gives 450/s at 500 Hz. */
  rateScale?: number;
  /** The relaxed envelope (mV) and the strongest contraction's. */
  restMv?: number;
  mvcMv?: number;
  /** Uniform noise, ± mV. */
  noiseMv?: number;
  /** One counter skipped every this many samples (lost on the way); 0 for none. */
  dropEvery?: number;
  /** Added to the status line's dropped count each second. */
  firmwareDropsPerSecond?: number;
  /** One line in this many is garbled (cut, or junk bytes); 0 for none. */
  garbleEvery?: number;
  /** How long PONG takes, ms. */
  pongDelayMs?: number;
  /** Starts in SIM mode (the firmware's own simulated envelope). */
  sim?: boolean;
  /** For repeatable noise. */
  seed?: number;
  /** The largest chunk the "USB" delivers at once, bytes. */
  maxChunk?: number;
}

/** What the person's forearm is doing (ignored in SIM mode). */
export interface MockSignal {
  /** 0 relaxed to 1 the strongest contraction. */
  contraction: number;
  /** No signal change at all: an electrode is off. */
  flat: boolean;
  /** Clipped at the ADC's top: the gain or the divider is too high. */
  saturated: boolean;
}

const DEFAULTS: Required<MockBoardOptions> = {
  rateHz: 500,
  rateScale: 1,
  restMv: 200,
  mvcMv: 1800,
  noiseMv: 30,
  dropEvery: 0,
  firmwareDropsPerSecond: 0,
  garbleEvery: 0,
  pongDelayMs: 2,
  sim: false,
  seed: 12345,
  maxChunk: 200,
};

const MIN_HZ = 100;
const MAX_HZ = 1000;
const MAX_COMMAND = 39;

/** The firmware: commands in, text out, as time passes. No streams; MockSerialPort wraps it. */
export class MockFirmware {
  readonly options: Required<MockBoardOptions>;
  signal: MockSignal = { contraction: 0, flat: false, saturated: false };
  streaming = false;
  simulate: boolean;
  private periodMs: number;
  private counter = 0;
  private lastCounter = 0;
  private dropped = 0;
  private due = 0;
  private sinceStatus = 0;
  private lines = 0;
  private seed: number;
  private elapsedMs = 0;
  private replies: { at: number; text: string }[] = [];
  private pending = "";
  /** Commands received, for tests. */
  readonly received: string[] = [];

  constructor(options: MockBoardOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.simulate = this.options.sim;
    this.seed = this.options.seed;
    this.periodMs = ticksFor(this.options.rateHz);
  }

  get rateHz(): number {
    return Math.round(1000 / this.periodMs);
  }

  /** The start-up line (the board prints it after a reset). */
  bootText(): string {
    return this.infoLine();
  }

  /** Bytes the browser wrote: whole lines become commands. */
  write(text: string): void {
    const parts = (this.pending + text).split("\n");
    this.pending = parts.pop() ?? "";
    for (const part of parts) this.command(part.replace(/\r/g, ""));
  }

  private command(rawLine: string): void {
    if (rawLine.length > MAX_COMMAND) {
      this.reply("ERR,TOO_LONG");
      return;
    }
    const command = rawLine.toUpperCase().trim();
    if (command === "") return;
    this.received.push(command);
    if (command === "START") {
      this.streaming = true;
      this.counter = 0;
      this.lastCounter = 0;
      this.dropped = 0;
      this.due = 0;
      this.reply("OK,START");
    } else if (command === "STOP") {
      this.streaming = false;
      this.reply("OK,STOP");
    } else if (command === "PING") {
      this.reply(`PONG,${MOCK_VERSION}`, this.options.pongDelayMs);
    } else if (/^RATE( |$)/.test(command)) {
      const value = command.slice(4).trim();
      const hz = /^\d+$/.test(value) ? Number(value) : NaN;
      if (!(hz >= MIN_HZ && hz <= MAX_HZ)) {
        this.reply("ERR,RATE,100-1000");
        return;
      }
      this.periodMs = ticksFor(hz);
      this.reply(`OK,RATE,${this.rateHz}`);
    } else if (command === "SIM ON") {
      this.simulate = true;
      this.reply("OK,SIM,ON");
    } else if (command === "SIM OFF") {
      this.simulate = false;
      this.reply("OK,SIM,OFF");
    } else if (command === "INFO") {
      this.reply(this.infoLine().trimEnd());
    } else {
      this.reply(`ERR,UNKNOWN,${command}`);
    }
  }

  private reply(line: string, delayMs = 0): void {
    this.replies.push({ at: this.elapsedMs + delayMs, text: `${line}\n` });
  }

  private infoLine(): string {
    return (
      `I,version=${MOCK_VERSION},rate=${this.rateHz},mode=${this.simulate ? "SIM" : "ADC"},` +
      `streaming=${this.streaming ? 1 : 0},pin=34,baud=230400,core=3.x,queue=512\n`
    );
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** The firmware's own simulated envelope (simulatedMillivolts in the .ino). */
  private simulatedMv(counter: number): number {
    const t = Math.floor((counter * 1000) / this.rateHz) % 4000;
    let shape = 0;
    if (t < 250) shape = 0.5 - 0.5 * Math.cos((Math.PI * t) / 250);
    else if (t < 1250) shape = 1;
    else if (t < 1500) shape = 0.5 + 0.5 * Math.cos((Math.PI * (t - 1250)) / 250);
    const noise = Math.floor(this.random() * 31) - 15;
    const tremor = 40 * shape * Math.sin((2 * Math.PI * 6 * t) / 1000);
    return clampMv(200 + 1600 * shape + tremor + noise);
  }

  private sensorMv(): number {
    const { restMv, mvcMv, noiseMv } = this.options;
    const { contraction, flat, saturated } = this.signal;
    if (flat) return restMv;
    if (saturated) return 3300;
    const level = restMv + (mvcMv - restMv) * Math.max(0, contraction);
    return clampMv(level + (this.random() * 2 - 1) * noiseMv);
  }

  /** The text the board prints over the next `ms`. */
  advance(ms: number): string {
    let out = "";
    const end = this.elapsedMs + ms;
    // Samples and status lines, in time order, a millisecond at a time is plenty.
    while (this.elapsedMs < end) {
      const step = Math.min(1, end - this.elapsedMs);
      this.elapsedMs += step;
      out += this.flushReplies();
      if (this.streaming) {
        this.due += (step / this.periodMs) * this.options.rateScale;
        while (this.due >= 1) {
          this.due -= 1;
          out += this.sampleLine();
        }
      }
      this.sinceStatus += step;
      if (this.sinceStatus >= 1000) {
        this.sinceStatus -= 1000;
        this.dropped += this.streaming ? this.options.firmwareDropsPerSecond : 0;
        out += `S,${this.lastCounter},${this.dropped},${MOCK_VERSION},${this.simulate ? "SIM" : "ADC"}\n`;
      }
    }
    return out + this.flushReplies();
  }

  private flushReplies(): string {
    let out = "";
    while (this.replies.length > 0 && this.replies[0]!.at <= this.elapsedMs) {
      out += this.replies.shift()!.text;
    }
    return out;
  }

  private sampleLine(): string {
    const counter = this.counter++;
    const { dropEvery, garbleEvery } = this.options;
    if (dropEvery > 0 && counter > 0 && counter % dropEvery === 0) return ""; // lost on the way
    this.lastCounter = counter;
    const mv = this.simulate ? this.simulatedMv(counter) : this.sensorMv();
    const line = `E,${counter},${Math.round(mv)}\n`;
    this.lines += 1;
    if (garbleEvery > 0 && this.lines % garbleEvery === 0) {
      // Half cut short (a broken line), half junk bytes: both lose this sample.
      return this.lines % (2 * garbleEvery) === 0 ? `E,${counter}\n` : "E,ÿ#\u0000,9x\n";
    }
    return line;
  }
}

function ticksFor(hz: number): number {
  return Math.max(1, Math.round(1000 / hz));
}

function clampMv(mv: number): number {
  return Math.min(3300, Math.max(0, mv));
}

/** The mock board behind the Web Serial port interface (SerialPortLike). */
export class MockSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly firmware: MockFirmware;
  baudRate: number | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private seed: number;

  constructor(options: MockBoardOptions = {}) {
    this.firmware = new MockFirmware(options);
    this.seed = this.firmware.options.seed + 7;
  }

  get isOpen(): boolean {
    return this.controller !== null;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.controller) throw new DOMException("The port is already open.", "InvalidStateError");
    this.baudRate = options.baudRate;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    const decoder = new TextDecoder();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        // The wrong speed would only give garbage on a real board.
        if (this.baudRate === 230400) this.firmware.write(decoder.decode(chunk));
      },
    });
    // Opening the port resets an ESP32 DevKit: it prints its start-up line.
    this.deliver(this.firmware.bootText());
  }

  async close(): Promise<void> {
    try {
      this.controller?.close();
    } catch {
      // Already closed or errored.
    }
    this.controller = null;
    this.readable = null;
    this.writable = null;
  }

  /** Lets `ms` of board time pass and delivers what it printed, in USB-sized chunks. */
  advance(ms: number): void {
    const text = this.firmware.advance(ms);
    if (this.controller) this.deliver(text);
  }

  /** The cable is pulled: reading fails, as Chrome reports a lost device. */
  unplug(): void {
    try {
      this.controller?.error(new DOMException("The device has been lost.", "NetworkError"));
    } catch {
      // Already closed.
    }
    this.controller = null;
  }

  private deliver(text: string): void {
    const bytes = new TextEncoder().encode(text);
    let index = 0;
    while (index < bytes.length) {
      this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
      const size = 1 + (this.seed % this.firmware.options.maxChunk);
      this.controller?.enqueue(bytes.slice(index, index + size));
      index += size;
    }
  }
}

/**
 * navigator.serial with one mock board. unplug() and replug() fire the browser's disconnect and
 * connect events; plugging back in gives a freshly reset board (a new port object, like Chrome).
 */
export class MockSerial implements SerialLike {
  port: MockSerialPort;
  /** The chooser is closed without choosing. */
  refuse = false;
  private readonly options: MockBoardOptions;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  private plugged = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MockBoardOptions = {}) {
    this.options = options;
    this.port = new MockSerialPort(options);
  }

  /** What the forearm does from now on (kept across unplugging and plugging back in). */
  setSignal(signal: Partial<MockSignal>): void {
    this.port.firmware.signal = { ...this.port.firmware.signal, ...signal };
  }

  async requestPort(): Promise<SerialPortLike> {
    if (this.refuse || !this.plugged) {
      throw new DOMException("No port selected by the user.", "NotFoundError");
    }
    return this.port;
  }

  async getPorts(): Promise<SerialPortLike[]> {
    return this.plugged ? [this.port] : [];
  }

  addEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Board time for the port (see MockSerialPort.advance). */
  advance(ms: number): void {
    if (this.plugged) this.port.advance(ms);
  }

  unplug(): void {
    if (!this.plugged) return;
    this.plugged = false;
    const port = this.port;
    port.unplug();
    this.fire("disconnect", port);
  }

  /** Plugged back in: a new, freshly reset board with the same options and signal. */
  replug(): void {
    if (this.plugged) return;
    const signal = this.port.firmware.signal;
    this.port = new MockSerialPort(this.options);
    this.port.firmware.signal = signal;
    this.plugged = true;
    this.fire("connect", this.port);
  }

  /** Follows the real clock (development pages): advance() every `intervalMs`. */
  autoRun(intervalMs = 20): () => void {
    this.stopAutoRun();
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.advance(now - last);
      last = now;
    }, intervalMs);
    return () => this.stopAutoRun();
  }

  stopAutoRun(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private fire(type: "connect" | "disconnect", port: MockSerialPort): void {
    const event = { type, target: port } as unknown as Event;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}
