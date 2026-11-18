/**
 * The demo video (Day 21): not part of the normal test runs.
 *
 *   .\scripts\demo\make_demo.ps1                      (from the repository root: voice, recording,
 *                                                       then the MP4)
 *   npx playwright test -c playwright.demo.config.ts  (from web/: the recording only)
 *
 * Test mode with the demo data (its own database, data/demo-video.db), the replayed camera
 * (shadik_full) and synthetic movements, the simulated muscle sensor, 1920 x 1080 with the video
 * recorded. The feedback model is chosen by DEMO_LLM: "mock" (default) or "ollama" (the real local
 * model, LLM_MODEL from the environment or qwen3.5:4b).
 */

import { defineConfig, devices } from "@playwright/test";

import baseConfig, { API_PORT, WEB_PORT } from "./playwright.config";
import type { TestOptions } from "./e2e/fixtures";

export const DEMO_SIZE = { width: 1920, height: 1080 };
const llm = process.env.DEMO_LLM === "ollama" ? "ollama" : "mock";

const servers = Array.isArray(baseConfig.webServer) ? baseConfig.webServer : [];
const [api, web] = servers;
if (!api || !web) throw new Error("playwright.config.ts must start the API and the web app");

const apiEnv: Record<string, string> = {
  ...(api.env ?? {}),
  DATABASE_URL: "sqlite:///../data/demo-video.db",
  ADMIN_NAME: "Therapist (demo)",
  LLM_PROVIDER: llm,
};
if (llm === "ollama") {
  // The app's own Bangla strategy and model, not the tests' shortcut.
  delete apiEnv.LLM_BN_STRATEGY;
  if (process.env.LLM_MODEL) apiEnv.LLM_MODEL = process.env.LLM_MODEL;
  // A laptop CPU can take minutes for a Bangla report: let the job run, not fall back early.
  apiEnv.LLM_TIMEOUT_S = "180";
  apiEnv.LLM_JOB_LIMIT_S = "360";
}

export default defineConfig<TestOptions>({
  ...baseConfig,
  testDir: "./e2e/demo",
  testMatch: "**/*.spec.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: DEMO_SIZE,
    deviceScaleFactor: 1,
    actionTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: { mode: "on", size: DEMO_SIZE },
  },
  projects: [{ name: "demo", use: { testSettings: { warmupReps: 4, gameTrials: 8 } } }],
  webServer: [
    { ...api, env: apiEnv },
    { ...web, env: { ...(web.env ?? {}), VITE_API_TARGET: `http://localhost:${API_PORT}` } },
  ],
});
