/**
 * The main journey: a patient's whole session, from the camera check to the summary, then the
 * patient's history and the admin's session page. The camera is synthetic landmarks.
 */

import {
  Api,
  createPatient,
  expect,
  loginWithToken,
  resetDatabase,
  setProgramme,
  setReplaySide,
  strings,
  test,
  type TestPatient,
  MOCK_REPORT,
} from "./fixtures";
import {
  ALL_EXERCISES,
  calibrate,
  coolDown,
  passSetup,
  playGame,
  readPlan,
  startPlan,
  startSession,
  warmUp,
} from "./session";

let patient: TestPatient;

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
  const admin = await Api.admin(request);
  patient = await createPatient(admin, { side: "left" });
  // The programme: these two games only, in every plan.
  await setProgramme(admin, patient.id, {
    enabled_games: ["reach_activate", "bloom"],
    games_per_session: { min: 2, max: 2 },
  });
});

test("a full session: check, calibration, warm-up, plan, two games, cool-down, summary", async ({
  page,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(testSettings.warmupReps ? 12 * 60_000 : 25 * 60_000);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);

  await test.step("camera check passes with the replayed person", () =>
    passSetup(page, s, patient.side));
  await test.step("calibration lights all 8 stars", () => calibrate(page, s, patient.side));

  const reps = testSettings.warmupReps ?? 10;
  const counts = await test.step("warm-up: all 6 exercises", () =>
    warmUp(page, s, patient.side, { reps }));
  for (const exercise of ALL_EXERCISES) {
    const target = exercise === "thumb_opposition" && !testSettings.warmupReps ? 5 : reps;
    expect(
      Math.abs((counts[exercise] ?? -99) - target),
      `${exercise}: ${counts[exercise]}`,
    ).toBeLessThanOrEqual(1);
  }

  await test.step("the plan respects the programme and gives reasons", async () => {
    const rows = await readPlan(page, s);
    const chosen = rows.filter((row) => row.chosen).map((row) => row.name);
    expect(chosen.sort()).toEqual([s["game.bloom.name"], s["game.reach_activate.name"]].sort());
    expect(rows.map((row) => row.name).sort()).toEqual(chosen.sort());
    expect(rows.filter((row) => row.reason).length).toBeGreaterThanOrEqual(1);
    await startPlan(page, s);
  });

  const order = await page.evaluate(() => location.pathname.split("/").pop());
  const games = order === "bloom" ? ["bloom", "reach_activate"] : ["reach_activate", "bloom"];
  for (const game of games) {
    await test.step(`plays ${game}`, () => playGame(page, s, patient.side, game));
  }

  await test.step("cool-down questionnaire", () => coolDown(page, s, { pain: 1, fatigue: 3 }));

  await test.step("the summary shows the games and the feedback report", async () => {
    await expect(page.getByRole("heading", { name: s["summary.wellDone"] })).toBeVisible();
    await expect(page.getByText(s["game.reach_activate.name"]).first()).toBeVisible();
    await expect(page.getByText(s["game.bloom.name"]).first()).toBeVisible();
    // The mock model's report (not the template).
    await expect(page.getByText(MOCK_REPORT.en)).toBeVisible({ timeout: 60_000 });
  });

  const sessions = await test.step("the patient's history shows the session", async () => {
    await page.getByRole("button", { name: s["summary.home"] }).click();
    await page.goto("/patient/history");
    const api = await Api.login(page.request, patient.email, patient.password);
    const list = await api.get<{ id: number; status: string }[]>("/api/patient/sessions");
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("completed");
    await expect(page.locator(`a[href="/patient/history/${list[0].id}"]`)).toBeVisible();
    return list;
  });

  await test.step("the admin's session page shows the data", async () => {
    const admin = await Api.admin(page.request);
    const detail = await admin.get<{
      games: { game_id: string; trials_done: number; status: string }[];
      warmup_results: unknown[];
      calibration: unknown;
    }>(`/api/admin/sessions/${sessions[0].id}`);
    expect(detail.games.map((run) => run.game_id).sort()).toEqual(["bloom", "reach_activate"]);
    for (const run of detail.games) {
      expect(run.status).toBe("completed");
      expect(run.trials_done).toBeGreaterThan(0);
    }
    expect(detail.warmup_results).toHaveLength(6);
    expect(detail.calibration).not.toBeNull();

    await page.evaluate(() => localStorage.removeItem("motionlab_token"));
    await loginWithToken(page, "admin@motionlab.local", "e2e-admin-password");
    await page.goto(`/admin/sessions/${sessions[0].id}`);
    const admin_s = await strings(page);
    await expect(page.getByText(admin_s["game.reach_activate.name"]).first()).toBeVisible();
    await expect(page.getByText(admin_s["game.bloom.name"]).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: admin_s["calibrate.result.title"] }),
    ).toBeVisible();
    // Every warm-up exercise with its repetitions.
    const warmup = page
      .getByRole("table")
      .filter({ hasText: admin_s["exercise.shoulderFlexion.name"] });
    await expect(warmup.getByRole("row")).toHaveCount(7);
    await expect(page.getByText(MOCK_REPORT.en).first()).toBeVisible();
  });
});

/** Plays one marked step of Shadik's guided recording (right side affected), over and over. */
const playRecorded = (page: import("@playwright/test").Page, marker: string) =>
  page.evaluate(
    (step) => window.__muviTest!.vision.playRecording("shadik_full", { loop: true, marker: step }),
    marker,
  );

test("a real recording passes the camera check, maps the reach and counts the hand exercise", async ({
  page,
  request,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(6 * 60_000);
  const admin = await Api.admin(request);
  const recorded = await createPatient(admin, { side: "right" });
  await setProgramme(admin, recorded.id, { warmup_exercises: ["hand_open_close"] });
  await setReplaySide(page, recorded.side);
  await loginWithToken(page, recorded.email, recorded.password);
  const s = await startSession(page);

  await test.step("camera check: the recorded person sitting still", async () => {
    await page.getByRole("button", { name: s["setup.intro.allow"] }).click();
    await playRecorded(page, "still_start");
    const next = page.getByRole("button", { name: s["setup.continue"] });
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();
  });

  await test.step("calibration: the recorded reaches in 8 directions", async () => {
    await page.getByRole("button", { name: s["calibrate.intro.start"] }).click();
    await playRecorded(page, "reach_8");
    const save = page.getByRole("button", { name: s["calibrate.result.save"] });
    await expect(save).toBeVisible({ timeout: 60_000 });
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    const stars = Number(heading.match(/\d+/)?.[0] ?? 0);
    testInfo.annotations.push({ type: "recorded stars", description: heading });
    expect(stars).toBeGreaterThanOrEqual(5);
    await save.click();
  });

  await test.step("warm-up: the recorded hand opening and closing is counted", async () => {
    await page.getByRole("button", { name: s["calibrate.intro.start"] }).click();
    await page.getByRole("button", { name: s["warmup.showMe"] }).click();
    await page.getByRole("button", { name: s["warmup.gotIt"] }).click();
    await playRecorded(page, "hand_open_close");
    await expect(page.getByRole("button", { name: s["warmup.next"] })).toBeVisible({
      timeout: 90_000,
    });
    const row = page.locator("div", {
      has: page.locator("dt", { hasText: s["warmup.summary.fullReps"] }),
    });
    const reps = Number((await row.locator("dd").first().innerText()).replace(/\D/g, ""));
    testInfo.annotations.push({ type: "recorded reps", description: String(reps) });
    expect(reps).toBeGreaterThanOrEqual(testSettings.warmupReps ?? 10);
  });
});
