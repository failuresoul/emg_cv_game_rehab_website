export type RepDirection = "up" | "down";
export type RepState = "REST" | "MOVING" | "AT_TARGET" | "RETURNING";
export type RepFeedback = "higher" | "lower" | "slow" | "almost" | "good";

export interface RepRecord {
  /** Position among all recorded movements, full and partial, starting at 1. */
  index: number;
  startTs: number;
  peakTs: number;
  endTs: number;
  durationMs: number;
  /** The maximum for "up" and the minimum for "down". */
  peakValue: number;
  reachedTarget: boolean;
}

export type RepEvent =
  | { type: "repCompleted"; rep: RepRecord }
  | { type: "partialRep"; rep: RepRecord }
  | { type: "feedback"; feedback: RepFeedback }
  | { type: "stateChanged"; state: RepState };

export interface RepCounterConfig {
  direction: RepDirection;
  low: number;
  high: number;
  minRepMs?: number;
  maxRepMs?: number;
  partialFraction?: number;
}

const DEFAULT_MIN_REP_MS = 600;
const DEFAULT_MAX_REP_MS = 8000;
const DEFAULT_PARTIAL_FRACTION = 0.6;
// Noise smaller than this cannot start a movement or turn it around.
const HYSTERESIS_DEG = 3;
// A movement smaller than this share of the way is treated as noise, and gets no feedback.
const MIN_FEEDBACK_FRACTION = 0.25;

/**
 * Counts repetitions from a filtered angle. Internally "up" and "down" share one scale that always
 * rises towards the target: "down" simply negates the angle. Comparing the two rest and target
 * lines, rather than one threshold, means noise around either line cannot count twice.
 */
export class RepCounter {
  private readonly listeners = new Set<(event: RepEvent) => void>();
  private readonly sign: 1 | -1;
  private readonly restLine: number;
  private readonly targetLine: number;
  private readonly partialLine: number;
  private readonly feedbackLine: number;
  private readonly smallMovementFeedback: RepFeedback;
  private readonly minRepMs: number;
  private readonly maxRepMs: number;

  private currentState: RepState = "REST";
  private isPaused = false;
  /** Must be seen at rest before a new movement can begin. */
  private armed = false;
  private startTs = 0;
  private peakTs = 0;
  private peak = 0;
  private reachedTarget = false;
  private readonly recorded: RepRecord[] = [];

  constructor({
    direction,
    low,
    high,
    minRepMs = DEFAULT_MIN_REP_MS,
    maxRepMs = DEFAULT_MAX_REP_MS,
    partialFraction = DEFAULT_PARTIAL_FRACTION,
  }: RepCounterConfig) {
    const isUp = direction === "up";
    this.sign = isUp ? 1 : -1;
    this.restLine = isUp ? low : -high;
    this.targetLine = isUp ? high : -low;
    const range = this.targetLine - this.restLine;
    this.partialLine = this.restLine + partialFraction * range;
    this.feedbackLine = this.restLine + MIN_FEEDBACK_FRACTION * range;
    this.smallMovementFeedback = isUp ? "higher" : "lower";
    this.minRepMs = minRepMs;
    this.maxRepMs = maxRepMs;
  }

  get state(): RepState {
    return this.currentState;
  }

  /** True while a movement cannot begin, because the arm has not yet been seen at rest. */
  get awaitingRest(): boolean {
    return this.currentState === "REST" && !this.armed;
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

  update(value: number, timestamp: number): void {
    if (this.isPaused) return;
    const scaled = value * this.sign;

    if (this.currentState === "REST") {
      if (scaled <= this.restLine) this.armed = true;
      if (!this.armed || scaled <= this.restLine + HYSTERESIS_DEG) return;
      // Carries on below, because a single frame can jump straight past the target.
      this.beginMovement(scaled, timestamp);
    }

    if (timestamp - this.startTs > this.maxRepMs) {
      this.abandonMovement();
      this.emit({ type: "feedback", feedback: "slow" });
      return;
    }

    if (scaled > this.peak) {
      this.peak = scaled;
      this.peakTs = timestamp;
    }

    if (scaled <= this.restLine) {
      this.finishMovement(timestamp);
    } else if (scaled >= this.targetLine) {
      this.reachedTarget = true;
      this.setState("AT_TARGET");
    } else if (scaled < this.peak - HYSTERESIS_DEG) {
      this.setState("RETURNING");
    } else if (this.currentState === "RETURNING" && scaled >= this.peak) {
      // It turned back towards the target, past its earlier best.
      this.setState("MOVING");
    }
  }

  /** For tracking loss. Abandons any movement in progress, so a pause never creates a rep. */
  pause(): void {
    this.isPaused = true;
    if (this.currentState !== "REST") this.abandonMovement();
    this.armed = false;
  }

  /** The arm must be seen at rest again before the next movement can count. */
  resume(): void {
    this.isPaused = false;
  }

  private beginMovement(scaled: number, timestamp: number): void {
    this.startTs = timestamp;
    this.peakTs = timestamp;
    this.peak = scaled;
    this.reachedTarget = false;
    this.setState("MOVING");
  }

  private finishMovement(timestamp: number): void {
    const durationMs = timestamp - this.startTs;
    this.setState("REST");
    // Value is at rest, so the next movement may begin straight away.
    this.armed = true;
    if (durationMs < this.minRepMs) return;

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
