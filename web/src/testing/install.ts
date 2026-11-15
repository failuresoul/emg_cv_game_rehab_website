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

import type { FrameReport, MuviTestApi } from "./testMode";

interface FrameSamples {
  times: number[];
  first: number;
  last: number;
}

function frameReport(samples: FrameSamples): FrameReport {
  const sorted = [...samples.times].sort((a, b) => a - b);
  const pick = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.round(share * (sorted.length - 1)))];
  const seconds = (samples.last - samples.first) / 1000;
  return {
    frames: sorted.length,
    meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p95Ms: pick(0.95),
    maxMs: sorted[sorted.length - 1],
    fps: seconds > 0 ? (sorted.length - 1) / seconds : 0,
  };
}
import { testVisionFeed } from "./visionFeed";

export function installTestApi(): MuviTestApi {
  const frames = new Map<string, FrameSamples>();
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
    perf: {
      record: (gameId, frameMs, wallMs) => {
        const samples = frames.get(gameId) ?? { times: [], first: wallMs, last: wallMs };
        samples.times.push(frameMs);
        samples.last = wallMs;
        frames.set(gameId, samples);
      },
      report: () =>
        Object.fromEntries([...frames].map(([gameId, samples]) => [gameId, frameReport(samples)])),
      reset: () => frames.clear(),
    },
    i18n: {
      values: (language) => ({ ...(language === "bn" ? bn : en) }),
      language: () => getLanguage(),
    },
  };
  window.__muviTest = api;
  return api;
}
