import type { AngleSource, TrunkReference } from "@/vision/angles";
import type { PostureSample } from "@/vision/posture";

import {
  type ExerciseDefinition,
  type ExerciseId,
  type ExercisePreset,
  getThresholds,
  type Thresholds,
} from "./exercises";
import { CompensationMonitor, type CompensationReading, type ExerciseRep } from "./compensation";
import {
  type CounterEvent,
  type CounterFrame,
  createCounter,
  type ExerciseCounter,
  frameHasMeasure,
} from "./counter";
import type { RepFeedback } from "./repCounter";
import type { SequenceFeedback } from "./sequenceCounter";

export type ExerciseState =
  "INTRO" | "DEMO" | "COUNTDOWN" | "ACTIVE" | "PAUSED" | "DONE" | "SKIPPED";

export type ExerciseFeedback =
  | RepFeedback
  | SequenceFeedback
  | "forward"
  | "sideways"
  | "compensation_back"
  | "compensation_shoulder";

export type ExerciseEvent =
  | { type: "stateChanged"; state: ExerciseState }
  | { type: "feedback"; feedback: ExerciseFeedback }
  | { type: "repCompleted"; rep: ExerciseRep }
  | { type: "partialRep"; rep: ExerciseRep };

export interface ExerciseResult {
  exerciseId: ExerciseId;
  preset: ExercisePreset;
  thresholds: Thresholds;
  /** Every recorded movement, full and partial, with what was seen of the posture. */
  reps: ExerciseRep[];
  fullReps: number;
  partialReps: number;
  /** Reps, full or partial, with compensation held for at least the sustain time. */
  compensatedReps: number;
  /** compensatedReps as a share of all recorded reps, from 0 to 1; 0 with no reps. */
  compensationRate: number;
  /** The furthest point of any recorded movement, or null if there were none. */
  bestPeak: number | null;
  /** The same, from unfiltered angles. Use this for saved data. */
  bestRawPeak: number | null;
  /** The mean duration of full reps, or null if there were none. */
  meanDurationMs: number | null;
  activeTimeMs: number;
  pausedTimeMs: number;
  /** What most frames used, or null if no frames were measured. */
  measureSource: AngleSource | null;
  trunkReference: TrunkReference | null;
  skipped: boolean;
}

/**
 * One tracking frame. A null value (or null values, for a sequence) means the measure was
 * unavailable in this frame.
 */
export interface ExerciseFrame extends CounterFrame {
  planeDeg?: number | null;
  /** Leave undefined to skip compensation checks; null means the trunk was not visible. */
  posture?: PostureSample | null;
  source?: AngleSource | null;
  trunkReference?: TrunkReference | null;
}

export interface ExerciseRunnerOptions {
  countdownMs?: number;
  /** How long tracking must stay back before a tracking pause ends by itself. */
  resumeDelayMs?: number;
  history?: readonly ExerciseResult[];
}

const DEFAULT_COUNTDOWN_MS = 3000;
const DEFAULT_RESUME_DELAY_MS = 1000;
const TRACKING_LOST_AFTER_MS = 500;
// "Most of a rep" means more than half of the frames with a known plane.
const OFF_PLANE_SHARE = 0.5;

