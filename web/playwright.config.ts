/**
 * End-to-end tests (Day 18), in headless Chromium, with no webcam, muscle sensor or language
 * model: the camera is replayed or synthetic landmarks, the sensor is simulated and the
 * feedback model is the mock.
 *
 * Playwright starts both servers and stops them afterwards:
 * - the API on port 8001 with APP_ENV=test (which adds the /api/test routes),
 *   LLM_PROVIDER=mock and its own database, data/e2e-test.db, which the tests reset;
 * - the web development server on port 5174 with VITE_TEST_MODE=true.
 * Neither reuses a server that is already running, so a test never touches your own database.
 *
 * Projects:
 * - fast (npm run e2e): every suite, with short warm-ups and games (test settings);
 * - full (npm run e2e:full): the main patient journey at its real length.
 */

import { defineConfig, devices } from "@playwright/test";

import type { TestOptions, TestSettings } from "./e2e/fixtures";

export const API_PORT = 8001;
export const WEB_PORT = 5174;
export const E2E_ADMIN = { email: "admin@motionlab.local", password: "e2e-admin-password" };

const python = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

/** Warm-up repetitions and game trials in the fast project. */
export const FAST_SETTINGS: TestSettings = { warmupReps: 2, gameTrials: 2 };

export default defineConfig<TestOptions>({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One database for everything: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // One retry, with a trace, so a flaky step can be looked at.
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    trace: "on-first-retry",
    // A step that cannot be done fails in half a minute, not at the end of a long test.
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "fast",
      use: { testSettings: FAST_SETTINGS },
    },
    {
      name: "full",
      testMatch: "patient-session.spec.ts",
      timeout: 20 * 60_000,
      use: { testSettings: {} },
    },
  ],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --port ${API_PORT}`,
      cwd: "../server",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        APP_ENV: "test",
        LLM_PROVIDER: "mock",
        LLM_BN_STRATEGY: "direct",
        DATABASE_URL: "sqlite:///../data/e2e-test.db",
        JWT_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only-secret-e2e-only-secret",
        ADMIN_EMAIL: E2E_ADMIN.email,
        ADMIN_PASSWORD: E2E_ADMIN.password,
        ADMIN_NAME: "E2E Admin",
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        // Reports wait less for the session's end, so the summary shows them sooner.
        FEEDBACK_SESSION_END_WAIT_S: "2",
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Shown in the run's output: a re-optimisation or page reload would explain a failure.
      stdout: "pipe",
      stderr: "pipe",
      env: {
        VITE_TEST_MODE: "true",
        VITE_API_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
