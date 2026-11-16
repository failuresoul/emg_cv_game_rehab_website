/**
 * The README's screenshots and diagrams (Day 20). Not part of the normal test runs: run with
 * scripts/docs/make_screenshots.ps1 (or npx playwright test -c playwright.docs.config.ts).
 *
 * Test mode, the demo data (four weeks for two demo patients), the replayed camera (Shadik's
 * recording, shadik_full, for the camera check; synthetic landmarks where a step needs a given
 * movement), the simulated muscle sensor and the mock language model. 1440 x 900 at 2x.
 * Raw PNGs go to docs/images/screens/ and the Mermaid diagrams of docs/architecture.md to
 * docs/images/diagrams/; scripts/docs/optimise_images.py then makes the grids and shrinks them.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";

import { E2E_ADMIN } from "../../playwright.config";
import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  resetDatabase,
  setProgramme,
  setReplaySide,
  settledStrings,
  strings,
  test,
  type TestPatient,
} from "../fixtures";
import {
  ALL_EXERCISES,
  autoPlay,
  calibrate,
  coolDown,
  exerciseScript,
  play,
  sitStill,
  startPlan,
  startSession,
} from "../session";

const ROOT = new URL("../../../", import.meta.url);
const SCREENS = fileURLToPath(new URL("docs/images/screens/", ROOT));
const DIAGRAMS = fileURLToPath(new URL("docs/images/diagrams/", ROOT));
const ARCHITECTURE = fileURLToPath(new URL("docs/architecture.md", ROOT));
const MANIFEST = fileURLToPath(new URL("docs/images/screens/manifest.json", ROOT));
mkdirSync(SCREENS, { recursive: true });
mkdirSync(DIAGRAMS, { recursive: true });

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
] as const;

const captured: string[] = [];
const missed: { name: string; why: string }[] = [];

/** A viewport (or element) screenshot, after the page has settled. */
async function shot(page: Page, name: string, element?: Locator): Promise<void> {
  await page.waitForTimeout(400);
  const path = `${SCREENS}${name}.png`;
  if (element) await element.screenshot({ path, animations: "disabled" });
  else await page.screenshot({ path, animations: "disabled" });
  captured.push(name);
}

/** A screenshot that is good to have: a failure is noted, not fatal. */
async function tryShot(name: string, take: () => Promise<void>): Promise<void> {
  try {
    await take();
  } catch (error) {
    missed.push({ name, why: String(error).split("\n")[0]! });
    console.log(`[screenshots] skipped ${name}: ${String(error).split("\n")[0]}`);
  }
}

const setLevel = (page: Page, level: number) =>
  page.evaluate((value) => window.__muviTest!.emg.setLevel(value), level);

const playRecorded = (page: Page, marker: string) =>
  page.evaluate(
    (step) => window.__muviTest!.vision.playRecording("shadik_full", { loop: true, marker: step }),
    marker,
  );

async function chooseLanguage(page: Page, label: "English" | "বাংলা"): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForLoadState("networkidle");
}

let demo: { email: string; password: string; patient_id: number };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const reset = await resetDatabase(request, { demoPatients: true });
  demo = reset.patients[0]!;
  const admin = await Api.admin(request);
  // A study, so research mode has something to show.
  const today = new Date().toISOString().slice(0, 10);
  await admin.patch(`/api/admin/patients/${demo.patient_id}`, { research_consent_at: today });
  const study = await admin.post<{ id: number }>("/api/admin/studies", {
    name: "Engine comparison (L0, L1, L2)",
    design: "within_subject",
    conditions: ["L0", "L1", "L2"],
    sessions_per_condition: 3,
    games: ["reach_activate"],
    seed: 7,
  });
  await admin.post(`/api/admin/studies/${study.id}/participants`, {
    patient_id: demo.patient_id,
  });
  await admin.patch(`/api/admin/studies/${study.id}`, { status: "active" });
});

