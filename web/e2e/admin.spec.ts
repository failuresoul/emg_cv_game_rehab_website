/**
 * The admin's work: patients (create, edit, deactivate and activate), a programme, the Game
 * Library, alerts and a study.
 */

import type { Page } from "@playwright/test";

import {
  Api,
  API_URL,
  createPatient,
  expect,
  loginWithToken,
  PATIENT_PASSWORD,
  resetDatabase,
  settledStrings,
  type Strings,
  test,
} from "./fixtures";

const ADMIN = { email: "admin@muvi.local", password: "e2e-admin-password" };

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
});

async function openAdmin(page: Page, path: string): Promise<Strings> {
  await loginWithToken(page, ADMIN.email, ADMIN.password);
  await page.goto(path);
  return settledStrings(page);
}

test("create a patient, edit them, deactivate and activate them", async ({ page }) => {
  const s = await openAdmin(page, "/admin/patients");
  const email = `e2e.created${Date.now()}@example.com`;

  await test.step("create", async () => {
    await page.getByRole("button", { name: s["admin.addPatient"] }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(s["patientForm.fullName"]).fill("Rahima Created");
    await dialog.getByLabel(s["patientForm.email"]).fill(email);
    await dialog.getByLabel(s["patientForm.password"], { exact: true }).fill(PATIENT_PASSWORD);
    await dialog.getByLabel(s["patientForm.affectedSide"]).selectOption("left");
    await dialog.getByLabel(s["patientForm.dominantSide"]).selectOption("right");
    await dialog.getByLabel(s["patientForm.ageBand"]).selectOption("60-69");
    await dialog.getByRole("button", { name: s["admin.addPatient"] }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole("cell", { name: "Rahima Created" })
        .or(page.getByText("Rahima Created"))
        .first(),
    ).toBeVisible();
  });

  await test.step("edit", async () => {
    await page
      .getByRole("link", { name: s["patients.viewLabel"].replace("{name}", "Rahima Created") })
      .click();
    await expect(page).toHaveURL(/\/admin\/patients\/\d+$/);
    await page.getByRole("button", { name: s["patient.edit"] }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(s["patientForm.fullName"]).fill("Rahima Edited");
    await dialog.getByRole("button", { name: s["common.save"] }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Rahima Edited");
  });

  await test.step("deactivate: the patient can no longer log in", async () => {
    await page.getByRole("button", { name: s["patient.deactivate"] }).click();
    await page.getByRole("dialog").getByRole("button", { name: s["patient.deactivate"] }).click();
    await expect(page.getByText(s["patient.deactivated"])).toBeVisible();
    const login = await page.request.post(`${API_URL}/api/auth/login`, {
      form: { username: email, password: PATIENT_PASSWORD },
    });
    expect(login.status()).not.toBe(200);
  });

  await test.step("activate again", async () => {
    await page.getByRole("button", { name: s["patient.activate"] }).click();
    await page.getByRole("dialog").getByRole("button", { name: s["patient.activate"] }).click();
    await expect(page.getByText(s["patient.activated"])).toBeVisible();
    await Api.login(page.request, email, PATIENT_PASSWORD);
  });
});

test("set a programme: one game off, a highest level, two games, gentle warm-up", async ({
  page,
}) => {
  const admin = await Api.admin(page.request);
  const patient = await createPatient(admin);
  const s = await openAdmin(page, `/admin/patients/${patient.id}`);
  await page.getByRole("tab", { name: s["patient.tab.programme"] }).click();

  await page.getByRole("switch", { name: s["game.paint_wall.name"] }).click();
  await page
    .getByRole("slider", {
      name: s["programme.games.levelFor"].replace("{game}", s["game.reach_activate.name"]),
    })
    .fill("4");
  await page.getByLabel(s["programme.session.gamesMin"]).fill("2");
  await page.getByLabel(s["programme.session.gamesMax"]).fill("2");
  await page.getByLabel(s["programme.warmup.preset"]).selectOption("gentle");
  await page.getByRole("button", { name: s["programme.save"] }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(s["programme.reason"]).fill("E2E: lighter programme");
  await dialog.getByRole("button", { name: s["programme.confirm"] }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByText(s["programme.history.reason"].replace("{reason}", "E2E: lighter programme"))
      .first(),
  ).toBeVisible();

  const programme = await admin.get<{
    enabled_games: string[];
    max_level: Record<string, number>;
    games_per_session: { min: number; max: number };
    warmup_preset: string;
  }>(`/api/admin/patients/${patient.id}/programme`);
  expect(programme.enabled_games).not.toContain("paint_wall");
  expect(programme.max_level.reach_activate).toBe(4);
  expect(programme.games_per_session).toEqual({ min: 2, max: 2 });
  expect(programme.warmup_preset).toBe("gentle");
  // The patient's own view follows.
  const patientApi = await Api.login(page.request, patient.email, patient.password);
  const own = await patientApi.get<{ warmup_preset?: string; enabled_games?: string[] }>(
    "/api/patient/programme",
  );
  expect(JSON.stringify(own)).toContain("gentle");
});

test("the Game Library hides a game from patients, and shows it again", async ({ page }) => {
  const admin = await Api.admin(page.request);
  const s = await openAdmin(page, "/admin/games");
  const name = s["game.fruit_catch.name"];
  const toggle = page.getByRole("switch", {
    name: s["adminGames.enabledLabel"].replace("{name}", name),
  });
  const save = page.getByRole("button", { name: s["adminGames.save"], exact: true });
  // The game's own card: the smallest box with both its switch and a Save button.
  const card = page.locator("div").filter({ has: toggle }).filter({ has: save }).last();
  await toggle.click();
  await card.getByRole("button", { name: s["adminGames.save"], exact: true }).click();
  await expect(page.getByText(s["adminGames.saved"].replace("{name}", name))).toBeVisible();
  const games = await admin.get<{ spec: { id: string }; enabled: boolean }[]>("/api/admin/games");
  expect(games.find((game) => game.spec.id === "fruit_catch")?.enabled).toBe(false);

  await toggle.click();
  await card.getByRole("button", { name: s["adminGames.save"], exact: true }).click();
  await expect
    .poll(
      async () =>
        (await admin.get<{ spec: { id: string }; enabled: boolean }[]>("/api/admin/games")).find(
          (game) => game.spec.id === "fruit_catch",
        )?.enabled,
    )
    .toBe(true);
});

test("an alert is acknowledged with a note, then resolved", async ({ page }) => {
  const admin = await Api.admin(page.request);
  const patient = await createPatient(admin);
  const seeded = await page.request.post(`${API_URL}/api/test/seed-session`, {
    data: { patient_id: patient.id, pain: true },
  });
  expect(seeded.status()).toBe(201);
  const s = await openAdmin(page, "/admin/alerts");
  const row = page
    .getByRole("row")
    .filter({ hasText: patient.code })
    .filter({ hasText: s["alert.type.pain"] });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: s["alert.acknowledge"] }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(s["alert.note"]).fill("Called the patient; pain eased.");
  await dialog.getByRole("button", { name: s["alert.acknowledge"] }).click();
  await expect(row).toContainText(s["alert.status.acknowledged"]);

  await row.getByRole("button", { name: s["alert.resolve"] }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: s["alert.resolve"] }).click();
  await expect(page.getByText(s["alert.resolvedToast"])).toBeVisible();
  const alerts = await admin.get<
    { patient_id: number; type: string; status: string; note: string | null }[]
  >("/api/admin/alerts?status=resolved");
  const pain = alerts.find((alert) => alert.patient_id === patient.id && alert.type === "pain");
  expect(pain?.status).toBe("resolved");
  expect(pain?.note).toContain("pain eased");
});

test("create a study and enrol a patient", async ({ page }) => {
  const admin = await Api.admin(page.request);
  const patient = await createPatient(admin);
  await admin.patch(`/api/admin/patients/${patient.id}`, {
    research_consent_at: new Date().toISOString().slice(0, 10),
  });
  const s = await openAdmin(page, "/admin/research");
  await page.getByRole("button", { name: s["study.new"] }).click();
  await page.getByLabel(s["study.form.name"]).fill("E2E admin study");
  // Switches are named by their label; a chosen game's label starts with its place ("1. ").
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const setSwitch = async (name: string, on: boolean) => {
    const toggle = page.getByRole("switch", { name: new RegExp(`^(\\d+\\. )?${escape(name)}$`) });
    if (((await toggle.getAttribute("aria-checked")) === "true") !== on) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
  };
  await setSwitch(s["adminLevels.mode.L0"], true);
  await setSwitch(s["adminLevels.mode.L1"], false);
  await setSwitch(s["adminLevels.mode.L2"], true);
  for (const game of [
    "reach_activate",
    "grip_hold",
    "balloon_pop",
    "fruit_catch",
    "finger_piano",
    "path_trace",
    "paint_wall",
    "pick_place",
  ]) {
    await setSwitch(s[`game.${game}.name`], false);
  }
  await setSwitch(s["game.bloom.name"], true);
  await page.getByRole("button", { name: s["study.form.create"] }).click();

  // A new study opens by itself; open it if not.
  const enrolField = page.getByLabel(s["study.enrol.patient"]);
  await page.getByRole("button", { name: /E2E admin study/ }).waitFor();
  if (!(await enrolField.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.getByRole("button", { name: /E2E admin study/ }).click();
  }
  await page.getByLabel(s["study.enrol.patient"]).selectOption({ label: patient.code });
  await page.getByRole("button", { name: s["study.enrol.button"] }).click();
  await expect(page.getByRole("row").filter({ hasText: patient.code })).toBeVisible();
  await page.getByRole("button", { name: s["study.start"] }).click();
  await page.getByRole("dialog").getByRole("button").last().click();

  const studies = await admin.get<
    {
      name: string;
      status: string;
      conditions: string[];
      games: string[];
      participants: number;
    }[]
  >("/api/admin/studies");
  const study = studies.find((item) => item.name === "E2E admin study")!;
  expect(study.conditions.sort()).toEqual(["L0", "L2"]);
  expect(study.games).toEqual(["bloom"]);
  expect(study.participants).toBe(1);
  await expect
    .poll(
      async () =>
        (await admin.get<{ name: string; status: string }[]>("/api/admin/studies")).find(
          (item) => item.name === "E2E admin study",
        )?.status,
    )
    .toBe("active");
});
