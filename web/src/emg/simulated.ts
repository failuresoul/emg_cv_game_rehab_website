/**
 * A pretend ESP32 in the browser, for working without the sensor. It behaves like the firmware:
 * 500 Hz envelope samples with a counter, a status line each second, and answers to START, STOP,
 * PING, RATE, SIM and INFO. Holding the M key contracts the "muscle" over 300 ms; releasing it
 * relaxes over 300 ms.
 *
 * Only in development builds, or when the "simulated EMG" setting is on (isSimulatedEmgAllowed).
 */

import type { EmgCommand } from "./protocol";
import { type EmgEvent, type EmgStream, EventHub } from "./stream";

export const SIMULATED_VERSION = "sim-1.0.0";
export const SIMULATED_HZ = 500;
export const RAMP_MS = 300;
export const REST_MV = 200;
export const CONTRACTION_MV = 1800;
const TICK_MS = 20;
const SETTING_KEY = "muvi-simulated-emg";

/** True in development, or when the setting is on (localStorage "muvi-simulated-emg" = "on"). */
export function isSimulatedEmgAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(SETTING_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSimulatedEmgAllowed(on: boolean): void {
  try {
    if (on) localStorage.setItem(SETTING_KEY, "on");
    else localStorage.removeItem(SETTING_KEY);
  } catch {
    // Only a convenience.
  }
}

export interface SimulatedOptions {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  random?: () => number;
  /** Where the M key is listened to; none in tests. */
  keys?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

export class SimulatedEmgStream implements EmgStream {
  readonly kind = "simulated" as const;
  private readonly hub = new EventHub();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly random: () => number;
  private readonly keys: SimulatedOptions["keys"];
  private timer: unknown = null;
  private isConnected = false;
  private streaming = false;
  private rateHz = SIMULATED_HZ;
  private counter = 0;
  private startedAt = 0;
  private lastTick = 0;
  private lastStatus = 0;
  private level = 0;
  private pressed = false;

  constructor(options: SimulatedOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setInterval(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
    this.random = options.random ?? Math.random;
    this.keys =
      options.keys === undefined ? (typeof window === "undefined" ? null : window) : options.keys;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  subscribe(listener: (event: EmgEvent) => void): () => void {
    return this.hub.subscribe(listener);
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.isConnected = true;
    this.lastTick = this.lastStatus = this.now();
    this.keys?.addEventListener("keydown", this.onKeyDown);
    this.keys?.addEventListener("keyup", this.onKeyUp);
    this.timer = this.setTimer(() => this.tick(), TICK_MS);
    this.hub.emit({ type: "connected" });
    this.hub.emit({ type: "info", fields: this.info() });
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.streaming = false;
    this.clearTimer(this.timer);
    this.timer = null;
    this.keys?.removeEventListener("keydown", this.onKeyDown);
    this.keys?.removeEventListener("keyup", this.onKeyUp);
    this.hub.emit({ type: "disconnected", error: null });
  }

  /** Contracts (true) or relaxes (false), as holding the M key does. */
  setPressed(pressed: boolean): void {
    this.pressed = pressed;
  }

  async send(command: EmgCommand): Promise<void> {
    const upper = command.toUpperCase();
    if (upper === "START") {
      this.streaming = true;
      this.counter = 0;
      this.startedAt = this.now();
      this.hub.emit({ type: "ok", detail: "START" });
    } else if (upper === "STOP") {
      this.streaming = false;
      this.hub.emit({ type: "ok", detail: "STOP" });
    } else if (upper === "PING") {
      this.hub.emit({ type: "pong", version: SIMULATED_VERSION });
    } else if (upper === "SIM ON" || upper === "SIM OFF") {
      this.hub.emit({ type: "ok", detail: `SIM,${upper.slice(4)}` });
    } else if (upper === "INFO") {
      this.hub.emit({ type: "info", fields: this.info() });
    } else if (upper.startsWith("RATE ")) {
      const hz = Number(upper.slice(5));
      if (!Number.isInteger(hz) || hz < 100 || hz > 1000) {
        this.hub.emit({ type: "error", detail: "RATE,100-1000" });
      } else {
        this.rateHz = Math.round(1000 / Math.max(1, Math.round(1000 / hz)));
        this.hub.emit({ type: "ok", detail: `RATE,${this.rateHz}` });
      }
    } else {
      this.hub.emit({ type: "error", detail: `UNKNOWN,${upper}` });
    }
  }

  /** Makes every sample due by now (the timer only paces delivery, like USB bursts). */
  tick(): void {
    if (!this.isConnected) return;
    const now = this.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    // Towards 1 while pressed, towards 0 when released, over RAMP_MS.
    const step = elapsed / RAMP_MS;
    this.level = this.pressed ? Math.min(1, this.level + step) : Math.max(0, this.level - step);

    if (this.streaming) {
      const due = Math.floor(((now - this.startedAt) * this.rateHz) / 1000);
      const samples: { counter: number; mv: number }[] = [];
      while (this.counter < due) {
        samples.push({ counter: this.counter, mv: this.envelope() });
        this.counter += 1;
      }
      if (samples.length > 0) this.hub.emit({ type: "samples", samples, arrivalMs: now });
    }
    if (now - this.lastStatus >= 1000) {
      this.lastStatus = now;
      this.hub.emit({
        type: "status",
        counter: Math.max(0, this.counter - 1),
        dropped: 0,
        version: SIMULATED_VERSION,
        mode: "SIM",
      });
    }
  }

  private envelope(): number {
    const noise = (this.random() - 0.5) * 30; // about +-15 mV
    const mv = REST_MV + (CONTRACTION_MV - REST_MV) * this.level + noise;
    return Math.round(Math.min(3300, Math.max(0, mv)));
  }

  private info(): Record<string, string> {
    return {
      version: SIMULATED_VERSION,
      rate: String(this.rateHz),
      mode: "SIM",
      streaming: this.streaming ? "1" : "0",
    };
  }

  private readonly onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key?.toLowerCase() === "m") this.pressed = true;
  };

  private readonly onKeyUp = (event: Event): void => {
    if ((event as KeyboardEvent).key?.toLowerCase() === "m") this.pressed = false;
  };
}
