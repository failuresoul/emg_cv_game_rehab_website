/**
 * The one EMG pipeline of the app: a stream (the ESP32 over Web Serial, or the simulated one) ->
 * sample times from the counter -> 50 ms smoothing -> %MVC once calibrated -> onset events, with
 * the last 10 s kept in ring buffers and a status for the screens.
 *
 * Plain TypeScript (no React), so it is tested by feeding it events; EmgProvider shares one.
 */

import { SampleClock } from "./clock";
import {
  type EmgCalibration,
  isFlatLine,
  isSaturating,
  MovingAverage,
  type OnsetEvent,
  OnsetDetector,
  percentMvc,
  RingBuffer,
} from "./processing";
import type { DeviceMode, EmgCommand } from "./protocol";
import { SerialEmgStream } from "./serial";
import { SimulatedEmgStream } from "./simulated";
import {
  EmgError,
  type EmgErrorCode,
  type EmgEvent,
  type EmgSourceKind,
  type EmgStream,
} from "./stream";

export const BUFFER_SECONDS = 10;
export const DEFAULT_FS = 500;
/** How often the status (and the screens reading it) may change. */
const STATUS_INTERVAL_MS = 250;

export interface EmgStatus {
  connected: boolean;
  source: EmgSourceKind | null;
  streaming: boolean;
  /** Measured samples per second; null until a second has passed. */
  sampleRate: number | null;
  /** Samples lost on the way, as a share of those expected (0-100). */
  gapsPct: number;
  /** Samples the ESP32 itself could not send (its status line). */
  dropped: number;
  saturation: boolean;
  electrodeOff: boolean;
  firmwareVersion: string | null;
  mode: DeviceMode | null;
  calibrated: boolean;
  /** The latest %MVC, refreshed with the status; null until calibrated. */
  percentMvc: number | null;
  error: EmgErrorCode | null;
}

export const IDLE_STATUS: EmgStatus = {
  connected: false,
  source: null,
  streaming: false,
  sampleRate: null,
  gapsPct: 0,
  dropped: 0,
  saturation: false,
  electrodeOff: false,
  firmwareVersion: null,
  mode: null,
  calibrated: false,
  percentMvc: null,
  error: null,
};

/** The last PING: when it was sent and when the firmware answered. */
export interface PingState {
  sentAt: number | null;
  answeredAt: number | null;
  version: string | null;
}

/** Arrivals over a recent window, measured as samples come in (not from the sample clock). */
export interface ArrivalStats {
  /** Samples per second that arrived in the window; 0 when none did. */
  rateHz: number;
  /** Samples missing between those received, as a share of those expected (0-100). */
  gapsPct: number;
  received: number;
}

/** How long arrivals are remembered (the longest readiness window is 5 s). */
const ARRIVAL_MEMORY_MS = 6000;

export interface RecentSignal {
  t: Float64Array;
  mv: Float64Array;
  envelope: Float64Array;
  /** %MVC per sample; NaN before calibration. */
  percent: Float64Array;
}

export class EmgEngine {
  private readonly now: () => number;
  private stream: EmgStream | null = null;
  private pingState: PingState = { sentAt: null, answeredAt: null, version: null };
  private arrivals: { at: number; received: number; missing: number }[] = [];
  private calibratedSite: "flexors" | "extensors" | null = null;
  private unsubscribe: (() => void) | null = null;
  private fs = DEFAULT_FS;
  private clock = new SampleClock(DEFAULT_FS);
  private smoother = new MovingAverage(DEFAULT_FS);
  private times = new RingBuffer(DEFAULT_FS * BUFFER_SECONDS);
  private raw = new RingBuffer(DEFAULT_FS * BUFFER_SECONDS);
  private smooth = new RingBuffer(DEFAULT_FS * BUFFER_SECONDS);
  private percents = new RingBuffer(DEFAULT_FS * BUFFER_SECONDS);
  private calibration: EmgCalibration | null = null;
  private onset: OnsetDetector | null = null;
  private status: EmgStatus = IDLE_STATUS;
  private lastStatusAt = -Infinity;
  private latestEnvelope = 0;
  private latestPercent: number | null = null;
  private readonly statusListeners = new Set<() => void>();
  private readonly onsetListeners = new Set<(event: OnsetEvent) => void>();
  private readonly eventListeners = new Set<(event: EmgEvent) => void>();

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  // ---- Reading -------------------------------------------------------------------------------

  getStatus(): EmgStatus {
    return this.status;
  }

  /** The latest smoothed envelope (mV). */
  get envelopeMv(): number {
    return this.latestEnvelope;
  }

  /** The latest %MVC (0-120), every sample; null before calibration. */
  get percentMvc(): number | null {
    return this.latestPercent;
  }

