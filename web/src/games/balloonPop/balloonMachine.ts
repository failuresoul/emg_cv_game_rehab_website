import { ActivationDetector, type ActivationState } from "@/input/activationDetector";
import type { TrialOutcome } from "@/types/api";

import type { PopMode } from "./params";

/** How long the pop animation shows before the rest. */
export const POP_MS = 600;
/** How long a missed balloon takes to float away. */
export const FLOAT_AWAY_MS = 1500;

export type BalloonPhase =
  "SPAWN" | "RISE" | "HOVER" | "SQUEEZE" | "POPPED" | "FLOAT_AWAY" | "REST" | "DONE";

export interface BalloonSettings {
  riseMs: number;
  hoverMs: number;
  popMode: PopMode;
  activationDemand: number;
  activationHoldMs: number;
  activationWindowMs: number;
  restMs: number;
}

export interface BalloonInput {
  nowMs: number;
  /** The fingertip's distance from the balloon's centre as drawn, as a share of its radius. */
  distanceRatio: number | null;
  /** Activation level, from 0 to 1. Only read while squeezing. */
  level: number;
}

/** Game-time moments of the trial; null until reached. */
export interface BalloonMoments {
  spawn: number;
  /** When the balloon reached its height and began to wait. */
  arrived: number | null;
  /** The first time the fingertip touched the waiting balloon. */
  touch: number | null;
  activationStart: number | null;
  activationDone: number | null;
  pop: number | null;
  end: number | null;
}

export type BalloonEvent =
  | { type: "phase"; phase: BalloonPhase }
  | { type: "touched" }
  | { type: "outcome"; outcome: TrialOutcome };

/**
 * One balloon: SPAWN → RISE → HOVER → (SQUEEZE) → POPPED or FLOAT_AWAY → REST → DONE.
 *
 * It can only be popped once it has risen to its height, so the arm has to reach that height.
 * Touching it pops it; in touch_squeeze mode the touch starts a squeeze, the hand may then be
 * anywhere, and a squeeze that falls short lets the patient touch it again while it waits. A
 * squeeze under way may finish after the waiting time; otherwise the balloon floats away (a miss).
 */
export class BalloonMachine {
  private readonly settings: BalloonSettings;
  private current: BalloonPhase = "SPAWN";
  private detector: ActivationDetector | null = null;
  private activationState: ActivationState | null = null;
  private squeezeStart: number | null = null;
  private result: TrialOutcome | null = null;
  private phaseEnds = 0;
  readonly moments: BalloonMoments;

  constructor(settings: BalloonSettings, spawnMs: number) {
    this.settings = settings;
    this.moments = {
      spawn: spawnMs,
      arrived: null,
      touch: null,
      activationStart: null,
      activationDone: null,
      pop: null,
      end: null,
    };
  }

  get phase(): BalloonPhase {
    return this.current;
  }

  get outcome(): TrialOutcome | null {
    return this.result;
  }

  /** The latest squeeze's state, in touch_squeeze mode once touched. */
  get activation(): ActivationState | null {
    return this.activationState;
  }

  /** True from SPAWN until it pops or starts floating away. */
  get isLive(): boolean {
    return ["SPAWN", "RISE", "HOVER", "SQUEEZE"].includes(this.current);
  }

  /** How far it has risen, from 0 to 1. */
  riseProgress(nowMs: number): number {
    if (this.settings.riseMs <= 0) return 1;
    return Math.min(1, Math.max(0, (nowMs - this.moments.spawn) / this.settings.riseMs));
  }

  /** How long it has been waiting at its height. */
  waitedMs(nowMs: number): number {
    return this.moments.arrived === null ? 0 : Math.max(0, nowMs - this.moments.arrived);
  }

  /** How far it has floated away, from 0 to 1. */
  floatProgress(nowMs: number): number {
    if (this.current !== "FLOAT_AWAY" && this.result !== "miss") return 0;
    const end = this.moments.end ?? nowMs;
    return Math.min(1, Math.max(0, (nowMs - end) / FLOAT_AWAY_MS));
  }

  update({ nowMs, distanceRatio, level }: BalloonInput): BalloonEvent[] {
    const events: BalloonEvent[] = [];
    const go = (phase: BalloonPhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };
    const inside = distanceRatio !== null && distanceRatio <= 1;

    if (this.current === "SPAWN") go("RISE");

    if (this.current === "RISE") {
      const arrivesAt = this.moments.spawn + this.settings.riseMs;
      if (nowMs < arrivesAt) return events;
      this.moments.arrived = arrivesAt;
      go("HOVER");
    }

    switch (this.current) {
      case "HOVER":
        if (inside) {
          this.moments.touch ??= nowMs;
          events.push({ type: "touched" });
          if (this.settings.popMode === "touch") {
            this.pop(nowMs, events, go);
          } else {
            this.detector = new ActivationDetector({
              demand: this.settings.activationDemand,
              holdMs: this.settings.activationHoldMs,
              windowMs: this.settings.activationWindowMs,
            });
            this.squeezeStart = nowMs;
            this.activationState = this.detector.start(nowMs);
            go("SQUEEZE");
          }
        } else if (this.hoverOver(nowMs)) {
          this.miss(nowMs, events, go);
        }
        break;
      case "SQUEEZE": {
        const state = (this.detector as ActivationDetector).update(level, nowMs);
        this.activationState = state;
        const start = this.squeezeStart as number;
        if (state.status === "activated") {
          this.moments.activationStart = start + (state.onsetMs as number);
          this.moments.activationDone = start + (state.doneMs as number);
          this.pop(nowMs, events, go);
        } else if (state.status === "failed") {
          if (this.hoverOver(nowMs)) this.miss(nowMs, events, go);
          else go("HOVER");
        }
        break;
      }
      case "POPPED":
      case "FLOAT_AWAY":
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

  private hoverOver(nowMs: number): boolean {
    return this.moments.arrived !== null && nowMs - this.moments.arrived >= this.settings.hoverMs;
  }

  private pop(nowMs: number, events: BalloonEvent[], go: (phase: BalloonPhase) => void): void {
    this.result = "success";
    this.moments.pop = nowMs;
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + POP_MS;
    events.push({ type: "outcome", outcome: "success" });
    go("POPPED");
  }

  private miss(nowMs: number, events: BalloonEvent[], go: (phase: BalloonPhase) => void): void {
    this.result = "miss";
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + FLOAT_AWAY_MS;
    events.push({ type: "outcome", outcome: "miss" });
    go("FLOAT_AWAY");
  }
}
