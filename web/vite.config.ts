import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { configDefaults } from "vitest/config";

import { saveLandmarksPlugin } from "./plugins/saveLandmarks.ts";
import { logoMarkSvg } from "./src/components/brand/logoShapes.ts";
import { project } from "./src/config/project.ts";
import { SECURITY_HEADERS } from "./securityHeaders.ts";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The favicon, tab title and meta description, generated from src/config/project.ts and the
 * logo mark so they never drift from the app. */
function identity(): Plugin {
  const favicon = logoMarkSvg();
  return {
    name: "muvi-identity",
    transformIndexHtml: (html) =>
      html
        .replace("%APP_TITLE%", escapeHtml(project.tabTitle))
        .replace("%APP_DESCRIPTION%", escapeHtml(project.tagline)),
    configureServer(server) {
      server.middlewares.use("/favicon.svg", (_request, response) => {
        response.setHeader("Content-Type", "image/svg+xml");
        response.end(favicon);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "favicon.svg", source: favicon });
    },
  };
}

/** Test fixtures (public/test-fixtures: landmark recordings for the end-to-end tests, Day 18) are
 * served by the development server only; a production build leaves them out. */
function noTestFixtures(): Plugin {
  let outDir = "dist";
  return {
    name: "muvi-no-test-fixtures",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, "test-fixtures"), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), identity(), noTestFixtures(), saveLandmarksPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  // The end-to-end tests' server (VITE_TEST_MODE) finds every dependency when it starts, so it
  // never re-optimises (and reloads the page) in the middle of a test.
  ...(process.env.VITE_TEST_MODE === "true"
    ? { optimizeDeps: { entries: ["index.html", "src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"] } }
    : {}),
  // Vitest leaves out the Playwright tests (e2e/*.spec.ts).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // The production build served as nginx serves it, with its security headers.
  preview: { headers: SECURITY_HEADERS },
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_API_TARGET ?? "http://localhost:8000",
    },
    watch: {
      // File change events do not reach Docker containers on Windows.
      usePolling: process.env.CHOKIDAR_USEPOLLING === "true",
    },
  },
});
