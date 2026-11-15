/**
 * Puts window.__muviTest on the page (test mode only; main.tsx loads this file only when
 * VITE_TEST_MODE=true in a development build). See testMode.ts for what each part does.
 */

import {
  replugSimulatedForTest,
  setSimulatedTestLevel,
  unplugSimulatedForTest,
} from "@/emg/simulated";
import { getLanguage } from "@/i18n";
import { bn } from "@/i18n/bn";
import { en } from "@/i18n/en";
import { visionEngine } from "@/vision/visionEngine";

import type { MuviTestApi } from "./testMode";
import { testVisionFeed } from "./visionFeed";

export function installTestApi(): MuviTestApi {
  const api: MuviTestApi = {
    currentTarget: null,
    game: null,
    vision: {
      play: (script) => testVisionFeed.play(script),
      playRecording: (name, options) =>
        testVisionFeed.playRecording(name, options?.loop ?? false, options?.marker),
      clear: () => testVisionFeed.clear(),
      source: () => testVisionFeed.current()?.kind ?? "none",
      framesEmitted: () => testVisionFeed.framesEmitted,
      engineStatus: () => visionEngine.getStatus().phase,
    },
    emg: {
      setLevel: (level) =>
        setSimulatedTestLevel(level === null ? null : Math.min(1, Math.max(0, level))),
      unplug: () => unplugSimulatedForTest(),
      replug: () => replugSimulatedForTest(),
    },
    i18n: {
      values: (language) => ({ ...(language === "bn" ? bn : en) }),
      language: () => getLanguage(),
    },
  };
  window.__muviTest = api;
  return api;
}