  get sampleRateHz(): number {
    return this.fs;
  }

  get sourceKind(): EmgSourceKind | null {
    return this.stream?.kind ?? null;
  }

  getPing(): PingState {
    return this.pingState;
  }

  /** Samples that arrived in the last `windowMs` before `nowMs`. */
  arrivalStats(windowMs: number, nowMs: number = this.now()): ArrivalStats {
    let received = 0;
    let missing = 0;
    for (const arrival of this.arrivals) {
      if (arrival.at > nowMs - windowMs && arrival.at <= nowMs) {
        received += arrival.received;
        missing += arrival.missing;
      }
    }
    const expected = received + missing;
    return {
      rateHz: (received * 1000) / windowMs,
      gapsPct: expected > 0 ? (missing / expected) * 100 : 0,
      received,
    };
  }

  /** The last `seconds` of the signal (at most 10 s), oldest first. */
  recent(seconds = BUFFER_SECONDS): RecentSignal {
    const count = Math.round(seconds * this.fs);
    return {
      t: this.times.last(count),
      mv: this.raw.last(count),
      envelope: this.smooth.last(count),
      percent: this.percents.last(count),
    };
  }

  subscribe(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onOnset(listener: (event: OnsetEvent) => void): () => void {
    this.onsetListeners.add(listener);
    return () => {
      this.onsetListeners.delete(listener);
    };
  }

  /** Every firmware event, for the development lab's log. */
  onEvent(listener: (event: EmgEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  // ---- Connecting ----------------------------------------------------------------------------

  /** The ESP32: shows the browser's port chooser (call from a click), then starts streaming. */
  async connectSerial(stream: EmgStream = new SerialEmgStream()): Promise<void> {
    await this.use(stream, () => stream.connect());
  }

  /** Opens the ESP32 chosen before, after it was unplugged. */
  async reconnectSerial(): Promise<void> {
    const stream = this.stream instanceof SerialEmgStream ? this.stream : new SerialEmgStream();
    await this.use(stream, async () => {
      if (!(await stream.reconnect())) throw new EmgError("no_port");
    });
  }

  async connectSimulated(stream: EmgStream = new SimulatedEmgStream()): Promise<void> {
    await this.use(stream, () => stream.connect());
  }

  private async use(stream: EmgStream, open: () => Promise<void>): Promise<void> {
    if (this.stream && this.stream !== stream) await this.disconnect();
    this.attach(stream);
    try {
      await open();
      await this.ping();
      await stream.send("START");
    } catch (error) {
      const code = error instanceof EmgError ? error.code : "open_failed";
      this.setStatus({ ...this.status, connected: stream.connected, error: code }, true);
      if (!stream.connected) this.detach();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const stream = this.stream;
    if (!stream) return;
    await stream.disconnect();
    this.detach();
    this.setStatus({ ...IDLE_STATUS, calibrated: this.calibration !== null }, true);
  }

  async send(command: EmgCommand): Promise<void> {
    if (!this.stream) throw new EmgError("write_failed", "Not connected");
    if (command === "PING") {
      await this.ping();
      return;
    }
    await this.stream.send(command);
  }

  /** Sends PING and notes the time, so the answer's delay is known. */
  async ping(): Promise<void> {
    if (!this.stream) throw new EmgError("write_failed", "Not connected");
    this.pingState = { sentAt: this.now(), answeredAt: null, version: null };
    await this.stream.send("PING");
  }

  /** Feeds a stream's events in; public so tests can drive the engine. */
  attach(stream: EmgStream): void {
    this.detach();
    this.stream = stream;
    this.unsubscribe = stream.subscribe((event) => this.handle(event));
    this.resetSignal(this.fs);
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stream = null;
  }

  // ---- Calibration ---------------------------------------------------------------------------

  setCalibration(calibration: EmgCalibration | null): void {
    this.calibration = calibration;
    this.onset = calibration ? new OnsetDetector(calibration) : null;
    this.latestPercent = calibration ? percentMvc(this.latestEnvelope, calibration) : null;
    this.setStatus(
      { ...this.status, calibrated: calibration !== null, percentMvc: this.latestPercent },
      true,
    );
  }

  getCalibration(): EmgCalibration | null {
    return this.calibration;
  }

  /** The electrode site of today's calibration ("flexors" drive grip, "extensors" opening). */
  /** Today's calibration (rest and MVC, mV), or null before it. */
  get calibrationValues(): EmgCalibration | null {
    return this.calibration;
  }

  get site(): "flexors" | "extensors" | null {
    return this.calibratedSite;
  }

  setSite(site: "flexors" | "extensors" | null): void {
    this.calibratedSite = site;
    // The input sources choose the sensor from the site: tell them.
    this.statusListeners.forEach((listener) => listener());
  }

  // ---- Events --------------------------------------------------------------------------------

  handle(event: EmgEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
    switch (event.type) {
      case "connected":
        this.setStatus(
          {
            ...IDLE_STATUS,
            connected: true,
            source: this.stream?.kind ?? null,
            calibrated: this.calibration !== null,
          },
          true,
        );
        break;
      case "disconnected":
        this.setStatus(
          {
            ...this.status,
            connected: false,
            streaming: false,
            sampleRate: null,
            error: event.error,
          },
          true,
        );
        break;
      case "pong":
        this.pingState = { ...this.pingState, answeredAt: this.now(), version: event.version };
        this.setStatus({ ...this.status, firmwareVersion: event.version }, true);
        break;
      case "info": {
        const rate = Number(event.fields.rate);
        if (Number.isFinite(rate) && rate > 0 && rate !== this.fs) this.resetSignal(rate);
        const version = event.fields.version ?? this.status.firmwareVersion;
        const mode =
          event.fields.mode === "SIM" || event.fields.mode === "ADC"
            ? event.fields.mode
            : this.status.mode;
        this.setStatus({ ...this.status, firmwareVersion: version, mode }, true);
        break;
      }
      case "ok":
        if (event.detail === "START") {
          this.resetSignal(this.fs);
          this.setStatus({ ...this.status, streaming: true, error: null }, true);
        } else if (event.detail === "STOP") {
          this.setStatus({ ...this.status, streaming: false }, true);
        } else if (event.detail.startsWith("RATE,")) {
          const rate = Number(event.detail.slice(5));
          if (Number.isFinite(rate) && rate > 0) this.resetSignal(rate);
        }
        break;
      case "status":
        this.setStatus(
          {
            ...this.status,
            dropped: event.dropped,
            mode: event.mode,
            firmwareVersion: this.status.firmwareVersion ?? event.version,
          },
          true,
        );
        break;
      case "samples":
        this.addSamples(event.samples, event.arrivalMs);
        break;
      default:
        break;
    }
  }

  private addSamples(samples: { counter: number; mv: number }[], arrivalMs: number): void {
    const missingBefore = this.clock.stats().missing;
    let received = 0;
    for (const { counter, mv } of samples) {
      const t = this.clock.push(counter, arrivalMs);
      if (t === null) continue;
      received += 1;
      const envelope = this.smoother.push(mv);
      this.latestEnvelope = envelope;
      this.times.push(t);
      this.raw.push(mv);
      this.smooth.push(envelope);
      if (this.calibration) {
        this.latestPercent = percentMvc(envelope, this.calibration);
        this.percents.push(this.latestPercent);
        const change = this.onset?.push(t, envelope) ?? null;
        if (change) this.onsetListeners.forEach((listener) => listener(change));
      } else {
        this.percents.push(Number.NaN);
      }
    }
    this.arrivals.push({
      at: arrivalMs,
      received,
      missing: Math.max(0, this.clock.stats().missing - missingBefore),
    });
    while (this.arrivals.length > 0 && this.arrivals[0]!.at < arrivalMs - ARRIVAL_MEMORY_MS) {
      this.arrivals.shift();
    }
    this.refreshStatus(arrivalMs);
  }

  /** The signal flags and rates, at most four times a second. */
  private refreshStatus(nowMs: number): void {
    if (nowMs - this.lastStatusAt < STATUS_INTERVAL_MS) return;
    this.lastStatusAt = nowMs;
    const lastSecond = this.raw.last(this.fs);
    const stats = this.clock.stats();
    this.setStatus(
      {
        ...this.status,
        streaming: true,
        sampleRate: stats.measuredHz === null ? null : Math.round(stats.measuredHz),
        gapsPct: Math.round(stats.gapsPct * 100) / 100,
        saturation: isSaturating(lastSecond),
        electrodeOff: isFlatLine(lastSecond, Math.round(this.fs / 2)),
        percentMvc: this.latestPercent,
      },
      true,
    );
  }

  private resetSignal(fs: number): void {
    this.fs = fs;
    this.clock = new SampleClock(fs);
    this.smoother = new MovingAverage(fs);
    const capacity = Math.round(fs * BUFFER_SECONDS);
    this.times = new RingBuffer(capacity);
    this.raw = new RingBuffer(capacity);
    this.smooth = new RingBuffer(capacity);
    this.percents = new RingBuffer(capacity);
    this.arrivals = [];
    this.lastStatusAt = -Infinity;
    if (this.calibration) this.onset = new OnsetDetector(this.calibration);
  }

  private setStatus(next: EmgStatus, notify: boolean): void {
    this.status = next;
    if (notify) this.statusListeners.forEach((listener) => listener());
  }
}
