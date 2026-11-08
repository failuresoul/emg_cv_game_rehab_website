import type { CounterFrame, ExerciseCounter } from "./counter";
import type { RepFeedback, RepRecord } from "./repCounter";

/**
 * REST: waiting for the first step. MOVING: part way through a sequence. TOUCHING: the expected
 * step is being touched, and counts once it is released.
 */
export type SequenceState = "REST" | "MOVING" | "TOUCHING";
export type SequenceFeedback = "next_index" | "next_middle" | "next_ring" | "next_little";

export type SequenceEvent =
  | { type: "repCompleted"; rep: RepRecord }
  | { type: "feedback"; feedback: RepFeedback | SequenceFeedback }
  | { type: "stateChanged"; state: SequenceState };

export interface SequenceCounterConfig {
  /** A distance below this is a touch. */
  low: number;
  /** A touch ends once the distance rises above this, so jitter near `low` counts only once. */
  high: number;
  /** How many steps make one rep. */
  steps?: number;
  /** A sequence starts again if the next step takes longer than this. */
  stepTimeoutMs?: number;
}

const DEFAULT_STEPS = 4;
const DEFAULT_STEP_TIMEOUT_MS = 6000;
const NEXT_FEEDBACK: SequenceFeedback[] = ["next_index", "next_middle", "next_ring", "next_little"];

/**
 * Counts a sequence of touches in a set order: for thumb opposition, the thumb to the index,
 * middle, ring and little finger. Touching any finger other than the expected one is ignored.
 */
export class SequenceCounter implements ExerciseCounter {
  readonly partialReps = 0;
  private readonly listeners = new Set<(event: SequenceEvent) => void>();
  private readonly low: number;
  private readonly high: number;
  private readonly steps: number;
  private readonly stepTimeoutMs: number;

  private currentState: SequenceState = "REST";
  private isPaused = false;
  /** The expected step must first be seen apart, so a touch already held does not count. */
  private armed = false;
  private step = 0;
  private startTs = 0;
  private lastProgressAt = 0;
  private touchMin = Infinity;
  private touchRawMin = Infinity;
  private touchMinTs = 0;
  /** The closest approach of each step so far. */
  private touches: { value: number; raw: number; timestamp: number }[] = [];
  private readonly recorded: RepRecord[] = [];

  constructor({
    low,
    high,
    steps = DEFAULT_STEPS,
    stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  }: SequenceCounterConfig) {
    if (!(low < high)) throw new RangeError(`low (${low}) must be below high (${high})`);
    this.low = low;
    this.high = high;
    this.steps = steps;
    this.stepTimeoutMs = stepTimeoutMs;
  }

  get state(): SequenceState {
    return this.currentState;
  }

  get awaitingRest(): boolean {
    return !this.armed;
  }

  get fullReps(): number {
    return this.recorded.length;
  }

  get reps(): readonly RepRecord[] {
    return this.recorded;
  }

  get sequenceStep(): number {
    return this.step;
  }

  subscribe(listener: (event: SequenceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  feed(frame: CounterFrame): void {
    const { values, timestamp } = frame;
    if (this.isPaused || !values || values.length < this.steps) return;
    const distance = values[this.step];
    if (!Number.isFinite(distance)) return;
    const rawDistance = frame.rawValues?.[this.step];
    const raw = rawDistance !== undefined && Number.isFinite(rawDistance) ? rawDistance : distance;

    if (
      this.step > 0 &&
      this.currentState !== "TOUCHING" &&
      timestamp - this.lastProgressAt > this.stepTimeoutMs
    ) {
      this.restart();
      this.emit({ type: "feedback", feedback: NEXT_FEEDBACK[0] });
    }

    if (!this.armed) {
      if (distance >= this.high) {
        this.armed = true;
        this.emit({ type: "feedback", feedback: NEXT_FEEDBACK[this.step] });
      }
      return;
    }

    if (this.currentState !== "TOUCHING") {
      if (distance >= this.low) return;
      if (this.step === 0) this.startTs = timestamp;
      this.touchMin = distance;
      this.touchRawMin = raw;
      this.touchMinTs = timestamp;
      this.setState("TOUCHING");
      return;
    }

    if (distance < this.touchMin) {
      this.touchMin = distance;
      this.touchMinTs = timestamp;
    }
    this.touchRawMin = Math.min(this.touchRawMin, raw);
    if (distance <= this.high) return;

    this.touches.push({ value: this.touchMin, raw: this.touchRawMin, timestamp: this.touchMinTs });
    this.step += 1;
    this.lastProgressAt = timestamp;
    if (this.step < this.steps) {
      this.setState("MOVING");
      this.emit({ type: "feedback", feedback: NEXT_FEEDBACK[this.step] ?? "next_index" });
      return;
    }
    this.complete(timestamp);
  }

  pause(): void {
    this.isPaused = true;
    this.restart();
    this.armed = false;
  }

  resume(): void {
    this.isPaused = false;
  }

  private complete(timestamp: number): void {
    // The loosest touch of the sequence, so a better rep has a smaller peak.
    const loosest = this.touches.reduce((worst, touch) =>
      touch.value > worst.value ? touch : worst,
    );
    const rep: RepRecord = {
      index: this.recorded.length + 1,
      startTs: this.startTs,
      peakTs: loosest.timestamp,
      endTs: timestamp,
      durationMs: timestamp - this.startTs,
      peakValue: loosest.value,
      rawPeakValue: Math.max(...this.touches.map((touch) => touch.raw)),
      reachedTarget: true,
    };
    this.recorded.push(rep);
    this.restart();
    // The thumb has just left the last finger, so the next sequence can begin at once.
    this.armed = true;
    this.emit({ type: "repCompleted", rep });
    this.emit({ type: "feedback", feedback: "good" });
  }

  private restart(): void {
    this.step = 0;
    this.touches = [];
    this.touchMin = Infinity;
    this.touchRawMin = Infinity;
    this.setState("REST");
  }

  private setState(state: SequenceState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit({ type: "stateChanged", state });
  }

  private emit(event: SequenceEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
