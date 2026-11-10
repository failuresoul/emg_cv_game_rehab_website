import { ActivationDetector, type ActivationState } from "@/input/activationDetector";

import type { BloomParams } from "./params";

/** The full bloom and its sparkle show this long before the closing phase begins. */
export const BLOOM_MS = 1000;
/** The seed flies to the basket in this time. */
export const SEED_FLIGHT_MS = 900;
/** A bud that was not finished fades away calmly over this time. */
export const MISS_MS = 1500;

export type BloomPhase =
  /** The bud opens live with the hand; the hand must stay open enough for the hold time. */
  | "OPEN"
  /** Fully bloomed: sparkle and chime. */
  | "BLOOMED"
  /** "Make a fist to collect the seed." */
  | "CLOSE"
  /** The seed flies into the basket. */
  | "COLLECTED"
  /** A phase ran out of time. */
  | "MISSED"
  | "REST"
  | "DONE";

/** Which phase ran out of time. */
export type BloomFailPhase = "open" | "close";

const LIVE_PHASES: ReadonlySet<BloomPhase> = new Set(["OPEN", "BLOOMED", "CLOSE"]);

export type BloomSettings = Pick<
  BloomParams,
  "openDemand" | "openHoldMs" | "closeDemand" | "closeHoldMs" | "phaseTimeLimitMs" | "restMs"
>;

export interface BloomInput {
  nowMs: number;
  /** From 0 (fist) to 1 (fully open). */
  openness: number;
  /** From 0 (relaxed) to 1 (full squeeze). */
  grip: number;
}

/** Game-time moments of the trial; null until reached. */
export interface BloomMoments {
  spawn: number;
  /** When the hand reached the openness demand for the hold that made the flower bloom. */
  openOnset: number | null;
  /** The flower fully bloomed: the hold was complete. */
  bloomed: number | null;
  closeStart: number | null;
  /** When the grip reached its demand for the hold that collected the seed. */
  closeOnset: number | null;
  closeDone: number | null;
  end: number | null;
}

export interface OpennessSample {
  t: number;
  level: number;
}

export type BloomEvent =
  | { type: "phase"; phase: BloomPhase }
  | { type: "bloomed" }
  | { type: "collected" }
  | { type: "outcome"; outcome: "success" | "miss"; failedPhase: BloomFailPhase | null };

/**
 * One flower: OPEN → BLOOMED → CLOSE → COLLECTED → REST → DONE, or MISSED → REST → DONE when a
 * phase runs out of time. Each phase is an ActivationDetector: the level must stay at its demand
 * for the hold time within the phase's time limit, and a drop of more than the hysteresis below
 * the demand starts the hold again. Pure: feed it update() with each fixed step's input.
 */
export class BloomMachine {
  private readonly settings: BloomSettings;
  private current: BloomPhase = "OPEN";
  private readonly openDetector: ActivationDetector;
  private closeDetector: ActivationDetector | null = null;
  private openState: ActivationState;
  private closeState: ActivationState | null = null;
  private result: "success" | "miss" | null = null;
  private failed: BloomFailPhase | null = null;
  private phaseEnds = 0;
  private gripPeak: number | null = null;
  private readonly samples: OpennessSample[] = [];
  readonly moments: BloomMoments;

  constructor(settings: BloomSettings, spawnMs: number) {
    this.settings = settings;
    this.moments = {
      spawn: spawnMs,
      openOnset: null,
      bloomed: null,
      closeStart: null,
      closeOnset: null,
      closeDone: null,
      end: null,
    };
    this.openDetector = new ActivationDetector({
      demand: settings.openDemand,
      holdMs: settings.openHoldMs,
      windowMs: settings.phaseTimeLimitMs,
    });
    this.openState = this.openDetector.start(spawnMs);
  }

  get phase(): BloomPhase {
    return this.current;
  }

  /** True from OPEN to CLOSE: the trial is still being played. */
  get isLive(): boolean {
    return LIVE_PHASES.has(this.current);
  }

