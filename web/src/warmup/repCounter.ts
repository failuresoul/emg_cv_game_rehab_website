import type { CounterFrame, ExerciseCounter } from "./counter";
import type { Thresholds } from "./exercises";

export type RepDirection = "up" | "down";
export type RepState = "REST" | "MOVING" | "AT_TARGET" | "RETURNING";
/** "wrong_plane": a movement in the wrong direction, which did not count. */
export type RepFeedback = "higher" | "lower" | "slow" | "almost" | "good" | "wrong_plane";

export interface RepRecord {
  /** Position among all recorded movements, full and partial, starting at 1. */
  index: number;
  startTs: number;
  peakTs: number;
  endTs: number;
  durationMs: number;
  /** The filtered angle's furthest point: the maximum for "up" and the minimum for "down". */
  peakValue: number;
  /** The unfiltered angle's furthest point in the same movement. Use this for saved data. */
  rawPeakValue: number;
  reachedTarget: boolean;
}

export type RepEvent =
  | { type: "repCompleted"; rep: RepRecord }
  | { type: "partialRep"; rep: RepRecord }
  | { type: "feedback"; feedback: RepFeedback }
  | { type: "stateChanged"; state: RepState };

/**
 * Learns where the patient's arm actually rests. A camera that is tilted, or that cannot see the
 * whole arm, can read a relaxed arm as 40 to 60 degrees, so a fixed rest line is never reached and
 * nothing counts. When the value holds still for a moment below maxRest, the rest line moves to
 * just above it, and the target moves up if needed so that a repetition is still a real movement
 * of at least minTravel. All values are in the measure's unit.
 */
export interface AdaptiveRest {
  /** The smallest distance from the rest line to the target. */
  minTravel: number;
  /** How much the value may wander and still count as holding still. */
  stillRange: number;
  /** A still position further than this is a raised arm, not a resting one. */
  maxRest: number;
  /** How long the value must hold still. Default 1000 ms. */
  stillMs?: number;
}

export interface RepCounterConfig {
  direction: RepDirection;
  low: number;
  high: number;
  minRepMs?: number;
  maxRepMs?: number;
  partialFraction?: number;
  /** Noise smaller than this cannot start a movement or turn it around. In the measure's unit. */
  hysteresis?: number;
  /** Learn the patient's own rest position; see AdaptiveRest. Off when undefined. */
  adaptiveRest?: AdaptiveRest;
  /**
   * Only count a movement made mostly in the exercise's direction, judged from the frames' inPlane
   * while the arm is raised. A forward raise and a side raise reach the same angle, so without
   * this either one would count for both exercises.
   */
  requirePlane?: boolean;
}

const DEFAULT_MIN_REP_MS = 600;
const DEFAULT_MAX_REP_MS = 8000;
const DEFAULT_PARTIAL_FRACTION = 0.6;
// The default suits angles in degrees; ratios need a much smaller value.
const DEFAULT_HYSTERESIS = 3;
// A movement smaller than this share of the way is treated as noise, and gets no feedback.
const MIN_FEEDBACK_FRACTION = 0.25;
const DEFAULT_STILL_MS = 1000;
// The window must cover most of the still time, so that two frames are not enough.
const STILL_COVER = 0.8;

/**
 * Counts repetitions from a filtered angle. Internally "up" and "down" share one scale that always
 * rises towards the target: "down" simply negates the angle. Comparing the two rest and target
 * lines, rather than one threshold, means noise around either line cannot count twice.
 */
export class RepCounter implements ExerciseCounter {
  readonly sequenceStep = null;
  private readonly listeners = new Set<(event: RepEvent) => void>();
  private readonly sign: 1 | -1;
  private readonly partialFraction: number;
  /** The planned lines; an adapted rest never goes below the first or the target below the second. */
  private readonly baseRestLine: number;
  private readonly baseTargetLine: number;
  private readonly adaptiveRest: AdaptiveRest | null;
  private readonly stillWindow: { timestamp: number; value: number }[] = [];
  private readonly requirePlane: boolean;
  private framesInPlane = 0;
  private framesOutOfPlane = 0;
  private restLine: number;
  private targetLine: number;
  private partialLine = 0;
  private feedbackLine = 0;
  private readonly smallMovementFeedback: RepFeedback;
  private readonly minRepMs: number;
  private readonly maxRepMs: number;
  private readonly hysteresis: number;

