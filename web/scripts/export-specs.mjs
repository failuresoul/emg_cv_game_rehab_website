// Writes shared/game-specs.json from the game registry, for the server to check the admin's game
// defaults against. Run with `npm run export:specs` after changing any game's settings.
//
// The registry is TypeScript with "@/" imports, so it is loaded through Vite's own module loader
// rather than a separate TypeScript runner.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
try {
  const specs = await server.ssrLoadModule("/src/games/shared/gameSpecs.ts");
  const target = fileURLToPath(new URL(`../../${specs.GAME_SPECS_PATH}`, import.meta.url));
  writeFileSync(target, specs.gameSpecsJson(), "utf8");
  console.log(`Wrote ${specs.GAME_SPECS_PATH} (${specs.exportGameSpecs().games.length} games)`);
} finally {
  await server.close();
}