  get outcome(): "success" | "miss" | null {
    return this.result;
  }

  get failedPhase(): BloomFailPhase | null {
    return this.failed;
  }

  /** How much of the current phase's hold is done, from 0 to 1. */
  get holdProgress(): number {
    if (this.current === "OPEN") return this.openState.holdProgress;
    if (this.current === "CLOSE") return this.closeState?.holdProgress ?? 0;
    return 0;
  }

  /** How far the current phase or animation has gone, from 0 to 1, for drawing. */
  phaseProgress(nowMs: number): number {
    const length =
      this.current === "BLOOMED"
        ? BLOOM_MS
        : this.current === "COLLECTED"
          ? SEED_FLIGHT_MS
          : this.current === "MISSED"
            ? MISS_MS
            : 0;
    if (length <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - (this.phaseEnds - nowMs) / length));
  }

  /** Every openness reading of the opening phase, in order. */
  get opennessSamples(): readonly OpennessSample[] {
    return this.samples;
  }

  /** The highest grip of the closing phase; null if it never began. */
  get peakGrip(): number | null {
    return this.gripPeak;
  }

  update({ nowMs, openness, grip }: BloomInput): BloomEvent[] {
    const events: BloomEvent[] = [];
    const go = (phase: BloomPhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    switch (this.current) {
      case "OPEN": {
        this.samples.push({ t: nowMs, level: openness });
        const state = this.openDetector.update(openness, nowMs);
        this.openState = state;
        if (state.status === "activated") {
          this.moments.openOnset = this.moments.spawn + (state.onsetMs as number);
          this.moments.bloomed = this.moments.spawn + (state.doneMs as number);
          this.phaseEnds = nowMs + BLOOM_MS;
          events.push({ type: "bloomed" });
          go("BLOOMED");
        } else if (state.status === "failed") {
          this.miss("open", nowMs, events, go);
        }
        break;
      }
      case "BLOOMED":
        if (nowMs >= this.phaseEnds) {
          this.moments.closeStart = nowMs;
          this.closeDetector = new ActivationDetector({
            demand: this.settings.closeDemand,
            holdMs: this.settings.closeHoldMs,
            windowMs: this.settings.phaseTimeLimitMs,
          });
          this.closeState = this.closeDetector.start(nowMs);
          this.gripPeak = 0;
          go("CLOSE");
        }
        break;
      case "CLOSE": {
        const detector = this.closeDetector as ActivationDetector;
        const closeStart = this.moments.closeStart as number;
        const state = detector.update(grip, nowMs);
        this.closeState = state;
        this.gripPeak = Math.max(this.gripPeak ?? 0, state.peakLevel);
        if (state.status === "activated") {
          this.moments.closeOnset = closeStart + (state.onsetMs as number);
          this.moments.closeDone = closeStart + (state.doneMs as number);
          this.moments.end = nowMs;
          this.result = "success";
          this.phaseEnds = nowMs + SEED_FLIGHT_MS;
          events.push({ type: "collected" });
          events.push({ type: "outcome", outcome: "success", failedPhase: null });
          go("COLLECTED");
        } else if (state.status === "failed") {
          this.miss("close", nowMs, events, go);
        }
        break;
      }
      case "COLLECTED":
      case "MISSED":
        if (nowMs >= this.phaseEnds) {
          this.phaseEnds = nowMs + this.settings.restMs;
          go("REST");
        }
        break;
      case "REST":
        if (nowMs >= this.phaseEnds) go("DONE");
        break;
      default:
        break;
    }
    return events;
  }

  private miss(
    phase: BloomFailPhase,
    nowMs: number,
    events: BloomEvent[],
    go: (phase: BloomPhase) => void,
  ): void {
    this.result = "miss";
    this.failed = phase;
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + MISS_MS;
    events.push({ type: "outcome", outcome: "miss", failedPhase: phase });
    go("MISSED");
  }
}
