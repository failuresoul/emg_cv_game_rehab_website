import { bandLimits, type GripHoldParams } from "./params";

/** The success or miss shows this long before the rest. */
export const OUTCOME_MS = 1500;
/**
 * An overshoot ends only once the level is this far back below the band's top, so jitter at the
 * top counts as one overshoot, not many.
 */
export const OVERSHOOT_HYSTERESIS = 0.03;

export type HoldPhase =
  /** Keep the level inside the band until the hold time is reached. */
  | "HOLD"
  /** "Now relax your hand": the level must fall below the relax level. */
  | "RELAX"
  | "SUCCESS"
  | "MISSED"
  | "REST"
  | "DONE";

/** Which phase ran out of time. */
export type HoldFailPhase = "hold" | "relax";

export type HoldSettings = Pick<
  GripHoldParams,
  "bandCenter" | "bandWidth" | "holdMs" | "timeLimitMs" | "relaxBelow" | "relaxWithinMs" | "restMs"
>;

/** Game-time moments of the trial; null until reached. */
export interface HoldMoments {
  spawn: number;
  /** The level first entered the band. */
  firstInBand: number | null;
  /** The hold time was reached and the relax prompt shown. */
  holdDone: number | null;
  /** The level first fell below the relax level. */
  relaxed: number | null;
  end: number | null;
}

/** What the hold phase measured. Times in ms. */
export interface HoldTally {
  /** Time inside the band, in total. */
  inBandMs: number;
  /** Time in the hold phase so far: the "active" time. */
  activeMs: number;
  longestRunMs: number;
  overshootCount: number;
  /** The most the level went above the band's top, from 0; null if it never did. */
  maxOvershoot: number | null;
  /** Levels inside the band: how many, their sum, and their sum of squares. */
  inBandCount: number;
  inBandSum: number;
  inBandSumSquares: number;
}

export type HoldEvent =
  | { type: "phase"; phase: HoldPhase }
  | { type: "enteredBand" }
  | { type: "overshoot" }
  | { type: "holdDone" }
  | { type: "outcome"; outcome: "success" | "miss"; failedPhase: HoldFailPhase | null };

const LIVE_PHASES: ReadonlySet<HoldPhase> = new Set(["HOLD", "RELAX"]);

/**
 * One grip hold: HOLD → RELAX → SUCCESS → REST → DONE, or MISSED → REST → DONE when a phase runs
 * out of time. The hold timer counts only while the level is inside the band; leaving the band
 * pauses it and coming back carries on. Each step's time counts towards the level read at its
 * end. Pure: feed it update() with each fixed step's level.
 */
export class HoldMachine {
  readonly settings: HoldSettings;
  readonly moments: HoldMoments;
  readonly tally: HoldTally = {
    inBandMs: 0,
    activeMs: 0,
    longestRunMs: 0,
    overshootCount: 0,
    maxOvershoot: null,
    inBandCount: 0,
    inBandSum: 0,
    inBandSumSquares: 0,
  };
  private current: HoldPhase = "HOLD";
  private readonly low: number;
  private readonly high: number;
  private lastMs: number;
  private runMs = 0;
  private overshooting = false;
  private inside = false;
  private phaseEnds = 0;
  private result: "success" | "miss" | null = null;
  private failed: HoldFailPhase | null = null;

  constructor(settings: HoldSettings, spawnMs: number) {
    this.settings = settings;
    const { low, high } = bandLimits(settings);
    this.low = low;
    this.high = high;
    this.lastMs = spawnMs;
    this.moments = { spawn: spawnMs, firstInBand: null, holdDone: null, relaxed: null, end: null };
  }

  get phase(): HoldPhase {
    return this.current;
  }

  get isLive(): boolean {
    return LIVE_PHASES.has(this.current);
  }

  get outcome(): "success" | "miss" | null {
    return this.result;
  }

  get failedPhase(): HoldFailPhase | null {
    return this.failed;
  }

  /** The band's lower and upper levels. */
  get band(): { low: number; high: number } {
    return { low: this.low, high: this.high };
  }

  /** Whether the latest level was inside the band. */
  get inBand(): boolean {
    return this.inside;
  }

  /** How much of the hold time is done, from 0 to 1. */
  get holdProgress(): number {
    return Math.min(1, this.tally.inBandMs / this.settings.holdMs);
  }

  /** How far the success or miss display has gone, from 0 to 1. */
  outcomeProgress(nowMs: number): number {
    if (this.moments.end === null) return 0;
    return Math.min(1, Math.max(0, (nowMs - this.moments.end) / OUTCOME_MS));
  }

  update(nowMs: number, level: number): HoldEvent[] {
    const events: HoldEvent[] = [];
    const dt = Math.max(0, nowMs - this.lastMs);
    this.lastMs = nowMs;
    const go = (phase: HoldPhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    switch (this.current) {
      case "HOLD": {
        this.measure(level, dt, nowMs, events);
        if (this.tally.inBandMs >= this.settings.holdMs) {
          this.moments.holdDone = nowMs;
          events.push({ type: "holdDone" });
          go("RELAX");
        } else if (this.tally.activeMs >= this.settings.timeLimitMs) {
          this.finish("miss", "hold", nowMs, events, go);
        }
        break;
      }
      case "RELAX": {
        const since = nowMs - (this.moments.holdDone as number);
        if (level < this.settings.relaxBelow) {
          this.moments.relaxed = nowMs;
          this.finish("success", null, nowMs, events, go);
        } else if (since >= this.settings.relaxWithinMs) {
          this.finish("miss", "relax", nowMs, events, go);
        }
        break;
      }
      case "SUCCESS":
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

  private measure(level: number, dt: number, nowMs: number, events: HoldEvent[]): void {
    const { tally } = this;
    tally.activeMs += dt;
    this.inside = level >= this.low && level <= this.high;
    if (this.inside) {
      if (this.moments.firstInBand === null) {
        this.moments.firstInBand = nowMs;
        events.push({ type: "enteredBand" });
      }
      tally.inBandMs += dt;
      this.runMs += dt;
      tally.longestRunMs = Math.max(tally.longestRunMs, this.runMs);
      tally.inBandCount++;
      tally.inBandSum += level;
      tally.inBandSumSquares += level * level;
    } else {
      this.runMs = 0;
    }

    if (level > this.high) {
      tally.maxOvershoot = Math.max(tally.maxOvershoot ?? 0, level - this.high);
      if (!this.overshooting) {
        this.overshooting = true;
        tally.overshootCount++;
        events.push({ type: "overshoot" });
      }
    } else if (this.overshooting && level < this.high - OVERSHOOT_HYSTERESIS) {
      this.overshooting = false;
    }
  }

  private finish(
    outcome: "success" | "miss",
    failedPhase: HoldFailPhase | null,
    nowMs: number,
    events: HoldEvent[],
    go: (phase: HoldPhase) => void,
  ): void {
    this.result = outcome;
    this.failed = failedPhase;
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + OUTCOME_MS;
    events.push({ type: "outcome", outcome, failedPhase });
    go(outcome === "success" ? "SUCCESS" : "MISSED");
  }
}
