import type { TranslationKey } from "@/i18n";

export type ActivationSourceId = "cv_grip" | "keyboard" | "emg";
export type OpennessSourceId = "cv_openness" | "keyboard" | "emg";

export type LevelListener = (level: number) => void;

/**
 * Anything that reports one level from 0 to 1. Games only read the level and never need to know
 * whether it comes from the camera, a key or, from Day 15, a muscle.
 */
export interface LevelSource<Id extends string = string> {
  readonly id: Id;
  readonly labelKey: TranslationKey;
  /** False while the source cannot measure, for example when the hand is out of view. */
  isReady(): boolean;
  /** The current level, from 0 to 1. Always 0 while the source is not ready. */
  getLevel(): number;
  start(): void;
  stop(): void;
  /** Called with each new level. Returns a function that unsubscribes. */
  subscribe(listener: LevelListener): () => void;
}

/** Where a game's "activation" comes from: 0 relaxed, 1 full squeeze. */
export type ActivationSource = LevelSource<ActivationSourceId>;

/** How open the affected hand is: 0 a fist, 1 fully open. */
export type OpennessSource = LevelSource<OpennessSourceId>;

/** The source badge's words for each input mode. */
export const SOURCE_BADGE_KEYS: Readonly<Record<ActivationSourceId, TranslationKey>> = {
  cv_grip: "game.source.webcam",
  keyboard: "game.source.keyboard",
  emg: "game.source.emg",
};

/**
 * The source driving a game's own hand signal now, as saved in input_source: the muscle sensor
 * when it drives that signal (grip or openness), the keyboard in development, else the camera.
 */
export function signalSourceId(
  signal: "grip" | "openness" | null,
  gripSourceId: ActivationSourceId,
  opennessSourceId: OpennessSourceId,
): ActivationSourceId {
  if (signal === "openness" && opennessSourceId === "emg") return "emg";
  if (signal === "openness" && gripSourceId === "emg") return "cv_grip";
  return gripSourceId;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The listener bookkeeping every source shares. */
export class Listeners<T> {
  private readonly listeners = new Set<(value: T) => void>();

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    this.listeners.forEach((listener) => listener(value));
  }
}

export class LevelListeners extends Listeners<number> {}

/** Key presses in a text field are typing, not input. */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
