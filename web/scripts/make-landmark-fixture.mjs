// Writes public/test-fixtures/landmarks/synthetic-session.json: a landmark recording made from the
// synthetic generator (src/testing/synthLandmarks.ts), in the same format as the Exercise Lab's
// "Record landmarks", so the end-to-end tests can check the file replay without a real recording.
// Run with `npm run fixtures:landmarks` after changing the generator or the format.
//
// Like export-specs.mjs, it loads the TypeScript through Vite's own module loader.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const NAME = "synthetic-session";
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
try {
  const synth = await server.ssrLoadModule("/src/testing/synthLandmarks.ts");
  const format = await server.ssrLoadModule("/src/testing/landmarkFormat.ts");
  const frames = synth.generateFrames({
    affectedSide: "left",
    seed: 7,
    steps: [
      { do: "still", ms: 2000 },
      { do: "raise", plane: "forward", deg: 80, ms: 1500, holdMs: 500, back: true },
      { do: "reach", to: { x: 1.0, y: 0.2 }, ms: 1200, holdMs: 600, back: true },
      { do: "hand", open: 0, ms: 500, holdMs: 800 },
      { do: "hand", open: 1, ms: 500, holdMs: 500 },
      { do: "still", ms: 1000 },
    ],
  });
  const recorder = new format.LandmarkRecorder();
  for (const frame of frames) {
    recorder.add({
      timestamp: frame.t,
      hand: frame.hands[0]?.landmarks ?? null,
      hands: frame.hands,
      pose: frame.pose,
      poseWorld: frame.poseWorld,
      fps: 30,
      delegate: "GPU",
      brightness: frame.brightness,
      frameWidth: synth.SYNTH_FRAME_WIDTH,
      frameHeight: synth.SYNTH_FRAME_HEIGHT,
    });
  }
  const text = format.serialiseRecording(recorder.toRecording(new Date("2026-11-14T00:00:00Z")));
  const directory = fileURLToPath(new URL("../public/test-fixtures/landmarks/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}${NAME}.json`, text, "utf8");
  console.log(
    `Wrote ${NAME}.json (${recorder.frameCount} frames, ${(text.length / 1024).toFixed(0)} kB)`,
  );
} finally {
  await server.close();
}