  private currentState: RepState = "REST";
  private isPaused = false;
  /** Must be seen at rest before a new movement can begin. */
  private armed = false;
  private startTs = 0;
  private peakTs = 0;
  private peak = 0;
  private rawPeak = -Infinity;
  private reachedTarget = false;
  private readonly recorded: RepRecord[] = [];

  constructor({
    direction,
    low,
    high,
    minRepMs = DEFAULT_MIN_REP_MS,
    maxRepMs = DEFAULT_MAX_REP_MS,
    partialFraction = DEFAULT_PARTIAL_FRACTION,
    hysteresis = DEFAULT_HYSTERESIS,
    adaptiveRest,
    requirePlane = false,
  }: RepCounterConfig) {
    if (!(low < high)) throw new RangeError(`low (${low}) must be below high (${high})`);
    const isUp = direction === "up";
    this.sign = isUp ? 1 : -1;
    this.partialFraction = partialFraction;
    this.baseRestLine = isUp ? low : -high;
    this.baseTargetLine = isUp ? high : -low;
    this.restLine = this.baseRestLine;
    this.targetLine = this.baseTargetLine;
    this.setLines(this.baseRestLine, this.baseTargetLine);
    this.adaptiveRest = adaptiveRest ?? null;
    this.requirePlane = requirePlane;
    this.smallMovementFeedback = isUp ? "higher" : "lower";
    this.minRepMs = minRepMs;
    this.maxRepMs = maxRepMs;
    this.hysteresis = hysteresis;
  }

  get state(): RepState {
    return this.currentState;
  }

  /** True while a movement cannot begin, because the arm has not yet been seen at rest. */
  get awaitingRest(): boolean {
    return this.currentState === "REST" && !this.armed;
  }

  /** The rest and target lines in use, which follow the patient's rest when it is learnt. */
  get lines(): Thresholds {
    const [a, b] = [this.restLine * this.sign, this.targetLine * this.sign];
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }

  get fullReps(): number {
    return this.recorded.filter((rep) => rep.reachedTarget).length;
  }

  get partialReps(): number {
    return this.recorded.filter((rep) => !rep.reachedTarget).length;
  }

  /** Every recorded movement, in order. Too-fast and too-slow movements are not recorded. */
  get reps(): readonly RepRecord[] {
    return this.recorded;
  }

