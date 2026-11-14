import { expect, test } from "@playwright/test";

import { countCameraRequests, resetDatabase, waitForTestApi } from "./helpers";

test("the landing page opens in test mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await waitForTestApi(page);
});

test("the API runs in test mode: a reset gives the admin and no patients", async ({ request }) => {
  const body = await resetDatabase(request, { demoPatients: false });
  expect(body.admin_email).toBe("admin@motionlab.local");
  expect(body.patients).toEqual([]);
});

test("the vision engine replays synthetic landmarks without asking for the camera", async ({
  page,
}) => {
  const cameraRequests = await countCameraRequests(page);
  await page.goto("/dev/exercise-lab?replay=synth:demo");
  await waitForTestApi(page);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__muviTest?.vision.source()))
    .toBe("synthetic");
  // About 30 frames a second, in real time.
  const before = await page.evaluate(() => window.__muviTest?.vision.framesEmitted() ?? 0);
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.__muviTest?.vision.framesEmitted() ?? 0);
  expect(after - before).toBeGreaterThan(20);
  expect(after - before).toBeLessThan(40);
  expect(await cameraRequests()).toBe(0);
});

test("the vision engine replays a recording file from test-fixtures", async ({ page }) => {
  const cameraRequests = await countCameraRequests(page);
  await page.goto("/dev/exercise-lab?replay=synthetic-session&replayLoop=1");
  await waitForTestApi(page);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__muviTest?.vision.source()))
    .toBe("recording");
  await expect
    .poll(() => page.evaluate(() => window.__muviTest?.vision.framesEmitted() ?? 0))
    .toBeGreaterThan(30);
  expect(await cameraRequests()).toBe(0);
});
