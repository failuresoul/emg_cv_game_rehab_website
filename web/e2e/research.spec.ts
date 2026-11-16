/**
 * Research mode: a patient enrolled in a within-subject study of the three engines plays three
 * short sessions. The conditions follow the participant's Latin-square order, the patient's
 * screens look the same in every condition (and never name it), and the results page shows
 * the three conditions.
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
  settledStrings,
  type Strings,
  test,
  type TestPatient,
} from "./fixtures";
import {
  calibrate,
  coolDown,
  passSetup,
  autoPlay,
  sitStill,
  readPlan,
  startPlan,
  startSession,
  warmUp,
} from "./session";

let patient: TestPatient;
let studyId: number;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  const admin = await Api.admin(request);
  patient = await createPatient(admin, { side: "right" });
  await setProgramme(admin, patient.id, { warmup_exercises: ["hand_open_close"] });
  const today = new Date().toISOString().slice(0, 10);
  await admin.patch(`/api/admin/patients/${patient.id}`, { research_consent_at: today });
  const study = await admin.post<{ id: number }>("/api/admin/studies", {
    name: "E2E engine comparison",
    design: "within_subject",
    conditions: ["L0", "L1", "L2"],
    sessions_per_condition: 1,
    games: ["bloom"],
    seed: 7,
  });
  studyId = study.id;
  await admin.post(`/api/admin/studies/${studyId}/participants`, { patient_id: patient.id });
  await admin.patch(`/api/admin/studies/${studyId}`, { status: "active" });
});

/** The page's text with every digit taken out: what the patient sees, whatever the numbers. */
const shape = (page: Page) =>
  page.evaluate(() =>
    document.querySelector("main")!.innerText.replace(/[0-9০-৯]+([.,][0-9]+)?/g, "#"),
  );

async function studySession(page: Page, s: Strings, reps: number) {
  await passSetup(page, s, patient.side);
  await calibrate(page, s, patient.side);
  await warmUp(page, s, patient.side, { reps, order: ["hand_open_close"] });
  // The study sets the plan: its game, locked.
  const rows = await readPlan(page, s);
  expect(rows.map((row) => row.name)).toEqual([s["game.bloom.name"]]);
  await expect(page.getByText(s["plan.lockedNote"])).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  const plan = await shape(page);
  await startPlan(page, s);
  // The game, played by itself, up to its results screen.
  await expect(page).toHaveURL(/\/session\/game\/bloom$/);
  await autoPlay(page, patient.side);
  const next = page.getByRole("button", { name: s["game.continue"] });
  await expect(next).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText(s["game.results.title"])).toBeVisible();
  // Compared once saved, so "Saving…" and "Saved" do not differ by timing.
  await expect(page.getByText(s["game.save.saved"], { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const results = await shape(page);
  await sitStill(page, patient.side);
  await next.click();
  await coolDown(page, s);
  await expect(page.getByRole("heading", { name: s["summary.wellDone"] })).toBeVisible();
  return { plan, results };
}

test("three study sessions follow the Latin square, look the same, and give results", async ({
  page,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(15 * 60_000);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const reps = testSettings.warmupReps ?? 10;
  const screens: { plan: string; results: string }[] = [];
  for (let index = 0; index < 3; index++) {
    await test.step(`study session ${index + 1}`, async () => {
      const s = await startSession(page);
      screens.push(await studySession(page, s, reps));
      await page.getByRole("button", { name: s["summary.home"] }).click();
      await expect(page).toHaveURL(/\/patient$/);
    });
  }

  await test.step("the patient's screens and answers never name the condition", async () => {
    expect(screens[1]).toEqual(screens[0]);
    expect(screens[2]).toEqual(screens[0]);
    const api = await Api.login(page.request, patient.email, patient.password);
    const sessions = await api.get<{ id: number }[]>("/api/patient/sessions");
    expect(sessions).toHaveLength(3);
    for (const session of sessions) {
      const detail = await api.get<
        Record<string, unknown> & { games: { engine: string | null }[] }
      >(`/api/patient/sessions/${session.id}`);
      // The engine is left out of the patient's answer (or null).
      expect(detail.games.map((game) => game.engine ?? null)).toEqual([null]);
      expect(JSON.stringify(detail)).not.toMatch(/"(study_condition|condition)":"L[012]"/);
    }
  });

  await test.step("the conditions follow the participant's order", async () => {
    const admin = await Api.admin(page.request);
    const progress = await admin.get<{
      participants: {
        patient_id: number;
        condition_order: string[];
        complete: boolean;
        sessions_done: Record<string, number>;
      }[];
    }>(`/api/admin/studies/${studyId}/progress`);
    const row = progress.participants.find((item) => item.patient_id === patient.id)!;
    const order = row.condition_order;
    expect([...order].sort()).toEqual(["L0", "L1", "L2"]);
    expect(row.complete).toBe(true);
    expect(row.sessions_done).toEqual({ L0: 1, L1: 1, L2: 1 });
    const api = await Api.login(page.request, patient.email, patient.password);
    const sessions = (
      await api.get<{ id: number; started_at: string }[]>("/api/patient/sessions")
    ).sort((a, b) => a.started_at.localeCompare(b.started_at));
    const played: string[] = [];
    for (const session of sessions) {
      const detail = await admin.get<{ study_condition: string }>(
        `/api/admin/sessions/${session.id}`,
      );
      played.push(detail.study_condition);
    }
    expect(played).toEqual(order);
  });

  await test.step("the results page shows the three conditions", async () => {
    await page.evaluate(() => localStorage.removeItem("muvi_token"));
    await loginWithToken(page, "admin@muvi.local", "e2e-admin-password");
    await page.goto("/admin/research");
    const s = await settledStrings(page);
    await page.getByRole("button", { name: "E2E engine comparison" }).click();
    const results = page.getByRole("table", { name: s["study.results.tableCaption"] });
    await expect(results).toBeVisible();
    for (const condition of ["L0", "L1", "L2"]) {
      await expect(
        results.getByRole("columnheader", { name: s[`adminLevels.mode.${condition}`] }),
      ).toBeVisible();
    }
    await expect(results.getByRole("row").nth(1)).toContainText(
      s["study.results.countsValue"]
        .replace("{participants}", "1")
        .replace("{sessions}", "1")
        .split("{")[0],
    );
  });
});
