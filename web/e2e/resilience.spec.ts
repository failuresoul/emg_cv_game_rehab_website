/**
 * What goes wrong in real use: refreshing the page, leaving early, the server going away in a
 * game, the feedback model failing, and the camera being refused.
 */

import {
  Api,
  API_URL,
  createPatient,
  expect,
  loginWithToken,
  MOCK_REPORT,
  pattern,
  resetDatabase,
  setProgramme,
  setReplaySide,
  settledStrings,
  test,
  type TestPatient,
} from "./fixtures";
import {
  autoPlay,
  calibrate,
  coolDown,
  exitSession,
  passSetup,
  playGame,
  startPlan,
  startSession,
  warmUp,
} from "./session";

/** After a refresh on another step's page the app asks whether to continue; on the same page it
 * simply carries on. Answers the question if it is asked. */
async function continueIfAsked(
  page: import("@playwright/test").Page,
  s: import("./fixtures").Strings,
) {
  const button = page.getByRole("dialog").getByRole("button", { name: s["resume.continue"] });
  if (await button.isVisible({ timeout: 3000 }).catch(() => false)) await button.click();
}

const WARMUP = ["shoulder_flexion", "hand_open_close"] as const;

async function newPatient(
  request: import("@playwright/test").APIRequestContext,
): Promise<TestPatient> {
  const admin = await Api.admin(request);
  const patient = await createPatient(admin, { side: "left" });
  await setProgramme(admin, patient.id, {
    enabled_games: ["bloom", "reach_activate"],
    games_per_session: { min: 2, max: 2 },
    warmup_exercises: [...WARMUP],
  });
  return patient;
}

test.beforeAll(async ({ request }) => {
  await resetDatabase(request);
});

test.afterEach(async ({ request }) => {
  // The model always works again for the next test.
  await request.post(`${API_URL}/api/test/llm`, { data: { mode: "ok" } });
});

test("refreshing in the warm-up and in game 2 continues the session; a failing model gives the template report", async ({
  page,
  request,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(10 * 60_000);
  const patient = await newPatient(request);
  const reps = testSettings.warmupReps ?? 10;
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  let s = await startSession(page);
  await passSetup(page, s, patient.side);
  await calibrate(page, s, patient.side);
  await warmUp(page, s, patient.side, { reps, order: [...WARMUP], stopAfter: 1 });

  await test.step("refresh in the warm-up: continue from the second exercise", async () => {
    await page.reload();
    s = await settledStrings(page);
    await continueIfAsked(page, s);
    await expect(page).toHaveURL(/\/session\/warmup$/);
    await expect(page.getByText(pattern(s["warmup.resumeFrom"]))).toContainText(
      s["exercise.handOpenClose.name"],
    );
    await warmUp(page, s, patient.side, { reps, order: ["hand_open_close"], resume: true });
  });

  await startPlan(page, s);
  const first = await page.evaluate(() => location.pathname.split("/").pop()!);
  const second = first === "bloom" ? "reach_activate" : "bloom";
  await playGame(page, s, patient.side, first);

  await test.step("refresh in game 2: the game starts again", async () => {
    await expect(page).toHaveURL(new RegExp(`/session/game/${second}$`));
    await autoPlay(page, patient.side);
    await page.waitForTimeout(3000);
    await page.reload();
    s = await settledStrings(page);
    await continueIfAsked(page, s);
    await playGame(page, s, patient.side, second);
  });

  await test.step("the model fails: the summary shows the template report", async () => {
    await request.post(`${API_URL}/api/test/llm`, { data: { mode: "fail" } });
    await coolDown(page, s);
    await expect(page.getByRole("heading", { name: s["summary.wellDone"] })).toBeVisible();
    const patientApi = await Api.login(page.request, patient.email, patient.password);
    const [session] = await patientApi.get<{ id: number }[]>("/api/patient/sessions");
    await expect
      .poll(
        async () =>
          (await patientApi.get<{ status: string }>(`/api/sessions/${session.id}/feedback`)).status,
        { timeout: 60_000 },
      )
      .toBe("fallback");
    await expect(page.getByText(MOCK_REPORT.en)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: s["summary.feedbackTitle"] })).toBeVisible();

    const admin = await Api.admin(page.request);
    const detail = await admin.get<{
      status: string;
      games: { game_id: string; status: string }[];
    }>(`/api/admin/sessions/${session.id}`);
    expect(detail.status).toBe("completed");
    for (const game of [first, second]) {
      expect(
        detail.games.filter((run) => run.game_id === game && run.status === "completed"),
      ).toHaveLength(1);
    }
  });
});

test("leaving mid-session marks it aborted", async ({ page, request }) => {
  const patient = await newPatient(request);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);
  await passSetup(page, s, patient.side);
  await calibrate(page, s, patient.side);
  await exitSession(page, s);
  const api = await Api.login(page.request, patient.email, patient.password);
  const sessions = await api.get<{ status: string }[]>("/api/patient/sessions");
  expect(sessions.map((session) => session.status)).toEqual(["aborted"]);
});

test("with the server gone for a while in a game, its trials are saved when it is back", async ({
  page,
  request,
  testSettings,
}, testInfo) => {
  testInfo.setTimeout(8 * 60_000);
  const patient = await newPatient(request);
  await setReplaySide(page, patient.side);
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);
  await passSetup(page, s, patient.side);
  await calibrate(page, s, patient.side);
  await warmUp(page, s, patient.side, { reps: testSettings.warmupReps ?? 10, order: [...WARMUP] });
  // Bloom first, alone.
  await page.getByRole("checkbox", { name: new RegExp(s["game.reach_activate.name"]) }).uncheck();
  await startPlan(page, s);
  await expect(page).toHaveURL(/\/session\/game\/bloom$/);
  await autoPlay(page, patient.side);
  // The game is running: now nothing reaches the server (as if it had stopped).
  await expect(page.getByText(pattern(s["game.hud.trial"]))).toBeVisible();
  let refused = 0;
  await page.route("**/api/**", (route) => {
    refused++;
    return route.abort("connectionrefused");
  });
  await page.waitForTimeout(8000);
  await page.unroute("**/api/**");
  expect(refused, "requests refused while the server was away").toBeGreaterThan(0);

  const next = page.getByRole("button", { name: s["game.continue"] });
  await expect(next).toBeVisible({ timeout: 3 * 60_000 });
  // Saved after the server came back (retried by the game), with every trial.
  const admin = await Api.admin(page.request);
  const api = await Api.login(page.request, patient.email, patient.password);
  const [session] = await api.get<{ id: number }[]>("/api/patient/sessions");
  await expect
    .poll(
      async () => {
        const detail = await admin.get<{
          games: { trials_done: number; trials_planned: number }[];
        }>(`/api/admin/sessions/${session.id}`);
        const run = detail.games[0];
        return run ? run.trials_done === run.trials_planned && run.trials_done > 0 : false;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  testInfo.annotations.push({ type: "refused requests", description: String(refused) });
});

test("a refused camera shows a clear message", async ({ page, request }) => {
  const patient = await newPatient(request);
  // A real camera this time (no replay), and the browser refuses it.
  await page.addInitScript(() => {
    localStorage.removeItem("muvi-test-replay");
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    }
  });
  await loginWithToken(page, patient.email, patient.password);
  const s = await startSession(page);
  await page.getByRole("button", { name: s["setup.intro.allow"] }).click();
  await expect(page.getByText(s["setup.error.title"])).toBeVisible();
  await expect(page.getByText(s["setup.error.permissionDenied"])).toBeVisible();
  expect(await page.evaluate(() => window.__muviTest!.vision.source())).toBe("none");
});
