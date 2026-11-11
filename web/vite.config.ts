import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { logoMarkSvg } from "./src/components/brand/logoShapes.ts";
import { project } from "./src/config/project.ts";

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

export default defineConfig({
  plugins: [react(), tailwindcss(), identity()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
