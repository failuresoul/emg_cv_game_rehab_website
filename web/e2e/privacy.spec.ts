/**
 * Privacy: during a whole session no request carries image or video data (only numbers leave
 * the browser), every request stays on this computer, and the camera is let go after the
 * session.
 */

import type { Request } from "@playwright/test";

import { countCameraRequests } from "./helpers";
import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  resetDatabase,
  setProgramme,
  setReplaySide,
  test,
  type TestPatient,
} from "./fixtures";
import {
  calibrate,
  coolDown,
  exitSession,
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
  patient = await createPatient(admin, { side: "right" });
  await setProgramme(admin, patient.id, {
    enabled_games: ["reach_activate", "bloom"],
    games_per_session: { min: 2, max: 2 },
    warmup_exercises: ["shoulder_flexion", "hand_open_close"],
  });
});

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const MEDIA_TYPE = /^(image|video|audio)\/|multipart\/form-data|application\/octet-stream/i;
const MEDIA_TEXT = /data:(image|video|audio)\/|;base64,/i;
/** A long run of base64 characters, as an encoded frame would be. */
const LONG_BASE64 = /[A-Za-z0-9+/=]{4000,}/;

interface Seen {
  url: string;
  method: string;
  type: string;
  body: string;
  bytes: number;
}

function record(request: Request, into: Seen[]): void {
  const buffer = request.postDataBuffer();
  into.push({
    url: request.url(),
    method: request.method(),
    type: request.headers()["content-type"] ?? "",
    body: buffer ? buffer.toString("utf8") : "",
    bytes: buffer?.length ?? 0,
  });
}

test("no image or video leaves the browser during a session, and the camera is let go", async ({
  page,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(10 * 60_000);
  const seen: Seen[] = [];
  page.on("request", (request) => record(request, seen));
  const cameraRequests = await countCameraRequests(page);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);

  const s = await startSession(page);
  await passSetup(page, s, patient.side);
  await calibrate(page, s, patient.side);
  await warmUp(page, s, patient.side, {
    reps: testSettings.warmupReps ?? 10,
    order: ["shoulder_flexion", "hand_open_close"],
  });
  await startPlan(page, s);
  const first = await page.evaluate(() => location.pathname.split("/").pop()!);
  await playGame(page, s, patient.side, first);
  await playGame(page, s, patient.side, first === "bloom" ? "reach_activate" : "bloom");
  await coolDown(page, s);
  await expect(page.getByRole("heading", { name: s["summary.wellDone"] })).toBeVisible();

  // Leaving the session lets go of the camera: the engine stops and no frame is produced.
  await page.getByRole("button", { name: s["summary.home"] }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await expect
    .poll(() => page.evaluate(() => window.__muviTest!.vision.engineStatus()))
    .toBe("idle");
  const frames = await page.evaluate(() => window.__muviTest!.vision.framesEmitted());
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__muviTest!.vision.framesEmitted())).toBe(frames);
  // The replay stood in for the camera: the page never asked for a real one.
  expect(await cameraRequests()).toBe(0);

  const sent = seen.filter((item) => item.method !== "GET");
  expect(sent.length, "requests that send data").toBeGreaterThan(20);
  for (const item of seen) {
    const where = new URL(item.url);
    // Only the page's fonts come from elsewhere (Google Fonts, fetched without any data).
    const local = ["localhost", "127.0.0.1"].includes(where.hostname);
    if (!local) {
      expect(FONT_HOSTS, item.url).toContain(where.hostname);
      expect(item.method, item.url).toBe("GET");
    }
    expect(item.type, `${item.method} ${item.url}`).not.toMatch(MEDIA_TYPE);
    expect(item.body, `${item.method} ${item.url}`).not.toMatch(MEDIA_TEXT);
    expect(item.body, `${item.method} ${item.url}`).not.toMatch(LONG_BASE64);
  }
  // What is sent is JSON (or the login form): numbers and words, not media.
  for (const item of sent.filter((entry) => entry.bytes > 0)) {
    expect(item.type, item.url).toMatch(/application\/json|application\/x-www-form-urlencoded/);
  }
  testInfo.annotations.push({
    type: "requests",
    description: `${seen.length} requests, ${sent.length} sending data, largest body ${Math.max(...sent.map((item) => item.bytes))} bytes`,
  });
});

test("leaving mid-session also lets go of the camera", async ({ page }) => {
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);
  await passSetup(page, s, patient.side);
  await expect
    .poll(() => page.evaluate(() => window.__muviTest!.vision.engineStatus()))
    .toBe("running");
  await exitSession(page, s);
  await expect
    .poll(() => page.evaluate(() => window.__muviTest!.vision.engineStatus()))
    .toBe("idle");
});
