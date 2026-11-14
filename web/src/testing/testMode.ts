/**
 * Test mode (Day 18): the hooks the automated end-to-end tests use, so they run without a
 * webcam, muscle sensor or language model. Only in a development build started with
 * VITE_TEST_MODE=true (Playwright starts it so); a production build never has them, because
 * Vite replaces import.meta.env.DEV with false and removes every branch that checks it.
 *
 * Keep the check inline (`import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === "true"`) at
 * each use that loads test code, so the build can drop that code.
 */

import type { GameTestTarget } from "@/games/shared/types";

import type { SynthScript } from "./synthLandmarks";

export function isTestMode(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === "true";
}

/** What the tests can reach in the page, as window.__muviTest. */
export interface MuviTestApi {
  /** The current game's goal, updated every frame while a game runs; null otherwise. */
  currentTarget: GameTestTarget | null;
  /** The game being played and its stage ("countdown", "playing", "finished"...). */
  game: { stage: string } | null;
  vision: {
    /** Plays a synthetic landmark script instead of the camera (from now). */
    play(script: SynthScript): void;
    /** Plays web/public/test-fixtures/landmarks/<name>.json instead of the camera. */
    playRecording(name: string, options?: { loop?: boolean }): Promise<void>;
    /** Nothing in view (as an empty room). */
    clear(): void;
    /** "synthetic", "recording" or "none". */
    source(): string;
    /** How many replayed frames the vision engine has emitted so far. */
    framesEmitted(): number;
  };
  emg: {
    /** Holds the simulated muscle sensor at a contraction level from 0 (rest) to 1; null lets the
     * M key drive it again. */
    setLevel(level: number | null): void;
  };
}

declare global {
  interface Window {
    __muviTest?: MuviTestApi;
  }
}
