import { E2E_ADMIN } from "../playwright.config";

import {
  Api,
  createPatient,
  expect,
  resetDatabase,
  strings,
  type Strings,
  test,
  type TestPatient,
} from "./fixtures";

let patient: TestPatient;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  patient = await createPatient(await Api.admin(request));
});

async function logIn(
  page: import("@playwright/test").Page,
  s: Strings,
  email: string,
  password: string,
) {
  await page.getByLabel(s["login.email"]).fill(email);
  await page.getByLabel(s["login.password"], { exact: true }).fill(password);
  await page.getByRole("button", { name: s["login.submit"] }).click();
}

test("from the landing page, the admin logs in and lands on the admin pages", async ({ page }) => {
  await page.goto("/");
  const s = await strings(page);
  await page.getByRole("link", { name: s["landing.login"] }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, s, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin$/);
});

test("a patient logs in and lands on their home page", async ({ page }) => {
  await page.goto("/login");
  const s = await strings(page);
  await logIn(page, s, patient.email, patient.password);
  await expect(page).toHaveURL(/\/patient$/);
  await expect(
    page.getByRole("button", { name: s["nav.patient.startSession"] }).first(),
  ).toBeVisible();
});

test("a wrong password is refused with a clear message", async ({ page }) => {
  await page.goto("/login");
  const s = await strings(page);
  await logIn(page, s, patient.email, "not-the-password");
  await expect(page.getByText(s["login.error.invalid"])).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("typed addresses are guarded by role", async ({ page }) => {
  // Without logging in: any private page sends to the login page.
  for (const path of ["/patient", "/admin", "/session/setup", "/admin/patients"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
  const s = await strings(page);
  await logIn(page, s, patient.email, patient.password);
  await expect(page).toHaveURL(/\/patient$/);
  // A patient typing admin addresses goes back to their own home.
  for (const path of ["/admin", "/admin/patients", "/admin/research", "/admin/system"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/patient$/);
  }
  // And the admin's API refuses them.
  const api = await Api.login(page.request, patient.email, patient.password);
  const response = await page.request.get("http://localhost:8001/api/admin/patients", {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  expect(response.status()).toBe(403);
});

test("the admin typing patient addresses goes back to the admin pages", async ({ page }) => {
  await page.goto("/login");
  const s = await strings(page);
  await logIn(page, s, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of ["/patient", "/patient/history", "/session/setup"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin$/);
  }
});

test("the login survives a reload, and logging out ends it", async ({ page }) => {
  await page.goto("/login");
  const s = await strings(page);
  await logIn(page, s, patient.email, patient.password);
  await expect(page).toHaveURL(/\/patient$/);
  await page.goto("/patient/history");
  await page.reload();
  await expect(page).toHaveURL(/\/patient\/history$/);

  await page.getByRole("button", { name: s["nav.logout"] }).first().click();
  await expect(page).not.toHaveURL(/\/patient/);
  await page.goto("/patient");
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem("motionlab_token"))).toBeNull();
});