function mostCommon<T extends string>(counts: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * One exercise: INTRO -> DEMO -> COUNTDOWN -> ACTIVE -> DONE, with PAUSED while active and SKIPPED
 * from anywhere before the end. Time only comes from the timestamps passed in, so it is testable.
 */
export class ExerciseRunner {
  private readonly definition: ExerciseDefinition;
  private readonly preset: ExercisePreset;
  private readonly thresholds: Thresholds;
  private readonly countdownMs: number;
  private readonly resumeDelayMs: number;
  private readonly counter: ExerciseCounter;
  private readonly monitor: CompensationMonitor;
  private readonly exerciseReps: ExerciseRep[] = [];
  private readonly listeners = new Set<(event: ExerciseEvent) => void>();

  private currentState: ExerciseState = "INTRO";
  private countdownStart = 0;
  private activeStart = 0;
  private lastSeenAt = 0;
  private pausedAt: number | null = null;
  private pausedByUserFlag = false;
  private trackingBackAt: number | null = null;
  private pausedTimeMs = 0;
  private activeTimeMs = 0;
  private counterAtRest = true;
  private onPlane = 0;
  private offPlane = 0;
  private readonly sources = new Map<AngleSource, number>();
  private readonly trunkReferences = new Map<TrunkReference, number>();

  constructor(
    definition: ExerciseDefinition,
    preset: ExercisePreset,
    {
      countdownMs = DEFAULT_COUNTDOWN_MS,
      resumeDelayMs = DEFAULT_RESUME_DELAY_MS,
      history,
    }: ExerciseRunnerOptions = {},
  ) {
    this.definition = definition;
    this.preset = preset;
    this.thresholds = getThresholds(definition, preset, history);
    this.countdownMs = countdownMs;
    this.resumeDelayMs = resumeDelayMs;
    this.counter = createCounter(definition, this.thresholds);
    this.monitor = new CompensationMonitor(definition.id);
    this.counter.subscribe((event) => this.handleCounterEvent(event));
  }

  get state(): ExerciseState {
    return this.currentState;
  }

  /** A patient's own pause, rather than one caused by losing sight of the arm. */
  get pausedByUser(): boolean {
    return this.currentState === "PAUSED" && this.pausedByUserFlag;
  }

  /** True while the arm must first reach its starting position. */
  get awaitingRest(): boolean {
    return this.counter.awaitingRest;
  }

  get fullReps(): number {
    return this.counter.fullReps;
  }

  get partialReps(): number {
    return this.counter.partialReps;
  }

  /** The latest posture check: baseline, live values and what is being held too long. */
  get compensation(): CompensationReading {
    return this.monitor.reading;
  }

  /** True while any checked threshold has stayed exceeded for the sustain time. */
  get isCompensating(): boolean {
    return this.monitor.reading.sustained.length > 0;
  }

  /** For a sequence, the step expected next, from 0; otherwise null. */
  get sequenceStep(): number | null {
    return this.counter.sequenceStep;
  }

  subscribe(listener: (event: ExerciseEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startDemo(): void {
    if (this.currentState === "INTRO") this.setState("DEMO");
  }

  startCountdown(timestamp: number): void {
    if (this.currentState !== "INTRO" && this.currentState !== "DEMO") return;
    this.countdownStart = timestamp;
    this.setState("COUNTDOWN");
  }

  update(frame: ExerciseFrame): void {
    const { timestamp } = frame;
    // A broken value is the same as no measure at all.
    const tracked = frameHasMeasure(frame);
    if (this.currentState === "COUNTDOWN") {
      if (timestamp - this.countdownStart < this.countdownMs) return;
      this.begin(timestamp);
    } else if (this.currentState === "PAUSED") {
      // Comes back by itself after tracking loss, but a patient's own pause is theirs to end.
      if (this.pausedByUserFlag) return;
      if (!tracked) {
        this.trackingBackAt = null;
        return;
      }
      this.trackingBackAt ??= timestamp;
      if (timestamp - this.trackingBackAt < this.resumeDelayMs) return;
      this.endPause(timestamp);
    } else if (this.currentState !== "ACTIVE") {
      return;
    }

    if (!tracked) {
      if (timestamp - this.lastSeenAt > TRACKING_LOST_AFTER_MS) this.beginPause(timestamp, false);
      else this.checkTimeout(timestamp);
      return;
    }

    this.lastSeenAt = timestamp;
    this.recordFrame(frame);
    // Before the counter, so this frame's posture belongs to any rep it ends.
    if (frame.posture !== undefined) this.checkPosture(frame.posture, timestamp);
    this.counter.feed(frame);

    if (this.counter.fullReps >= this.definition.targetReps) this.finish("DONE", timestamp);
    else this.checkTimeout(timestamp);
  }

  pause(timestamp: number): void {
    if (this.currentState === "ACTIVE") this.beginPause(timestamp, true);
  }

  resume(timestamp: number): void {
    if (this.currentState === "PAUSED") this.endPause(timestamp);
  }

  skip(timestamp: number): void {
    if (this.currentState === "DONE" || this.currentState === "SKIPPED") return;
    this.finish("SKIPPED", timestamp);
  }

  /** Available once the exercise is DONE or SKIPPED. */
  getResult(): ExerciseResult | null {
    if (this.currentState !== "DONE" && this.currentState !== "SKIPPED") return null;

    const reps = [...this.exerciseReps];
    const compensatedReps = reps.filter((rep) => rep.compensated).length;
    const peaks = reps.map((rep) => rep.peakValue);
    const rawPeaks = reps.map((rep) => rep.rawPeakValue);
    const pickBest = this.definition.direction === "up" ? Math.max : Math.min;
    const fullDurations = reps.filter((rep) => rep.reachedTarget).map((rep) => rep.durationMs);

    return {
      exerciseId: this.definition.id,
      preset: this.preset,
      thresholds: this.thresholds,
      reps,
      fullReps: this.counter.fullReps,
      partialReps: this.counter.partialReps,
      compensatedReps,
      compensationRate: reps.length > 0 ? compensatedReps / reps.length : 0,
      bestPeak: peaks.length > 0 ? pickBest(...peaks) : null,
      bestRawPeak: rawPeaks.length > 0 ? pickBest(...rawPeaks) : null,
      meanDurationMs:
        fullDurations.length > 0
          ? fullDurations.reduce((total, duration) => total + duration, 0) / fullDurations.length
          : null,
      activeTimeMs: this.activeTimeMs,
      pausedTimeMs: this.pausedTimeMs,
      measureSource: mostCommon(this.sources),
      trunkReference: mostCommon(this.trunkReferences),
      skipped: this.currentState === "SKIPPED",
    };
  }

  private begin(timestamp: number): void {
    // The baseline is the person at rest, at the start of the active phase.
    this.monitor.rebaseline();
    this.activeStart = timestamp;
    this.lastSeenAt = timestamp;
    this.setState("ACTIVE");
  }

  private recordFrame({ planeDeg, source, trunkReference }: ExerciseFrame): void {
    if (source) this.sources.set(source, (this.sources.get(source) ?? 0) + 1);
    if (trunkReference) {
      this.trunkReferences.set(trunkReference, (this.trunkReferences.get(trunkReference) ?? 0) + 1);
    }

    const preferred = this.definition.preferredPlane;
    if (!preferred || planeDeg === null || planeDeg === undefined) return;
    if (!Number.isFinite(planeDeg)) return;
    if (this.counter.state === "REST") return;
    if (planeDeg >= preferred.minDeg && planeDeg <= preferred.maxDeg) this.onPlane++;
    else this.offPlane++;
  }

  private checkPosture(posture: PostureSample | null, timestamp: number): void {
    const { cue } = this.monitor.addSample(posture, timestamp);
    if (cue === "back") this.emit({ type: "feedback", feedback: "compensation_back" });
    else if (cue === "shoulder") this.emit({ type: "feedback", feedback: "compensation_shoulder" });
  }

  private handleCounterEvent(event: CounterEvent): void {
    const rep = this.monitor.handleCounterEvent(event);
    if (event.type === "stateChanged") {
      // A new movement starts a new count; turning back within a movement does not.
      if (event.state === "MOVING" && this.counterAtRest) {
        this.onPlane = 0;
        this.offPlane = 0;
      }
      this.counterAtRest = event.state === "REST";
      return;
    }
    if (event.type === "feedback") {
      this.emit(event);
      return;
    }
    // The monitor returns a rep for every rep event.
    if (!rep) return;
    this.exerciseReps.push(rep);
    this.emit({ type: event.type, rep });
    this.reportPlane();
  }

  private reportPlane(): void {
    const preferred = this.definition.preferredPlane;
    const total = this.onPlane + this.offPlane;
    if (preferred && total > 0 && this.offPlane / total > OFF_PLANE_SHARE) {
      this.emit({ type: "feedback", feedback: preferred.feedback });
    }
  }

  private beginPause(timestamp: number, byUser: boolean): void {
    // A gap breaks any run of exceeded frames.
    this.monitor.addSample(null, timestamp);
    this.counter.pause();
    this.pausedAt = timestamp;
    this.pausedByUserFlag = byUser;
    this.trackingBackAt = null;
    this.setState("PAUSED");
  }

  private endPause(timestamp: number): void {
    this.closePause(timestamp);
    this.counter.resume();
    this.lastSeenAt = timestamp;
    this.setState("ACTIVE");
  }

  private closePause(timestamp: number): void {
    if (this.pausedAt !== null) this.pausedTimeMs += timestamp - this.pausedAt;
    this.pausedAt = null;
    this.pausedByUserFlag = false;
    this.trackingBackAt = null;
  }

  private checkTimeout(timestamp: number): void {
    const activeMs = timestamp - this.activeStart - this.pausedTimeMs;
    if (activeMs >= this.definition.maxDurationSec * 1000) this.finish("DONE", timestamp);
  }

  private finish(state: "DONE" | "SKIPPED", timestamp: number): void {
    const wasRunning = this.currentState === "ACTIVE" || this.currentState === "PAUSED";
    this.closePause(timestamp);
    if (wasRunning) this.activeTimeMs = timestamp - this.activeStart - this.pausedTimeMs;
    this.setState(state);
  }

  private setState(state: ExerciseState): void {
    this.currentState = state;
    this.emit({ type: "stateChanged", state });
  }

  private emit(event: ExerciseEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
