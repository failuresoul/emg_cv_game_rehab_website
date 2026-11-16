/**
 * The README's screenshots and diagrams (Day 20): not part of the normal test runs.
 *
 *   .\scripts\docs\make_screenshots.ps1          (from the repository root: runs this, then
 *                                                  optimises the PNGs)
 *   npx playwright test -c playwright.docs.config.ts   (from web/: the raw captures only)
 *
 * The same servers as the end-to-end tests (playwright.config.ts): the API in test mode with
 * the mock model and its own database, the web app in test mode (replayed camera, simulated
 * muscle sensor). 1440 x 900 at a device scale factor of 2.
 */

import { defineConfig, devices } from "@playwright/test";

import baseConfig, { WEB_PORT } from "./playwright.config";
import type { TestOptions } from "./e2e/fixtures";

export default defineConfig<TestOptions>({
  ...baseConfig,
  testDir: "./e2e/docs",
  testMatch: "**/*.spec.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    actionTimeout: 30_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "docs", use: { testSettings: { warmupReps: 2, gameTrials: 4 } } }],
});
