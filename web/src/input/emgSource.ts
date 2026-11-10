import { LevelListeners, type LevelSource } from "./types";

/**
 * Which muscle group drives the level: the forearm flexors close the hand (activation), the
 * extensors open it (openness).
 */
export type EmgChannel = "flexor" | "extensor";

export interface EmgSourceOptions {
  channel?: EmgChannel;
}

/**
 * Implemented on Day 15 (ESP32 + Web Serial, %MVC). A flexor source will drive activation and an
 * extensor source openness.
 *
 * Until then this placeholder is never ready and always reads 0, so it can be listed and chosen
 * without breaking anything.
 */
export class EmgSource implements LevelSource<"emg"> {
  readonly id = "emg";
  readonly labelKey = "input.source.emg";
  readonly channel: EmgChannel;
  private readonly listeners = new LevelListeners();

  constructor({ channel = "flexor" }: EmgSourceOptions = {}) {
    this.channel = channel;
  }

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
