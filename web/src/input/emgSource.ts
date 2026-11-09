import { type ActivationSource, LevelListeners } from "./types";

/**
 * Implemented on Day 15 (ESP32 + Web Serial, %MVC).
 *
 * Until then this placeholder is never ready and always reads 0, so it can be listed and chosen
 * without breaking anything.
 */
export class EmgSource implements ActivationSource {
  readonly id = "emg";
  readonly labelKey = "input.source.emg";
  private readonly listeners = new LevelListeners();

  isReady(): boolean {
    return false;
  }

  getLevel(): number {
    return 0;
  }

  start(): void {}

  stop(): void {}

  subscribe(listener: (level: number) => void): () => void {
    return this.listeners.add(listener);
  }
}
