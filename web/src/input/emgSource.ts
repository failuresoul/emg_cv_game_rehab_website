import { clamp01, LevelListeners, type LevelSource } from "./types";

/**
 * Which muscle group drives the level: the forearm flexors close the hand (grip), the extensors
 * open it (openness). It must match the site the session's EMG calibration was made at.
 */
export type EmgChannel = "flexor" | "extensor";

const SITE_FOR: Record<EmgChannel, "flexors" | "extensors"> = {
  flexor: "flexors",
  extensor: "extensors",
};

/** The level's smoothing: level += ALPHA x (target - level), 50 times a second. */
export const EMG_ALPHA = 0.3;
export const EMG_TICK_MS = 20;
/** Paused when more than this share (percent) of the last second's samples were lost. */
export const EMG_MAX_GAPS_PCT = 1;

/** The part of the EMG engine (emg/engine.ts) a source reads. */
export interface EmgReading {
  getStatus(): {
    connected: boolean;
    streaming: boolean;
    electrodeOff: boolean;
    calibrated: boolean;
  };
  readonly percentMvc: number | null;
  readonly site: "flexors" | "extensors" | null;
  arrivalStats(windowMs: number): { gapsPct: number; received: number };
}

/** %MVC as a level: 100 %MVC is a full squeeze (or a fully open hand). */
export function percentToLevel(percentMvc: number | null): number {
  return percentMvc === null ? 0 : clamp01(percentMvc / 100);
}

export interface EmgSourceOptions {
  channel?: EmgChannel;
  engine?: EmgReading | null;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/**
 * The muscle sensor as a level source, once the session has an EMG calibration at this channel's
 * site: level = clamp(%MVC / 100, 0, 1), smoothed. Not ready (so the input manager falls back to
 * the camera) while disconnected, uncalibrated, at the other site, with an electrode off, or with
 * more than 1% of the last second's samples lost; ready again as soon as that clears.
 */
export class EmgSource implements LevelSource<"emg"> {
  readonly id = "emg";
  readonly labelKey = "input.source.emg";
  readonly channel: EmgChannel;
  private readonly engine: EmgReading | null;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly listeners = new LevelListeners();
  private timer: unknown = null;
  private level = 0;

  constructor({
    channel = "flexor",
    engine = null,
    setTimer = (callback, ms) => setInterval(callback, ms),
    clearTimer = (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  }: EmgSourceOptions = {}) {
    this.channel = channel;
    this.engine = engine;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  /** Calibrated at this channel's site today: the source to prefer. It may still be paused
   * (unplugged, an electrode off), when the input manager uses the camera until it recovers. */
  isAvailable(): boolean {
    const engine = this.engine;
    if (!engine) return false;
    return engine.getStatus().calibrated && engine.site === SITE_FOR[this.channel];
  }

  isReady(): boolean {
    const engine = this.engine;
    if (!engine || !this.isAvailable()) return false;
    const status = engine.getStatus();
    if (!status.connected || !status.streaming || status.electrodeOff) return false;
    const lastSecond = engine.arrivalStats(1000);
    return lastSecond.received > 0 && lastSecond.gapsPct <= EMG_MAX_GAPS_PCT;
  }

  getLevel(): number {
    return this.isReady() ? this.level : 0;
  }

  /** One smoothing step: towards the latest %MVC. */
  tick(): void {
    const target = this.isReady() ? percentToLevel(this.engine?.percentMvc ?? null) : 0;
    this.level += EMG_ALPHA * (target - this.level);
    this.listeners.emit(this.getLevel());
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => this.tick(), EMG_TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
    this.level = 0;
  }

  subscribe(listener: (level: number) => void): () => void {
    return this.listeners.add(listener);
  }
}