test.afterAll(() => {
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ captured: [...new Set(captured)].sort(), missed }, null, 2)}\n`,
  );
});

test("public pages", async ({ page }) => {
  await page.goto("/");
  await settledStrings(page);
  await shot(page, "landing");
  await page.goto("/login");
  await settledStrings(page);
  await shot(page, "login");
});

test("the patient's area, reports and settings (demo patient)", async ({ page }) => {
  await loginWithToken(page, demo.email, demo.password);
  await page.goto("/patient");
  const s = await settledStrings(page);
  await shot(page, "patient-dashboard");

  await page.goto("/patient/progress");
  await settledStrings(page);
  await page.waitForTimeout(800);
  await shot(page, "progress-charts");

  await tryShot("report-en", async () => {
    await page.goto("/patient/reports");
    await settledStrings(page);
    await page.locator('a[href^="/patient/reports/"]').first().click();
    await expect(page).toHaveURL(/\/patient\/reports\/\d+/);
    await page.waitForLoadState("networkidle");
    await shot(page, "report-en");
    // The report's own language switch (the last "বাংলা" button; the first is the header's).
    await page.getByRole("button", { name: "বাংলা", exact: true }).last().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "report-bn");
    await page.getByRole("button", { name: "English", exact: true }).last().click();
  });

  await page.goto("/patient");
  await settledStrings(page);
  await shot(page, "bangla-ui");
  await chooseLanguage(page, "English");

  await page.goto("/patient/profile");
  const profile = await settledStrings(page);
  await tryShot("accessibility-settings", async () => {
    const heading = page.getByRole("heading", { name: profile["display.title"] });
    await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -140));
    await shot(page, "accessibility-settings");
  });
  void s;
});

test("a session with the muscle sensor: check, EMG, calibration, warm-up, games, summary", async ({
  page,
  request,
}, testInfo) => {
  testInfo.setTimeout(25 * 60_000);
  const admin = await Api.admin(request);
  const patient: TestPatient = await createPatient(admin, { side: "right", name: "Ayesha Rahman" });
  await setProgramme(admin, patient.id, {
    enabled_games: ["grip_hold", "reach_activate"],
    games_per_session: { min: 2, max: 2 },
    emg_default_site: "flexors",
  });
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);

  // Camera check with the recorded person.
  await page.getByRole("button", { name: s["setup.intro.allow"] }).click();
  await playRecorded(page, "still_start");
  const next = page.getByRole("button", { name: s["setup.continue"] });
  await expect(next).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, "camera-check");
  await page.getByRole("switch", { name: s["setup.useSensor"] }).click();
  await next.click();
  await expect(page).toHaveURL(/\/session\/emg$/);

  // The muscle sensor: safety, then the simulated sensor's check and calibration.
  for (const key of [
    "emgStep.safety.charger",
    "emgStep.safety.batteries",
    "emgStep.safety.electrodes",
  ]) {
    await page.getByLabel(s[key]).check();
  }
  await page.getByRole("button", { name: s["emgStep.useSimulated"] }).first().click();
  const connect = page.getByRole("button", { name: s["emgStep.useSimulated"] });
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await setLevel(page, 0);
  const squeeze = page.getByRole("button", { name: s["emgStep.testSqueeze"] });
  await expect(squeeze).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await squeeze.click();
  await setLevel(page, 0.8);
  await page.waitForTimeout(2500);
  await setLevel(page, 0);
  await expect(page.getByText(s["emgStep.ready"], { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, "emg-readiness");
  await page.getByRole("button", { name: s["emgStep.toCalibration"] }).click();
  await page.getByRole("button", { name: s["emgStep.cal.startRest"], exact: true }).click();
  const start = page.getByRole("button", { name: s["emgStep.cal.startAttempt"] });
  const save = page.getByRole("button", { name: s["emgStep.summary.save"] });
  let attempt = 0;
  while (!(await save.isVisible()) && attempt < 6) {
    await expect(start.or(save)).toBeVisible({ timeout: 40_000 });
    if (await save.isVisible()) break;
    attempt += 1;
    await start.click();
    await expect(page.getByText(s["emgStep.cal.squeeze"])).toBeVisible({ timeout: 10_000 });
    await setLevel(page, 0.78 + (attempt % 3) * 0.02);
    if (attempt === 1) await shot(page, "emg-calibration");
    await expect(page.getByText(s["emgStep.cal.squeeze"])).toBeHidden({ timeout: 10_000 });
    await setLevel(page, 0);
  }
  await expect(save).toBeVisible({ timeout: 40_000 });
  await shot(page, "emg-calibration-summary");
  await save.click();

  // Reach calibration, part way and at the end.
  await expect(page).toHaveURL(/\/session\/calibrate$/);
  await page.getByRole("button", { name: s["calibrate.intro.start"] }).click();
  await playRecorded(page, "reach_8");
  await page.waitForTimeout(9000);
  await shot(page, "calibration");
  await page.goto("/session/calibrate");
  await settledStrings(page);
  await calibrate(page, s, patient.side).catch(async () => {
    // The page may resume at its intro after the reload.
    await calibrate(page, await strings(page), patient.side);
  });

  // The warm-up: one picture per exercise, and the compensation cue.
  await page.getByRole("button", { name: s["calibrate.intro.start"] }).click();
  for (const [index, exercise] of ALL_EXERCISES.entries()) {
    await sitStill(page, patient.side);
    await page.getByRole("button", { name: s["warmup.showMe"] }).click();
    await page.getByRole("button", { name: s["warmup.gotIt"] }).click();
    if (index === 0) {
      await tryShot("compensation-warning", async () => {
        await play(page, patient.side, [
          { do: "still", ms: 3400 },
          { do: "lean", forwardDeg: 28, ms: 700 },
          { do: "raise", plane: "forward", deg: 100, ms: 1200, holdMs: 1500, back: true },
        ]);
        await expect(page.getByText(s["warmup.cue.back"]).first()).toBeVisible({
          timeout: 15_000,
        });
        await shot(page, "compensation-warning");
      });
      await sitStill(page, patient.side);
      await page.waitForTimeout(1000);
    }
    // Mid-exercise: after the 3-2-1 countdown and into the first repetitions (the first
    // exercise has no countdown left after the compensation example).
    await play(page, patient.side, exerciseScript(exercise, 3));
    await page.waitForTimeout(index === 0 ? 1200 : 5200);
    await shot(page, `warmup-${exercise.replaceAll("_", "-")}`);
    const done = page.getByRole("button", { name: s["warmup.next"] });
    await expect(done).toBeVisible({ timeout: 60_000 });
    await done.click();
    if (index < ALL_EXERCISES.length - 1) {
      await page.getByRole("button", { name: s["warmup.rest.skip"] }).click();
    }
  }
  await sitStill(page, patient.side);
  await page.getByRole("button", { name: s["warmup.complete.continue"] }).click();
  await expect(page).toHaveURL(/\/session\/plan$/);
  await page.waitForTimeout(1000);
  await shot(page, "session-plan");

  // Two games, then the cool-down and the summary.
  await startPlan(page, s);
  for (let game = 0; game < 2; game += 1) {
    await autoPlay(page, patient.side);
    if (game === 0) {
      await page.waitForTimeout(8000);
      await tryShot("level-display", async () => {
        const hud = page.getByText(/^Level \d+$/).first();
        await expect(hud).toBeVisible({ timeout: 20_000 });
        // The game's top bar, where the level is.
        const box = await hud.boundingBox();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${SCREENS}level-display.png`,
          clip: {
            x: 0,
            y: 0,
            width: 1440,
            height: Math.max(80, (box?.y ?? 0) + (box?.height ?? 0) + 40),
          },
        });
        captured.push("level-display");
      });
    }
    const after = page
      .getByRole("button", { name: s["game.nextGame"] })
      .or(page.getByRole("button", { name: s["game.continue"] }));
    await expect(after.first()).toBeVisible({ timeout: 6 * 60_000 });
    if (game === 0) await shot(page, "game-results");
    await sitStill(page, patient.side);
    await after.first().click();
  }
  await coolDown(page, s, { pain: 1, fatigue: 3 });
  await expect(page.getByRole("heading", { name: s["summary.wellDone"] })).toBeVisible();
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "session-end");
});

