import { clamp01 } from "./types";

/** How far below the demand the level may dip without ending a hold. */
export const DEFAULT_ACTIVATION_HYSTERESIS = 0.05;

export interface ActivationDetectorConfig {
  /** The level to reach, from 0 to 1. */
  demand: number;
  /** How long the level must stay at the demand. */
  holdMs: number;
  /** How long, from the window's start, the patient has to complete the hold. */
  windowMs: number;
  hysteresis?: number;
}

export type ActivationStatus = "waiting" | "holding" | "activated" | "failed";

export interface ActivationState {
  status: ActivationStatus;
  /** How much of the hold is done, from 0 to 1. */
  holdProgress: number;
  /**
   * From the window's start to the start of the hold that succeeded, in ms. Null until activated.
   * The same moment as onsetMs; latency is the name used in saved metrics.
   */
  latencyMs: number | null;
  /** When the successful hold began, relative to the window's start. Null until activated. */
  onsetMs: number | null;
  /** When the hold was complete, relative to the window's start. Null until activated. */
  doneMs: number | null;
  /** The highest level seen in the window. */
  peakLevel: number;
}

/**
 * Decides whether the patient activated: the level stays at or above the demand for holdMs before
 * the window ends. Once begun, a hold survives dips of up to the hysteresis below the demand, so
 * tracking noise does not reset it. Pure: call start() and then update() with each frame's time.
 */
export class ActivationDetector {
  private readonly demand: number;
  private readonly holdMs: number;
  private readonly windowMs: number;
  private readonly keepLevel: number;
  private windowStart: number | null = null;
  private holdStart: number | null = null;
  private state: ActivationState = ActivationDetector.initialState();

  constructor({
    demand,
    holdMs,
    windowMs,
    hysteresis = DEFAULT_ACTIVATION_HYSTERESIS,
  }: ActivationDetectorConfig) {
    if (!(holdMs >= 0)) throw new RangeError(`holdMs (${holdMs}) must be 0 or more`);
    if (!(windowMs > 0)) throw new RangeError(`windowMs (${windowMs}) must be above 0`);
    if (!(hysteresis >= 0)) throw new RangeError(`hysteresis (${hysteresis}) must be 0 or more`);
    this.demand = clamp01(demand);
    this.holdMs = holdMs;
    this.windowMs = windowMs;
    this.keepLevel = Math.max(0, this.demand - hysteresis);
  }

  private static initialState(): ActivationState {
    return {
      status: "waiting",
      holdProgress: 0,
      latencyMs: null,
      onsetMs: null,
      doneMs: null,
      peakLevel: 0,
    };
  }

  get current(): ActivationState {
    return { ...this.state };
  }

  /** Opens a new window, forgetting any earlier one. */
  start(now: number): ActivationState {
    this.windowStart = now;
    this.holdStart = null;
    this.state = ActivationDetector.initialState();
    return this.current;
  }

  /** One frame's level. Once activated or failed, the result no longer changes. */
  update(level: number, now: number): ActivationState {
    if (this.windowStart === null) throw new Error("Call start() before update()");
    const { status } = this.state;
    if (status === "activated" || status === "failed") return this.current;

    const value = clamp01(level);
    const elapsed = now - this.windowStart;
    const inWindow = elapsed <= this.windowMs;
    if (inWindow) this.state.peakLevel = Math.max(this.state.peakLevel, value);

    if (this.holdStart === null) {
      if (inWindow && value >= this.demand) this.holdStart = now;
    } else if (value < this.keepLevel) {
      this.holdStart = null;
    }

    if (this.holdStart !== null) {
      const held = now - this.holdStart;
      // Only the part of the hold inside the window counts.
      const doneAt = this.holdStart + this.holdMs;
      if (held >= this.holdMs && doneAt - this.windowStart <= this.windowMs) {
        const onsetMs = this.holdStart - this.windowStart;
        this.state = {
          ...this.state,
          status: "activated",
          holdProgress: 1,
          latencyMs: onsetMs,
          onsetMs,
          doneMs: doneAt - this.windowStart,
        };
        return this.current;
      }
      this.state.holdProgress = this.holdMs > 0 ? Math.min(1, held / this.holdMs) : 1;
    } else {
      this.state.holdProgress = 0;
    }

    if (!inWindow || elapsed >= this.windowMs) {
      this.state = { ...this.state, status: "failed", holdProgress: 0 };
      return this.current;
    }
    this.state.status = this.holdStart === null ? "waiting" : "holding";
    return this.current;
  }
}
