import { FixedTimestep } from "./fixedTimestep";
import type { GameInstance } from "./types";

export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_STEP_MS = 1000;
/** Play carries on this long after tracking returns, so the patient can settle first. */
export const RESUME_DELAY_MS = 1000;

export type RuntimeStage = "countdown" | "playing" | "paused" | "finished";
export type PauseReason = "manual" | "hand" | "hidden";

export interface FrameConditions {
  /** False once the hand has been missing for 500 ms (see TrackingState.handPresent). */
  handPresent: boolean;
  /** True while the browser tab is hidden. */
  hidden: boolean;
}

export interface RuntimeCallbacks {
  /** Each number of the countdown: 3, 2, 1. */
  onCountdown?: (count: number) => void;
  /** Once, when the countdown ends and the game begins. */
  onStart?: () => void;
  onPause?: (reason: PauseReason) => void;
  onResume?: () => void;
  /** Once, when the game says it is finished or end() is called. */
  onFinish?: (completed: boolean) => void;
}

/**
 * Drives one game without touching the DOM: the countdown, the fixed 60 Hz updates, and pausing.
 * Game time is wall time (performance.now()) minus the time spent paused, so trials never measure
 * a pause. Call frame() from requestAnimationFrame.
 */
export class GameRuntime {
  private readonly game: GameInstance;
  private readonly callbacks: RuntimeCallbacks;
  private currentStage: RuntimeStage = "countdown";
  private reason: PauseReason | null = null;
  private countdownStart: number | null = null;
  private lastCount: number | null = null;
  private lastWall: number | null = null;
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  /** Since when tracking has been back, while auto-paused. */
  private okSince: number | null = null;
  private timestep: FixedTimestep | null = null;
  private playStartGameMs: number | null = null;

  constructor(game: GameInstance, callbacks: RuntimeCallbacks = {}) {
    this.game = game;
    this.callbacks = callbacks;
  }

  get stage(): RuntimeStage {
    return this.currentStage;
  }

  get pauseReason(): PauseReason | null {
    return this.reason;
  }

  /** The number to show during the countdown, or null afterwards. */
  get countdown(): number | null {
    return this.currentStage === "countdown" ? (this.lastCount ?? COUNTDOWN_FROM) : null;
  }

  /** Converts a performance.now() time, such as a tracking frame's, to game time. */
  toGameTime(wallMs: number): number {
    return wallMs - this.pausedTotal - (this.pausedAt !== null ? wallMs - this.pausedAt : 0);
  }

  /** Game time played so far, without the countdown or pauses. */
  elapsedMs(wallMs: number): number {
    if (this.playStartGameMs === null) return 0;
    return Math.max(0, this.toGameTime(wallMs) - this.playStartGameMs);
  }

  frame(wallMs: number, conditions: FrameConditions): void {
    const last = this.lastWall ?? wallMs;
    this.lastWall = wallMs;

    switch (this.currentStage) {
      case "countdown":
        this.runCountdown(wallMs);
        return;
      case "paused":
        this.checkAutoResume(wallMs, conditions);
        return;
      case "playing":
        if (conditions.hidden) return this.pause("hidden", wallMs);
        if (!conditions.handPresent) return this.pause("hand", wallMs);
        this.timestep?.advance(wallMs - last, (dt, now) => this.game.update(dt, now));
        if (this.game.isFinished()) this.finish(true);
        return;
      case "finished":
        return;
    }
  }

  pause(reason: PauseReason, wallMs: number): void {
    if (this.currentStage !== "playing") return;
    this.currentStage = "paused";
    this.reason = reason;
    this.pausedAt = wallMs;
    this.okSince = null;
    this.game.pause();
    this.callbacks.onPause?.(reason);
  }

  /** Resumes at once, as the Resume button does. Auto-pauses resume by themselves. */
  resume(wallMs: number): void {
    if (this.currentStage !== "paused" || this.pausedAt === null) return;
    this.pausedTotal += wallMs - this.pausedAt;
    this.pausedAt = null;
    this.reason = null;
    this.okSince = null;
    this.lastWall = wallMs;
    this.timestep?.resetAccumulator();
    this.currentStage = "playing";
    this.game.resume();
    this.callbacks.onResume?.();
  }

  /** Ends the game early, for example from the pause screen. */
  end(): void {
    this.finish(false);
  }

  private runCountdown(wallMs: number): void {
    this.countdownStart ??= wallMs;
    const elapsed = wallMs - this.countdownStart;
    const count = COUNTDOWN_FROM - Math.floor(elapsed / COUNTDOWN_STEP_MS);
    if (count >= 1) {
      if (count !== this.lastCount) {
        this.lastCount = count;
        this.callbacks.onCountdown?.(count);
      }
      return;
    }
    this.currentStage = "playing";
    const now = this.toGameTime(wallMs);
    this.playStartGameMs = now;
    this.timestep = new FixedTimestep(now);
    this.game.start();
    this.callbacks.onStart?.();
  }

  private checkAutoResume(wallMs: number, { handPresent, hidden }: FrameConditions): void {
    if (this.reason === "manual") return;
    if (hidden || !handPresent) {
      this.okSince = null;
      return;
    }
    this.okSince ??= wallMs;
    if (wallMs - this.okSince >= RESUME_DELAY_MS) this.resume(wallMs);
  }

  private finish(completed: boolean): void {
    if (this.currentStage === "finished") return;
    if (this.pausedAt !== null && this.lastWall !== null) {
      this.pausedTotal += this.lastWall - this.pausedAt;
      this.pausedAt = null;
    }
    this.currentStage = "finished";
    this.reason = null;
    this.callbacks.onFinish?.(completed);
  }
}
