import type { LucideIcon } from "lucide-react";

import type { TranslationKey } from "@/i18n";
import type { ActivationSourceId } from "@/input";
import type { Calibration, GameId, GameSummary, Side, TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import type { GameAudio } from "./audio";
import type { Rng } from "./rng";

export type { GameId } from "@/types/api";

export type ParamUnit = "sw" | "ms" | "deg" | "level" | "share" | "count" | "sw_per_s" | "bpm";

/** One adjustable setting of a game. The adaptive engine (Day 12) moves it within min and max. */
export interface ParamSpec {
  name: string;
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: ParamUnit;
  /** Which way makes the game harder; null for a setting that is not a difficulty, like direction. */
  harder: "higher" | "lower" | null;
}

/** One trial's settings, by ParamSpec name. */
export type GameParams = Record<string, number>;

/** What a trial looked like, for choosing the next trial's settings. */
export interface TrialHistoryEntry {
  trialNo: number;
  params: GameParams;
  outcome: TrialCreate["outcome"];
  metrics: TrialCreate["metrics"];
}

export interface GameTracking {
  /** The affected fingertip from this frame, for saved data. Null when not detected. */
  rawSw: Point | null;
  /** The same, smoothed, for the on-screen cursor only. */
  smoothSw: Point | null;
  /** True once the hand has been missing for 500 ms. */
  handLost: boolean;
  handLostMs: number;
  /** Game time of the frame: performance.now() minus the time spent paused. */
  timestamp: number;
}

export interface GameActivation {
  sourceId: ActivationSourceId;
  /** From 0 (relaxed) to 1 (full squeeze). */
  getLevel(): number;
  isReady(): boolean;
}

export type FeedbackTone = "positive" | "neutral" | "gentle";

export interface GameFeedback {
  key: TranslationKey;
  params?: Record<string, string | number>;
  tone?: FeedbackTone;
}

export interface GameParamsSource {
  readonly engine: "L0" | "L1" | "L2";
  /** The settings for the next trial, given every trial logged so far. */
  next(): GameParams;
}

export interface GameTrialLogger {
  /** Queues a finished trial for upload. Never throws; failed uploads are kept and retried. */
  log(trial: TrialCreate): void;
}

export interface GameContext {
  readonly gameId: GameId;
  /** The canvas size in CSS pixels. It can change while playing, so read it every frame. */
  readonly width: number;
  readonly height: number;
  readonly trialsPlanned: number;
  /** Body frame (shoulder widths) to canvas pixels, and back. */
  toScreen(pointSw: Point): Point;
  toBody(pointPx: Point): Point;
  /** Canvas pixels per shoulder width. */
  readonly pixelsPerSw: number;
  getTracking(): GameTracking;
  readonly activation: GameActivation;
  readonly calibration: Calibration | null;
  readonly affectedSide: Side;
  readonly rng: Rng;
  readonly audio: GameAudio;
  readonly params: GameParamsSource;
  readonly logger: GameTrialLogger;
  /** Fed with the patient's posture every frame by the shell. Read its `reading`. */
  readonly compensation: CompensationMonitor;
  /** Shows a short message to the patient. */
  emit(feedback: GameFeedback): void;
}

export interface GameResult {
  score: number;
  trialsDone: number;
  trialsPlanned: number;
  summary: GameSummary;
}

export interface GameInstance {
  start(): void;
  /** Called at a fixed 60 Hz. nowMs is game time, which stands still while paused. */
  update(dtMs: number, nowMs: number): void;
  /** Called every animation frame, in CSS pixels, after the background and before the cursor. */
  render(context: CanvasRenderingContext2D): void;
  pause(): void;
  resume(): void;
  isFinished(): boolean;
  /** Also read during play, for the score and trial number on screen. */
  getSummary(): GameResult;
  destroy(): void;
}

export interface GameDefinition {
  id: GameId;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  /** What the game trains, in plain words. */
  movementKey: TranslationKey;
  icon: LucideIcon;
  params: readonly ParamSpec[];
  trialsDefault: number;
  /** About how long a game takes, for the plan. */
  estimatedMinutes: number;
  create(context: GameContext): GameInstance;
  implemented: boolean;
}
