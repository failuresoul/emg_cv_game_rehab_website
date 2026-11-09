import type { TranslationKey } from "@/i18n";

export type ActivationSourceId = "cv_grip" | "keyboard" | "emg";

export type LevelListener = (level: number) => void;

/**
 * Where a game's "activation" comes from. Games only read a level from 0 (relaxed) to 1 (full
 * squeeze) and never need to know whether it is a closing hand, a key or, from Day 15, a muscle.
 */
export interface ActivationSource {
  readonly id: ActivationSourceId;
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

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The listener bookkeeping every source shares. */
export class LevelListeners {
  private readonly listeners = new Set<LevelListener>();

  add(listener: LevelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(level: number): void {
    this.listeners.forEach((listener) => listener(level));
  }
}
