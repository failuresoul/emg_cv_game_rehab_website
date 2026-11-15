// Development only (the guided recorder). The step sequencer: pure, driven by tick(now), so the
// timings can be tested without a camera.
import { type GuideBeat, type GuideStep, stepDurationMs } from "./guideSteps";

export const COUNTDOWN_MS = 3000;
/** The arm or hand out of view for longer than this pauses the step. */
export const LOST_AFTER_MS = 1000;

export type GuidePhase = "idle" | "countdown" | "step" | "done" | "cancelled";

/** A step's place in the recording, in ms from the recording's start. */
export interface StepMarker {
  id: string;
  name: string;
  start: number;
  end: number;
}

export type GuideEvent =
  | { type: "countdown"; stepIndex: number }
  | { type: "stepStart"; stepIndex: number; atMs: number }
  | { type: "beat"; stepIndex: number; beatIndex: number }
  | { type: "stepEnd"; stepIndex: number; atMs: number }
  /** Frames recorded at or after atMs (recording time) must be dropped: the step is redone. */
  | { type: "discard"; fromMs: number }
  | { type: "autoPause" }
  | { type: "autoResume" }
  | { type: "done" };

export interface GuideView {
  phase: GuidePhase;
  stepIndex: number;
  stepCount: number;
  step: GuideStep | null;
  beatIndex: number;
  beat: GuideBeat | null;
  /** 3, 2, 1 during the countdown; null otherwise. */
  countdown: number | null;
  /** Seconds left in the step (or the countdown), rounded up. */
  secondsLeft: number;
  beatProgress: number;
  paused: boolean;
  autoPaused: boolean;
  /** Frames should be saved now. */
  recording: boolean;
}

export interface SequencerOptions {
  countdownMs?: number;
  lostAfterMs?: number;
}

export class GuideSequencer {
  private readonly steps: readonly GuideStep[];
  private readonly countdownMs: number;
  private readonly lostAfterMs: number;
  private phaseValue: GuidePhase = "idle";
  private index = 0;
  /** Running time spent in the current phase (paused time does not count). */
  private phaseElapsed = 0;
  private lastTick = 0;
  private origin = 0;
  private manualPause = false;
  private autoPause = false;
  private lostSince: number | null = null;
  private stepStartedAt: number | null = null;
  private currentBeat = -1;
  private readonly markerList: StepMarker[] = [];

  constructor(steps: readonly GuideStep[], options: SequencerOptions = {}) {
    if (steps.length === 0) throw new Error("No steps");
    this.steps = steps;
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    this.lostAfterMs = options.lostAfterMs ?? LOST_AFTER_MS;
  }

  get phase(): GuidePhase {
    return this.phaseValue;
  }

  /** When the recording started (the clock of now), the zero of marker times. */
  get originMs(): number {
    return this.origin;
  }

  get markers(): readonly StepMarker[] {
    return this.markerList;
  }

  get isRecording(): boolean {
    return this.phaseValue === "step" && !this.manualPause && !this.autoPause;
  }

  start(now: number): GuideEvent[] {
    if (this.phaseValue !== "idle") return [];
    this.origin = now;
    this.lastTick = now;
    return this.enterCountdown();
  }

