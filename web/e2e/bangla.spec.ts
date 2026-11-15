/**
 * A short session in Bangla: set-up, two warm-up exercises, one game and the summary, with no
 * English text on any screen and the report in Bangla.
 */

import type { Page } from "@playwright/test";

import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  MOCK_REPORT,
  resetDatabase,
  setProgramme,
  setReplaySide,
  strings,
  test,
  type TestPatient,
} from "./fixtures";
import {
  calibrate,
  coolDown,
  passSetup,
  playGame,
  startPlan,
  startSession,
  warmUp,
} from "./session";

let patient: TestPatient;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  const admin = await Api.admin(request);
  patient = await createPatient(admin, { side: "left", language: "bn" });
  await setProgramme(admin, patient.id, {
    enabled_games: ["bloom", "reach_activate"],
    games_per_session: { min: 2, max: 2 },
    warmup_exercises: ["shoulder_flexion", "hand_open_close"],
  });
});

/**
 * English fragments of the app's strings that have a different Bangla translation: words long
 * enough to be clearly English, and not also in a Bangla string (names, units).
 */
async function englishFragments(page: Page): Promise<string[]> {
  const en = await strings(page, "en");
  const bn = await strings(page, "bn");
  const bnText = Object.values(bn).join("\n");
  const fragments = new Set<string>();
  for (const [key, english] of Object.entries(en)) {
    if (english === bn[key]) continue;
    for (const part of english.split(/\{[a-zA-Z]+\}/)) {
      const fragment = part.trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
      // Two words or more, or one long word: short ones ("OK", "km") are too ambiguous.
      const words = fragment.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
      if (words.length >= 2 || fragment.length >= 9) {
        if (!bnText.includes(fragment)) fragments.add(fragment);
      }
    }
  }
  return [...fragments];
}

/** The English fragments visible on the page now. */
async function englishOnScreen(page: Page, fragments: string[]): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return fragments.filter((fragment) => text.includes(fragment));
}

test("a short session in Bangla shows no English and a Bangla report", async ({
  page,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(8 * 60_000);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  await page.goto("/patient");
  await expect.poll(() => page.evaluate(() => window.__muviTest?.i18n.language())).toBe("bn");
  const fragments = await englishFragments(page);
  expect(fragments.length).toBeGreaterThan(500);
  const checked: string[] = [];
  const check = async (screen: string) => {
    await page.waitForTimeout(300);
    const found = await englishOnScreen(page, fragments);
    expect(found, `English on ${screen}`).toEqual([]);
    checked.push(screen);
  };
  await check("home");

  const s = await startSession(page);
  expect(s["setup.intro.allow"]).not.toBe("Allow camera");
  await check("camera intro");
  await passSetup(page, s, patient.side);
  await page.getByRole("button", { name: s["calibrate.intro.start"] }).waitFor();
  await check("calibration intro");
  await calibrate(page, s, patient.side);
  await check("warm-up overview");
  await warmUp(page, s, patient.side, {
    reps: testSettings.warmupReps ?? 10,
    order: ["shoulder_flexion", "hand_open_close"],
  });
  await check("plan");

  // One game: leave out Reach and squeeze.
  await page.getByRole("checkbox", { name: new RegExp(s["game.reach_activate.name"]) }).uncheck();
  await startPlan(page, s);
  await check("game");
  await playGame(page, s, patient.side, "bloom");
  await page.getByRole("button", { name: s["cooldown.relax.skip"] }).waitFor();
  await check("cool-down");
  await coolDown(page, s);

  await expect(page.getByText(MOCK_REPORT.bn)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(MOCK_REPORT.en)).toHaveCount(0);
  await check("summary with the report");
  testInfo.annotations.push({ type: "screens checked", description: checked.join(", ") });
});
