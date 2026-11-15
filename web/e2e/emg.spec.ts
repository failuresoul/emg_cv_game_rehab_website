/**
 * The muscle sensor, simulated: the sensor check reaches "ready" with a test squeeze, the
 * calibration (rest and three efforts) is saved, Grip and hold is played with the sensor, and
 * pulling the cable mid-game turns the dot amber, switches to the camera and recovers when it
 * is plugged back in.
 */

import type { Page } from "@playwright/test";

import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  resetDatabase,
  setProgramme,
  setReplaySide,
  type Strings,
  test,
  type TestPatient,
} from "./fixtures";
import { autoPlay, calibrate, sitStill, startPlan, startSession, warmUp } from "./session";

let patient: TestPatient;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  const admin = await Api.admin(request);
  patient = await createPatient(admin, { side: "left" });
  await setProgramme(admin, patient.id, {
    enabled_games: ["grip_hold", "bloom"],
    games_per_session: { min: 2, max: 2 },
    warmup_exercises: ["hand_open_close"],
    emg_default_site: "flexors",
  });
});

const setLevel = (page: Page, level: number | null) =>
  page.evaluate((value) => window.__muviTest!.emg.setLevel(value), level);

/** The top bar's sensor dot, by its (hidden) state text. */
const dot = (page: Page, s: Strings) =>
  page.getByRole("banner").getByRole("button", { name: new RegExp(s["emgDot.label"]) });

/**
 * Keeps the simulated sensor at whatever `want()` gives (0-1) until stopped. Returns the stop
 * function. Runs beside the test's own steps.
 */
function drive(page: Page, want: () => Promise<number | null>): () => Promise<void> {
  let running = true;
  const loop = (async () => {
    while (running) {
      const level = await want().catch(() => null);
      if (level !== null) await setLevel(page, level).catch(() => undefined);
      await page.waitForTimeout(100).catch(() => undefined);
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}

/**
 * In Grip and hold, a closed loop on the game's own level: the sensor is moved until the level
 * the game reads is the one its target asks for.
 */
function holdTheBand(page: Page): () => Promise<void> {
  let sensor = 0;
  return drive(page, async () => {
    const state = await page.evaluate(() => ({
      target: window.__muviTest?.currentTarget?.level ?? null,
      level: window.__muviTest?.game?.level ?? null,
    }));
    if (state.target === null || state.level === null) return null;
    if (state.target === 0) sensor = 0;
    else sensor = Math.min(1, Math.max(0, sensor + 0.4 * (state.target - state.level)));
    return sensor;
  });
}

test("the simulated sensor is checked, calibrated, used in Grip and hold, lost and recovered", async ({
  page,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(10 * 60_000);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);

  await test.step("set-up with the muscle sensor turned on", async () => {
    await page.getByRole("button", { name: s["setup.intro.allow"] }).click();
    await sitStill(page, patient.side);
    await page.getByRole("switch", { name: s["setup.useSensor"] }).click();
    const next = page.getByRole("button", { name: s["setup.continue"] });
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();
    await expect(page).toHaveURL(/\/session\/emg$/);
  });

  await test.step("safety and site, then the simulated sensor", async () => {
    for (const key of [
      "emgStep.safety.charger",
      "emgStep.safety.batteries",
      "emgStep.safety.electrodes",
    ]) {
      await page.getByLabel(s[key]).check();
    }
    // The programme's default site is chosen already.
    await expect(
      page.getByRole("radio", { name: new RegExp(s["emgStep.site.flexors"]) }),
    ).toBeChecked();
    await page.getByRole("button", { name: s["emgStep.useSimulated"] }).first().click();
    const connect = page.getByRole("button", { name: s["emgStep.useSimulated"] });
    if (await connect.isVisible().catch(() => false)) await connect.click();
  });

  await test.step("the sensor check reaches ready after a test squeeze", async () => {
    await setLevel(page, 0);
    const squeeze = page.getByRole("button", { name: s["emgStep.testSqueeze"] });
    await expect(squeeze).toBeEnabled({ timeout: 20_000 });
    await squeeze.click();
    const prompt = page.getByText(new RegExp(s["emgStep.squeezeNow"].split("…")[0]));
    await expect(prompt).toBeVisible();
    await setLevel(page, 0.8);
    await expect(prompt).toBeHidden({ timeout: 15_000 });
    await setLevel(page, 0);
    await expect(page.getByText(s["emgStep.ready"], { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dot(page, s)).toContainText(s["emgDot.on"]);
    await page.getByRole("button", { name: s["emgStep.toCalibration"] }).click();
  });

  await test.step("calibration: rest, then three efforts", async () => {
    await page.getByRole("button", { name: s["emgStep.cal.startRest"], exact: true }).click();
    const effortText = page.getByText(s["emgStep.cal.squeeze"]);
    let effort = 0;
    const stop = drive(page, async () => {
      if (await effortText.isVisible()) return 0.78 + (effort % 3) * 0.02;
      return 0;
    });
    const start = page.getByRole("button", { name: s["emgStep.cal.startAttempt"] });
    const save = page.getByRole("button", { name: s["emgStep.summary.save"] });
    for (let attempt = 0; attempt < 6 && !(await save.isVisible()); attempt++) {
      await expect(start.or(save)).toBeVisible({ timeout: 40_000 });
      if (await save.isVisible()) break;
      effort++;
      await start.click();
      await expect(start.or(save)).toBeVisible({ timeout: 40_000 });
    }
    await stop();
    await expect(page.getByRole("heading", { name: s["emgStep.summary.title"] })).toBeVisible();
    await save.click();
    await expect(page).toHaveURL(/\/session\/calibrate$/);
  });

  await calibrate(page, s, patient.side);
  await warmUp(page, s, patient.side, {
    reps: testSettings.warmupReps ?? 10,
    order: ["hand_open_close"],
  });
  await page.getByRole("checkbox", { name: new RegExp(s["game.bloom.name"]) }).uncheck();
  await startPlan(page, s);
  await expect(page).toHaveURL(/\/session\/game\/grip_hold$/);

  await test.step("Grip and hold uses the sensor", async () => {
    await sitStill(page, patient.side);
    await expect.poll(() => page.evaluate(() => window.__muviTest?.game?.source)).toBe("emg");
  });
  let stop = holdTheBand(page);

  await test.step("the cable is pulled: amber dot, the camera takes over", async () => {
    await expect.poll(() => page.evaluate(() => window.__muviTest?.game?.stage)).toBe("playing");
    await page.waitForTimeout(1500);
    await stop();
    await page.evaluate(() => window.__muviTest!.emg.unplug());
    await expect(dot(page, s)).toContainText(s["emgDot.paused"]);
    await expect(page.getByText(s["game.emgPaused"])).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__muviTest?.game?.source)).not.toBe("emg");
    // Played with the camera's hand meanwhile.
    await autoPlay(page, patient.side);
    await page.waitForTimeout(2000);
  });

  await test.step("plugged back in: the sensor is used again", async () => {
    await page.evaluate(() => window.__muviTest!.emg.replug());
    await expect(dot(page, s)).toContainText(s["emgDot.on"], { timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => window.__muviTest?.game?.source), { timeout: 20_000 })
      .toBe("emg");
    await expect(page.getByText(s["game.emgPaused"])).toBeHidden();
    await sitStill(page, patient.side);
    stop = holdTheBand(page);
  });

  await test.step("the game finishes", async () => {
    const next = page.getByRole("button", { name: s["game.continue"] });
    await expect(next).toBeVisible({ timeout: 4 * 60_000 });
    await stop();
    await expect(page.getByText(s["game.results.title"])).toBeVisible();
  });
});