  /** Advances time; `visible` says whether the affected arm and hand are in view. */
  tick(now: number, visible: boolean): GuideEvent[] {
    const events: GuideEvent[] = [];
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (this.phaseValue !== "countdown" && this.phaseValue !== "step") return events;

    if (this.phaseValue === "step") {
      if (visible) {
        this.lostSince = null;
        if (this.autoPause) {
          this.autoPause = false;
          events.push({ type: "autoResume" });
          // The time out of view does not count.
          return events;
        }
      } else if (!this.autoPause && !this.manualPause) {
        this.lostSince ??= now - dt;
        if (now - this.lostSince > this.lostAfterMs) {
          this.autoPause = true;
          events.push({ type: "autoPause" });
          return events;
        }
      }
    }
    if (this.manualPause || this.autoPause) return events;

    this.phaseElapsed += dt;
    if (this.phaseValue === "countdown") {
      if (this.phaseElapsed >= this.countdownMs) {
        const overflow = this.phaseElapsed - this.countdownMs;
        this.phaseValue = "step";
        this.phaseElapsed = overflow;
        this.stepStartedAt = now - overflow - this.origin;
        this.currentBeat = 0;
        events.push({ type: "stepStart", stepIndex: this.index, atMs: this.stepStartedAt });
        events.push({ type: "beat", stepIndex: this.index, beatIndex: 0 });
      }
      if (this.phaseValue === "countdown") return events;
    }

    const step = this.steps[this.index];
    const beat = this.beatAt(step, this.phaseElapsed);
    if (beat !== this.currentBeat && beat < step.beats.length) {
      this.currentBeat = beat;
      events.push({ type: "beat", stepIndex: this.index, beatIndex: beat });
    }
    if (this.phaseElapsed >= stepDurationMs(step)) {
      const end = now - (this.phaseElapsed - stepDurationMs(step)) - this.origin;
      this.markerList.push({ id: step.id, name: step.name, start: this.stepStartedAt ?? end, end });
      events.push({ type: "stepEnd", stepIndex: this.index, atMs: end });
      this.index++;
      this.stepStartedAt = null;
      if (this.index >= this.steps.length) {
        this.phaseValue = "done";
        events.push({ type: "done" });
      } else {
        events.push(...this.enterCountdown());
      }
    }
    return events;
  }

  pause(): void {
    if (this.phaseValue === "countdown" || this.phaseValue === "step") this.manualPause = true;
  }

  resume(now: number): void {
    this.manualPause = false;
    this.lastTick = now;
    this.lostSince = null;
  }

  /** Records the current step again from its countdown; its frames so far are dropped. */
  repeatStep(now: number): GuideEvent[] {
    if (this.phaseValue !== "countdown" && this.phaseValue !== "step") return [];
    const events: GuideEvent[] = [];
    if (this.stepStartedAt !== null) events.push({ type: "discard", fromMs: this.stepStartedAt });
    this.stepStartedAt = null;
    this.manualPause = false;
    this.autoPause = false;
    this.lostSince = null;
    this.lastTick = now;
    events.push(...this.enterCountdown());
    return events;
  }

  cancel(): void {
    this.phaseValue = "cancelled";
  }

  view(): GuideView {
    const step = this.steps[this.index] ?? null;
    const counting = this.phaseValue === "countdown";
    const stepping = this.phaseValue === "step";
    let beatIndex = -1;
    let beatProgress = 0;
    if (stepping && step) {
      beatIndex = Math.min(this.beatAt(step, this.phaseElapsed), step.beats.length - 1);
      const before = step.beats.slice(0, beatIndex).reduce((total, beat) => total + beat.ms, 0);
      beatProgress = Math.min(1, (this.phaseElapsed - before) / step.beats[beatIndex].ms);
    }
    const left = counting
      ? this.countdownMs - this.phaseElapsed
      : stepping && step
        ? stepDurationMs(step) - this.phaseElapsed
        : 0;
    return {
      phase: this.phaseValue,
      stepIndex: Math.min(this.index, this.steps.length - 1),
      stepCount: this.steps.length,
      step: counting || stepping ? step : null,
      beatIndex,
      beat: stepping && step && beatIndex >= 0 ? step.beats[beatIndex] : null,
      countdown: counting ? Math.max(1, Math.ceil(left / 1000)) : null,
      secondsLeft: Math.max(0, Math.ceil(left / 1000)),
      beatProgress,
      paused: this.manualPause,
      autoPaused: this.autoPause,
      recording: this.isRecording,
    };
  }

  private enterCountdown(): GuideEvent[] {
    this.phaseValue = "countdown";
    this.phaseElapsed = 0;
    this.currentBeat = -1;
    return [{ type: "countdown", stepIndex: this.index }];
  }

  private beatAt(step: GuideStep, elapsed: number): number {
    let total = 0;
    for (let i = 0; i < step.beats.length; i++) {
      total += step.beats[i].ms;
      if (elapsed < total) return i;
    }
    return step.beats.length;
  }
}
