/**
 * Puts window.__muviTest on the page (test mode only; main.tsx loads this file only when
 * VITE_TEST_MODE=true in a development build). See testMode.ts for what each part does.
 */

import { setSimulatedTestLevel } from "@/emg/simulated";

import type { MuviTestApi } from "./testMode";
import { testVisionFeed } from "./visionFeed";

export function installTestApi(): MuviTestApi {
  const api: MuviTestApi = {
    currentTarget: null,
    game: null,
    vision: {
      play: (script) => testVisionFeed.play(script),
      playRecording: (name, options) => testVisionFeed.playRecording(name, options?.loop ?? false),
      clear: () => testVisionFeed.clear(),
      source: () => testVisionFeed.current()?.kind ?? "none",
      framesEmitted: () => testVisionFeed.framesEmitted,
    },
    emg: {
      setLevel: (level) =>
        setSimulatedTestLevel(level === null ? null : Math.min(1, Math.max(0, level))),
    },
  };
  window.__muviTest = api;
  return api;
}
