import { ActivationDetector, type ActivationState } from "@/input/activationDetector";
import type { TrialOutcome } from "@/types/api";

/** How long the outcome (burst or message) shows before the rest. */
export const OUTCOME_MS = 1200;
/**
 * Once inside, the fingertip may drift this much past the target's edge (as a share of the radius)
 * before it counts as leaving, so jitter at the edge does not keep resetting the ring.
 */
export const LEAVE_MARGIN = 0.1;

export type TrialPhase = "SPAWN" | "REACH" | "DWELL" | "ACTIVATE" | "OUTCOME" | "REST" | "DONE";

export interface TrialSettings {
  dwellMs: number;
  reachTimeLimitMs: number;
  activationDemand: number;
  activationHoldMs: number;
  activationWindowMs: number;
  restMs: number;
}

export interface TrialInput {
  nowMs: number;
  /** The fingertip's distance from the target's centre, as a share of its radius; null if unseen. */
  distanceRatio: number | null;
  /** Activation level, from 0 to 1. */
  level: number;
}

/** Game-time moments of the trial; null until reached. */
export interface TrialMoments {
  spawn: number;
  /** The first time the fingertip entered the target. */
  enter: number | null;
  dwellDone: number | null;
  activationStart: number | null;
  activationDone: number | null;
  end: number | null;
}

export type TrialEvent =
  | { type: "phase"; phase: TrialPhase }
  | { type: "entered" }
  | { type: "left" }
  | { type: "outcome"; outcome: TrialOutcome };

/**
 * One trial: SPAWN → REACH → DWELL → ACTIVATE → OUTCOME → REST → DONE. Leaving the target during
 * DWELL goes back to REACH and empties the ring. The reach time limit only ends the trial while
 * the fingertip is outside the target. During ACTIVATE the hand may be anywhere. Pure: feed it
 * update() with each fixed step's input.
 */
export class ReachTrialMachine {
  private readonly settings: TrialSettings;
  private current: TrialPhase = "SPAWN";
  private dwellStart: number | null = null;
  private dwellShare = 0;
  private detector: ActivationDetector | null = null;
  private activationState: ActivationState | null = null;
  private result: TrialOutcome | null = null;
  private phaseEnds = 0;
  readonly moments: TrialMoments;

  constructor(settings: TrialSettings, spawnMs: number) {
    this.settings = settings;
    this.moments = {
      spawn: spawnMs,
      enter: null,
      dwellDone: null,
      activationStart: null,
      activationDone: null,
      end: null,
    };
  }

  get phase(): TrialPhase {
    return this.current;
  }

  /** How full the dwell ring is, from 0 to 1. */
  get dwellProgress(): number {
    return this.dwellShare;
  }

  /** The activation detector's latest state, once ACTIVATE has begun. */
  get activation(): ActivationState | null {
    return this.activationState;
  }

  get outcome(): TrialOutcome | null {
    return this.result;
  }

  /** True from SPAWN to ACTIVATE: the trial is still being played. */
  get isLive(): boolean {
    return ["SPAWN", "REACH", "DWELL", "ACTIVATE"].includes(this.current);
  }

  update({ nowMs, distanceRatio, level }: TrialInput): TrialEvent[] {
    const events: TrialEvent[] = [];
    const go = (phase: TrialPhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    if (this.current === "SPAWN") go("REACH");

    switch (this.current) {
      case "REACH": {
        if (distanceRatio !== null && distanceRatio <= 1) {
          this.moments.enter ??= nowMs;
          this.dwellStart = nowMs;
          this.dwellShare = 0;
          events.push({ type: "entered" });
          go("DWELL");
          this.checkDwell(nowMs, go);
        } else if (nowMs - this.moments.spawn >= this.settings.reachTimeLimitMs) {
          this.finish("reach_fail", nowMs, events, go);
        }
        break;
      }
      case "DWELL": {
        if (distanceRatio === null || distanceRatio > 1 + LEAVE_MARGIN) {
          this.dwellStart = null;
          this.dwellShare = 0;
          events.push({ type: "left" });
          go("REACH");
          if (nowMs - this.moments.spawn >= this.settings.reachTimeLimitMs) {
            this.finish("reach_fail", nowMs, events, go);
          }
        } else {
          this.checkDwell(nowMs, go);
        }
        break;
      }
      case "ACTIVATE": {
        const detector = this.detector as ActivationDetector;
        const state = detector.update(level, nowMs);
        this.activationState = state;
        if (state.status === "activated") {
          const dwellDone = this.moments.dwellDone as number;
          this.moments.activationStart = dwellDone + (state.onsetMs as number);
          this.moments.activationDone = dwellDone + (state.doneMs as number);
          this.finish("success", nowMs, events, go);
        } else if (state.status === "failed") {
          this.finish("activation_fail", nowMs, events, go);
        }
        break;
      }
      case "OUTCOME":
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

  private checkDwell(nowMs: number, go: (phase: TrialPhase) => void): void {
    const start = this.dwellStart as number;
    this.dwellShare =
      this.settings.dwellMs > 0 ? Math.min(1, (nowMs - start) / this.settings.dwellMs) : 1;
    if (nowMs - start < this.settings.dwellMs) return;
    this.moments.dwellDone = nowMs;
    this.dwellShare = 1;
    this.detector = new ActivationDetector({
      demand: this.settings.activationDemand,
      holdMs: this.settings.activationHoldMs,
      windowMs: this.settings.activationWindowMs,
    });
    this.activationState = this.detector.start(nowMs);
    go("ACTIVATE");
  }

  private finish(
    outcome: TrialOutcome,
    nowMs: number,
    events: TrialEvent[],
    go: (phase: TrialPhase) => void,
  ): void {
    this.result = outcome;
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + OUTCOME_MS;
    events.push({ type: "outcome", outcome });
    go("OUTCOME");
  }
}