test("all nine games", async ({ page, request }, testInfo) => {
  testInfo.setTimeout(GAMES.length * 2 * 60_000);
  const patient = await createPatient(await Api.admin(request), { side: "left" });
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  await startSession(page);
  for (const game of GAMES) {
    await tryShot(`game-${game}`, async () => {
      await page.goto(`/session/game/${game}`);
      const s = await settledStrings(page);
      // Opening a game directly offers to continue the session: close that offer.
      const close = page.getByRole("dialog").getByRole("button", { name: s["common.close"] });
      if (await close.isVisible({ timeout: 3000 }).catch(() => false)) await close.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await autoPlay(page, patient.side);
      await expect
        .poll(() => page.evaluate(() => window.__muviTest?.game?.stage), { timeout: 60_000 })
        .toBe("playing");
      await page.waitForTimeout(6000);
      await shot(page, `game-${game.replaceAll("_", "-")}`);
    });
  }
});

test("the admin area", async ({ page }) => {
  await loginWithToken(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await page.goto("/admin");
  const s = await settledStrings(page);
  await page.waitForTimeout(800);
  await shot(page, "admin-dashboard");

  await tryShot("patient-programme", async () => {
    await page.goto(`/admin/patients/${demo.patient_id}`);
    await settledStrings(page);
    await page.getByRole("tab", { name: /programme/i }).click();
    await page.waitForLoadState("networkidle");
    await shot(page, "patient-programme");
  });

  await page.goto("/admin/alerts");
  await settledStrings(page);
  await shot(page, "alerts");

  await page.goto("/admin/research");
  await settledStrings(page);
  await page.waitForTimeout(800);
  await shot(page, "research-mode");

  await page.goto("/admin/system");
  await settledStrings(page);
  await tryShot("emg-settings", async () => {
    const heading = page.getByRole("heading", { name: s["emgSettings.title"] });
    // The panel's heading just under the sticky header.
    await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -110));
    await shot(page, "emg-settings");
  });
});

test("architecture diagrams (Mermaid)", async ({ page }) => {
  const text = readFileSync(ARCHITECTURE, "utf8");
  const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]!);
  const names = ["components", "data-flow", "session-sequence"];
  expect(blocks.length).toBe(names.length);
  for (const [index, code] of blocks.entries()) {
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#fff">
        <pre class="mermaid">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
        <script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
        <script>mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });</script>
      </body></html>`,
    );
    const svg = page.locator("pre.mermaid svg");
    await expect(svg).toBeVisible({ timeout: 30_000 });
    await svg.screenshot({ path: `${DIAGRAMS}${names[index]}.png` });
  }
});
