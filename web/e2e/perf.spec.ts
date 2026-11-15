/**
 * Frame budget (Day 18): each game played on replayed landmarks for a while, measuring the game
 * loop's update and render time per frame and its frames a second. Run with npm run e2e:perf;
 * the results go to analysis/results/perf_frames.json (and docs/performance.md by hand).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  resetDatabase,
  setReplaySide,
  settledStrings,
  test,
  type TestPatient,
} from "./fixtures";
import { autoPlay, startSession } from "./session";

const GAMES = [
  "reach_activate",
  "balloon_pop",
  "fruit_catch",
  "bloom",
  "finger_piano",
  "path_trace",
  "paint_wall",
  "pick_place",
  "grip_hold",
];
const PLAY_MS = 12_000;
const RESULTS = fileURLToPath(new URL("../../analysis/results/perf_frames.json", import.meta.url));

let patient: TestPatient;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  patient = await createPatient(await Api.admin(request), { side: "left" });
});

test("every game keeps to the frame budget on replay", async ({ page }, testInfo) => {
  testInfo.setTimeout(GAMES.length * 60_000);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  await startSession(page);
  const results: Record<string, unknown> = {};

  for (const game of GAMES) {
    await test.step(game, async () => {
      await page.goto(`/session/game/${game}`);
      const s = await settledStrings(page);
      const resume = page.getByRole("dialog").getByRole("button", { name: s["resume.continue"] });
      if (await resume.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.goto(`/session/game/${game}`);
        await settledStrings(page);
      }
      await autoPlay(page, patient.side);
      await expect
        .poll(() => page.evaluate(() => window.__muviTest?.game?.stage), { timeout: 30_000 })
        .toBe("playing");
      await page.evaluate(() => window.__muviTest!.perf.reset());
      const framesBefore = await page.evaluate(() => window.__muviTest!.vision.framesEmitted());
      await page.waitForTimeout(PLAY_MS);
      const report = await page.evaluate((id) => window.__muviTest!.perf.report()[id], game);
      const visionFrames =
        (await page.evaluate(() => window.__muviTest!.vision.framesEmitted())) - framesBefore;
      results[game] = { ...report, replayFps: visionFrames / (PLAY_MS / 1000) };
      expect(report, game).toBeTruthy();
      expect(report.fps, `${game} loop FPS`).toBeGreaterThanOrEqual(30);
      expect(report.p95Ms, `${game} p95 frame time`).toBeLessThan(33);
    });
  }
  writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  testInfo.annotations.push({ type: "frames", description: JSON.stringify(results) });
});
