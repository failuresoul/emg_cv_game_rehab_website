// Plays a guided landmark recording through the warm-up's own counters (src/testing/repReplay.ts)
// and prints one JSON row per marked step. Used by analysis/validation/rep_accuracy.py.
//   node scripts/export-rep-counts.mjs <recording.json> <left|right>
// Like export-specs.mjs, it loads the TypeScript through Vite's own module loader.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const [file, side] = process.argv.slice(2);
if (!file || (side !== "left" && side !== "right")) {
  console.error("Usage: node scripts/export-rep-counts.mjs <recording.json> <left|right>");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
try {
  const format = await server.ssrLoadModule("/src/testing/landmarkFormat.ts");
  const replay = await server.ssrLoadModule("/src/testing/repReplay.ts");
  const recording = format.parseRecording(JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify(replay.repAccuracy(recording, side)));
} finally {
  await server.close();
}
