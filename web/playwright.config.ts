/**
 * End-to-end tests (Day 18), in headless Chromium, with no webcam, muscle sensor or language
 * model: the camera is replayed or synthetic landmarks, the sensor is simulated and the
 * feedback model is the mock.
 *
 * Playwright starts both servers and stops them afterwards:
 * - the API on port 8001 with APP_ENV=test (which adds /api/test/reset and /seed-session),
 *   LLM_PROVIDER=mock and its own database, data/e2e-test.db, which the tests reset;
 * - the web development server on port 5174 with VITE_TEST_MODE=true.
 * Neither reuses a server that is already running, so a test never touches your own database.
 *
 * Run: npm run e2e (from web/).
 */

import { defineConfig, devices } from "@playwright/test";

export const API_PORT = 8001;
export const WEB_PORT = 5174;
export const E2E_ADMIN = { email: "admin@motionlab.local", password: "e2e-admin-password" };

const python = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // One database for everything: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
        LLM_BN_STRATEGY: "template",
        DATABASE_URL: "sqlite:///../data/e2e-test.db",
        JWT_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only-secret-e2e-only-secret",
        ADMIN_EMAIL: E2E_ADMIN.email,
        ADMIN_PASSWORD: E2E_ADMIN.password,
        ADMIN_NAME: "E2E Admin",
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        VITE_TEST_MODE: "true",
        VITE_API_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
