import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { waitForTestApi } from "./helpers";

const FIXTURES = fileURLToPath(new URL("../public/test-fixtures/landmarks/", import.meta.url));
const NAME = "e2e-save-check";
const RECORDING = {
  format: "muvi-landmarks",
  version: 1,
  frameWidth: 640,
  frameHeight: 480,
  recordedAt: "2026-11-15T00:00:00Z",
  frames: [{ t: 0, b: 120, h: [], p: null, pw: null }],
};

test.afterEach(() => {
  rmSync(`${FIXTURES}${NAME}.json`, { force: true });
});

test("the guided recorder's checks turn green for a person in view", async ({ page }) => {
  await page.goto("/dev/record-guide?replay=synth:still");
  await waitForTestApi(page);
  const start = page.getByRole("button", { name: "Start recording" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText("Not yet")).toHaveCount(0);
  await start.click();
  await expect(page.getByText("Step 1 of 10")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sit still" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
});

test("the save endpoint writes only a .json file in the landmarks folder", async ({ request }) => {
  const headers = { "Content-Type": "application/json", "X-Muvi-Dev": "1" };
  const saved = await request.post(`/__dev/save-landmarks?name=${NAME}`, {
    headers,
    data: RECORDING,
  });
  expect(saved.status()).toBe(200);
  expect(existsSync(`${FIXTURES}${NAME}.json`)).toBe(true);

  const again = await request.post(`/__dev/save-landmarks?name=${NAME}`, {
    headers,
    data: RECORDING,
  });
  expect(again.status()).toBe(409);
  const escape = await request.post("/__dev/save-landmarks?name=..%2F..%2Fescape", {
    headers,
    data: RECORDING,
  });
  expect(escape.status()).toBe(400);
  const noHeader = await request.post(`/__dev/save-landmarks?name=${NAME}-2`, {
    headers: { "Content-Type": "application/json" },
    data: RECORDING,
  });
  expect(noHeader.status()).toBe(403);
});
