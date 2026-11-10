import { type Sweep, SweepDetector } from "./sweepDetector";

/** The upper arm may move this far from where it started before it counts as compensation. */
export const UPPER_ARM_LIMIT_DEG = 20;
/** How long the result shows before the rest. */
export const OUTCOME_MS = 1500;
/** A coat from a full sweep, and the lighter one from a partial sweep. */
export const FULL_COAT = 1;
export const PARTIAL_COAT = 0.5;

export type StripePhase = "PAINT" | "OUTCOME" | "REST" | "DONE";

export interface StripeSettings {
  /** The target height on the wall, from 0 to 1: the share of the elbow range to use. */
  targetHeight: number;
  sweepsNeeded: number;
  timeLimitMs: number;
  restMs: number;
}

export interface StripeInput {
  nowMs: number;
  /** The brush's height from the RAW elbow angle, from 0 to 1; null when the arm is unseen. */
  height: number | null;
  /** The upper arm's elevation from the body, unfiltered; null when unseen. */
  armElevationDeg: number | null;
}

/** A layer of paint: up to `height` (0–1), at `strength` (1 full, 0.5 light). */
export interface Coat {
  height: number;
  strength: number;
}

export type StripeEvent =
  | { type: "phase"; phase: StripePhase }
  | { type: "sweep"; sweep: Sweep }
  /** The upper arm moved too far during a sweep; once per sweep. */
  | { type: "upperArmMoved"; deg: number }
  | { type: "outcome"; outcome: "success" | "miss" };

/**
 * One stripe: PAINT (each sweep of the elbow adds a coat) → OUTCOME → REST → DONE. It is finished
 * after `sweepsNeeded` full sweeps, or ends at the time limit with the paint kept. The upper arm's
 * elevation at its first sighting is the reference: moving it more than 20° from there during a
 * sweep is shoulder compensation. Pure: feed it update() with each fixed step's input.
 */
export class StripeMachine {
  private readonly settings: StripeSettings;
  private readonly detector: SweepDetector;
  private current: StripePhase = "PAINT";
  private result: "success" | "miss" | null = null;
  private phaseEnds = 0;
  private elevationStart: number | null = null;
  private upperArmMax: number | null = null;
  private warnedThisSweep = false;
  private flagged = false;
  readonly spawnMs: number;
  readonly sweeps: Sweep[] = [];
  readonly coats: Coat[] = [];
  endMs: number | null = null;

  constructor(settings: StripeSettings, spawnMs: number) {
    this.settings = settings;
    this.spawnMs = spawnMs;
    this.detector = new SweepDetector(settings.targetHeight);
  }

  get phase(): StripePhase {
    return this.current;
  }

  get isLive(): boolean {
    return this.current === "PAINT";
  }

  get outcome(): "success" | "miss" | null {
    return this.result;
  }

  get targetHeight(): number {
    return this.detector.target;
  }

  get fullSweeps(): number {
    return this.sweeps.filter((sweep) => sweep.kind === "full").length;
  }

  get partialSweeps(): number {
    return this.sweeps.filter((sweep) => sweep.kind === "partial").length;
  }

  /** True while a sweep is in progress. */
  get sweeping(): boolean {
    return this.detector.sweeping;
  }

  /** The most the upper arm moved from its start during a sweep, in degrees; null if unseen. */
  get upperArmMotionDeg(): number | null {
    return this.upperArmMax;
  }

  /** True once the upper arm has moved too far during a sweep. */
  get upperArmFlagged(): boolean {
    return this.flagged;
  }

  update({ nowMs, height, armElevationDeg }: StripeInput): StripeEvent[] {
    const events: StripeEvent[] = [];
    const go = (phase: StripePhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    switch (this.current) {
      case "PAINT": {
        if (armElevationDeg !== null && Number.isFinite(armElevationDeg)) {
          this.elevationStart ??= armElevationDeg;
          if (this.detector.sweeping) {
            const moved = Math.abs(armElevationDeg - this.elevationStart);
            this.upperArmMax = Math.max(this.upperArmMax ?? 0, moved);
            if (moved > UPPER_ARM_LIMIT_DEG && !this.warnedThisSweep) {
              this.warnedThisSweep = true;
              this.flagged = true;
              events.push({ type: "upperArmMoved", deg: moved });
            }
          }
        }
        const sweep = this.detector.update(height, nowMs);
        if (sweep) {
          this.warnedThisSweep = false;
          this.sweeps.push(sweep);
          this.coats.push(
            sweep.kind === "full"
              ? { height: this.detector.target, strength: FULL_COAT }
              : { height: sweep.peakHeight, strength: PARTIAL_COAT },
          );
          events.push({ type: "sweep", sweep });
        }
        if (this.fullSweeps >= this.settings.sweepsNeeded) {
          this.finish("success", nowMs, events, go);
        } else if (nowMs - this.spawnMs >= this.settings.timeLimitMs) {
          this.finish("miss", nowMs, events, go);
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

  private finish(
    outcome: "success" | "miss",
    nowMs: number,
    events: StripeEvent[],
    go: (phase: StripePhase) => void,
  ): void {
    this.result = outcome;
    this.endMs = nowMs;
    this.phaseEnds = nowMs + OUTCOME_MS;
    events.push({ type: "outcome", outcome });
    go("OUTCOME");
  }
}
