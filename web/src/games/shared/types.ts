import type { LucideIcon } from "lucide-react";

import type { TranslationKey } from "@/i18n";
import type {
  ActivationSourceId,
  Finger,
  FingerTouchListener,
  PinchListener,
  PinchState,
} from "@/input";
import type { Calibration, GameId, GameSummary, Side, TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";
import type { ExerciseResult } from "@/warmup/exerciseRunner";
import type { ExerciseId } from "@/warmup/exercises";

import type { GameAudio } from "./audio";
import type { Rng } from "./rng";

export type { GameId } from "@/types/api";

export type ParamUnit =
  "sw" | "ms" | "deg" | "level" | "share" | "count" | "sw_per_s" | "bpm" | "palm_ratio";

/**
 * Which kind of difficulty a setting is, so the adaptive engine moves the right one after a
 * success or a failure: how far (spatial), how hard to squeeze or open (activation), how fast
 * (speed), how exact (precision). "fixed" settings are never adapted, such as rest times, the
 * direction chosen for each turn or a single-value setting.
 */
export type DifficultyComponent = "spatial" | "activation" | "speed" | "precision" | "fixed";

export const DIFFICULTY_COMPONENTS: readonly Exclude<DifficultyComponent, "fixed">[] = [
  "spatial",
  "activation",
  "speed",
  "precision",
];

/** One adjustable setting of a game. The adaptive engine moves it within min and max. */
export interface ParamSpec {
  name: string;
  component: DifficultyComponent;
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
  /** The affected arm's elevation from the body, in degrees (0 is down), unfiltered; null if unseen. */
  armElevationDeg: number | null;
  /**
   * The affected elbow's angle in degrees, unfiltered: about 180 straight, smaller when bent. Null
   * if unseen.
   */
  elbowFlexionDeg: number | null;
  /** Game time of the frame: performance.now() minus the time spent paused. */
  timestamp: number;
}

export interface GameActivation {
  sourceId: ActivationSourceId;
  /** From 0 (relaxed) to 1 (full squeeze). */
  getLevel(): number;
  isReady(): boolean;
}

/** The affected hand's shape, for hand games. Games never read the webcam directly. */
export interface GameHandInput {
  /** From 0 (a fist) to 1 (fully open). 0 while not ready. */
  getOpenness(): number;
  isOpennessReady(): boolean;
  /** The finger the thumb is touching now, or null. */
  getTouch(): Finger | null;
  isTouchReady(): boolean;
  /**
   * Each touchStart and touchEnd as it happens, with `t` in game time. Returns a function that
   * unsubscribes.
   */
  subscribeTouch(listener: FingerTouchListener): () => void;
  /** Changes the touch distance, in palm lengths, from the next camera frame. */
  setTouchThreshold(threshold: number): void;
  /**
   * The thumb-and-index pinch now: whether pinching, its strength, and its point in SW (RAW for
   * saved data, smooth for drawing), with `t` in game time.
   */
  getPinch(): PinchState;
  /** Each pinchStart and pinchEnd, with `t` in game time. Returns a function that unsubscribes. */
  subscribePinch(listener: PinchListener): () => void;
}

export type FeedbackTone = "positive" | "neutral" | "gentle";

export interface GameFeedback {
  key: TranslationKey;
  params?: Record<string, string | number>;
  tone?: FeedbackTone;
}

export interface GameParamsSource {
  readonly engine: "L0" | "L1" | "L2";
  /**
   * The settings for a trial, given every trial logged so far. Pass the trial's number when trials
   * can overlap (two fruits falling at once), so each one gets its own place in the order.
   */
  next(trialNo?: number): GameParams;
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
  readonly hand: GameHandInput;
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

/** An extra figure for the top bar, such as the number of balloons popped. */
export interface GameHudItem {
  key: TranslationKey;
  params?: Record<string, string | number>;
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
  /**
   * Optional: draws the game's own background, such as a sky, in place of the plain dark one. It
   * comes before the faint skeleton, and is drawn during the countdown too.
   */
  renderBackground?(context: CanvasRenderingContext2D): void;
  /** Called every animation frame, in CSS pixels, after the background and before the cursor. */
  render(context: CanvasRenderingContext2D): void;
  pause(): void;
  resume(): void;
  isFinished(): boolean;
  /** Also read during play, for the score and trial number on screen. */
  getSummary(): GameResult;
  /** Optional: extra figures for the top bar, read a few times a second. */
  getHudItems?(): GameHudItem[];
  destroy(): void;
}

export type GameFactory = (context: GameContext) => GameInstance;

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
  /** The game's code, loaded the first time it is played (its own chunk of the build). */
  load(): Promise<GameFactory>;
  implemented: boolean;
  /**
   * Whose compensation checks the game uses, from the warm-up exercises. Reaching games check
   * every kind (the default, forward_reach); hand games check the trunk only (hand_open_close).
   */
  compensationExercise?: ExerciseId;
  /** Draw the fingertip cursor. True by default; off for games with no reaching. */
  showCursor?: boolean;
  /** Show the shell's squeeze meter. True by default; off for games that draw their own. */
  showGripMeter?: boolean;
  /**
   * The patient's own starting values from this session's warm-up, replacing the defaults of the
   * settings they name. Without it, every setting starts at its default.
   */
  personalDefaults?: (warmup: readonly ExerciseResult[]) => GameParams;
  /**
   * The hand signal the muscle sensor may drive, when today's EMG calibration is at its site:
   * grip (flexors) or openness (extensors). Without it, the game uses the camera only.
   */
  emgSignal?: "grip" | "openness";
}