  subscribe(listener: (event: RepEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  feed(frame: CounterFrame): void {
    if (frame.value === null) return;
    this.update(frame.value, frame.timestamp, frame.rawValue ?? frame.value, frame.inPlane);
  }

  /** Counts from the filtered value. The raw value is only kept for the rep's record. */
  update(
    value: number,
    timestamp: number,
    rawValue: number = value,
    inPlane: boolean | null = null,
  ): void {
    if (this.isPaused || !Number.isFinite(value)) return;
    const scaled = value * this.sign;
    const scaledRaw = Number.isFinite(rawValue) ? rawValue * this.sign : scaled;

    if (this.currentState === "REST") {
      this.learnRest(scaled, timestamp);
      if (scaled <= this.restLine) this.armed = true;
      if (!this.armed || scaled <= this.restLine + this.hysteresis) return;
      // Carries on below, because a single frame can jump straight past the target.
      this.beginMovement(scaled, timestamp);
    }
    this.rawPeak = Math.max(this.rawPeak, scaledRaw);

    if (timestamp - this.startTs > this.maxRepMs) {
      this.abandonMovement();
      this.emit({ type: "feedback", feedback: "slow" });
      return;
    }

    if (scaled > this.peak) {
      this.peak = scaled;
      this.peakTs = timestamp;
    }
    // Low down, the direction means little; judge it once the arm is clearly raised.
    if (inPlane !== null && scaled >= this.feedbackLine) {
      if (inPlane) this.framesInPlane++;
      else this.framesOutOfPlane++;
    }

    if (scaled <= this.restLine) {
      this.finishMovement(timestamp);
    } else if (scaled >= this.targetLine) {
      this.reachedTarget = true;
      this.setState("AT_TARGET");
    } else if (scaled < this.peak - this.hysteresis) {
      this.setState("RETURNING");
    } else if (this.currentState === "RETURNING" && scaled >= this.peak) {
      // It turned back towards the target, past its earlier best.
      this.setState("MOVING");
    }
  }

  /** For tracking loss. Abandons any movement in progress, so a pause never creates a rep. */
  pause(): void {
    this.isPaused = true;
    this.stillWindow.length = 0;
    if (this.currentState !== "REST") this.abandonMovement();
    this.armed = false;
  }

  /** The arm must be seen at rest again before the next movement can count. */
  resume(): void {
    this.isPaused = false;
  }

  private setLines(restLine: number, targetLine: number): void {
    this.restLine = restLine;
    this.targetLine = targetLine;
    const range = targetLine - restLine;
    this.partialLine = restLine + this.partialFraction * range;
    this.feedbackLine = restLine + MIN_FEEDBACK_FRACTION * range;
  }

  /**
   * While at rest: once the value has held still for the still time, the rest line moves to just
   * above it. Before the first arming it may move up; afterwards only down, towards the planned
   * line, so that resting lower later makes the next repetition the planned one again.
   */
  private learnRest(scaled: number, timestamp: number): void {
    const adaptive = this.adaptiveRest;
    if (!adaptive) return;
    const stillMs = adaptive.stillMs ?? DEFAULT_STILL_MS;
    const window = this.stillWindow;
    window.push({ timestamp, value: scaled });
    while (window.length > 0 && window[0].timestamp < timestamp - stillMs) window.shift();
    if (timestamp - window[0].timestamp < STILL_COVER * stillMs) return;

    const values = window.map((entry) => entry.value);
    const highest = Math.max(...values);
    if (highest - Math.min(...values) > adaptive.stillRange) return;
    if (highest > adaptive.maxRest * this.sign) return;

    const restLine = Math.max(this.baseRestLine, highest + this.hysteresis);
    if (this.armed && restLine >= this.restLine) return;
    this.setLines(restLine, Math.max(this.baseTargetLine, restLine + adaptive.minTravel));
    this.armed = true;
  }

  private beginMovement(scaled: number, timestamp: number): void {
    this.stillWindow.length = 0;
    this.framesInPlane = 0;
    this.framesOutOfPlane = 0;
    this.startTs = timestamp;
    this.peakTs = timestamp;
    this.peak = scaled;
    this.rawPeak = -Infinity;
    this.reachedTarget = false;
    this.setState("MOVING");
  }

  private finishMovement(timestamp: number): void {
    const durationMs = timestamp - this.startTs;
    this.setState("REST");
    // Value is at rest, so the next movement may begin straight away.
    this.armed = true;
    if (durationMs < this.minRepMs) return;

    const wentFarEnough = this.reachedTarget || this.peak >= this.partialLine;
    if (this.requirePlane && wentFarEnough && this.framesOutOfPlane > this.framesInPlane) {
      this.emit({ type: "feedback", feedback: "wrong_plane" });
      return;
    }

    if (!this.reachedTarget && this.peak < this.partialLine) {
      if (this.peak >= this.feedbackLine) {
        this.emit({ type: "feedback", feedback: this.smallMovementFeedback });
      }
      return;
    }

    const rep: RepRecord = {
      index: this.recorded.length + 1,
      startTs: this.startTs,
      peakTs: this.peakTs,
      endTs: timestamp,
      durationMs,
      peakValue: this.peak * this.sign,
      rawPeakValue: this.rawPeak * this.sign,
      reachedTarget: this.reachedTarget,
    };
    this.recorded.push(rep);

    if (rep.reachedTarget) {
      this.emit({ type: "repCompleted", rep });
      this.emit({ type: "feedback", feedback: "good" });
    } else {
      this.emit({ type: "partialRep", rep });
      this.emit({ type: "feedback", feedback: "almost" });
    }
  }

  /** The arm may still be raised, so it must return to rest before another movement counts. */
  private abandonMovement(): void {
    this.setState("REST");
    this.armed = false;
  }

  private setState(state: RepState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit({ type: "stateChanged", state });
  }

  private emit(event: RepEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
