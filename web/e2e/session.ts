/**
 * Drives a patient's session through its steps, with synthetic movements in place of the
 * camera. Every step finds its controls by the app's own strings, so it works in either
 * language.
 */

import type { Page } from "@playwright/test";

import { expect, exactly, pattern, settledStrings, type Side, type Strings } from "./fixtures";

export type ExerciseId =
  | "shoulder_flexion"
  | "shoulder_abduction"
  | "elbow_flexion"
  | "forward_reach"
  | "hand_open_close"
  | "thumb_opposition";

export const ALL_EXERCISES: ExerciseId[] = [
  "shoulder_flexion",
  "shoulder_abduction",
  "elbow_flexion",
  "forward_reach",
  "hand_open_close",
  "thumb_opposition",
];

/** Steps of the synthetic generator (src/testing/synthLandmarks.ts). */
type Step = Record<string, unknown> & { do: string };

/** Plays a script in place of the camera, from now. */
export async function play(page: Page, side: Side, steps: Step[], loop = false): Promise<void> {
  await page.evaluate(
    ({ side, steps, loop }) =>
      window.__muviTest!.vision.play({ affectedSide: side, steps, loop, jitterM: 0.001, seed: 3 }),
    { side, steps, loop },
  );
}

export const sitStill = (page: Page, side: Side) =>
  play(page, side, [{ do: "still", ms: 1000 }], true);

/** Plays the current game by itself, for a long time. */
export const autoPlay = (page: Page, side: Side) =>
  play(page, side, [{ do: "auto", ms: 30 * 60_000 }]);

// ---------------------------------------------------------------------------------------------
// The steps.

export async function startSession(page: Page): Promise<Strings> {
  await page.goto("/patient");
  const s = await settledStrings(page);
  await page.getByRole("button", { name: s["nav.patient.startSession"] }).first().click();
  await expect(page).toHaveURL(/\/session\/setup$/);
  return s;
}

/** The camera check: allow, wait for every check to be green, continue. */
export async function passSetup(page: Page, s: Strings, side: Side): Promise<void> {
  await page.getByRole("button", { name: s["setup.intro.allow"] }).click();
  await sitStill(page, side);
  const next = page.getByRole("button", { name: s["setup.continue"] });
  await expect(next).toBeEnabled({ timeout: 20_000 });
  await next.click();
}

/** The reach map: the wrist out to each of the 8 stars, then save. */
export async function calibrate(page: Page, s: Strings, side: Side): Promise<void> {
  await expect(page).toHaveURL(/\/session\/calibrate$/);
  await page.getByRole("button", { name: s["calibrate.intro.start"] }).click();
  const reaches: Step[] = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({
    do: "reach",
    by: "wrist",
    to: { x: 0.95 * Math.cos((deg * Math.PI) / 180), y: 0.95 * Math.sin((deg * Math.PI) / 180) },
    ms: 600,
    holdMs: 250,
    back: true,
  }));
  // The 3-2-1 countdown, then the reaches.
  await play(page, side, [{ do: "still", ms: 3300 }, ...reaches]);
  const save = page.getByRole("button", { name: s["calibrate.result.save"] });
  await expect(save).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("heading", { name: pattern(s["calibrate.result.stars"]) }),
  ).toContainText("8");
  await save.click();
  await expect(page).toHaveURL(/\/session\/warmup$/);
}

/** The movements for `reps` repetitions of an exercise, after the 3-2-1 countdown. */
export function exerciseScript(exercise: ExerciseId, reps: number): Step[] {
  const repeat = (step: Step) => Array.from({ length: reps }, () => step);
  const countdown: Step = { do: "still", ms: 3400 };
  switch (exercise) {
    case "shoulder_flexion":
      return [
        countdown,
        ...repeat({ do: "raise", plane: "forward", deg: 110, ms: 800, holdMs: 250, back: true }),
      ];
    case "shoulder_abduction":
      return [
        countdown,
        ...repeat({ do: "raise", plane: "sideways", deg: 100, ms: 800, holdMs: 250, back: true }),
      ];
    case "elbow_flexion":
      return [
        { do: "arm", angles: { elevationDeg: 10, planeDeg: 80, elbowDeg: 170 }, ms: 600 },
        { ...countdown, ms: 2800 },
        ...repeat({ do: "elbow", deg: 55, ms: 800, holdMs: 250, back: true }),
      ];
    case "forward_reach":
      return [
        { do: "arm", angles: { elevationDeg: 5, planeDeg: 90, elbowDeg: 175 }, ms: 600 },
        { ...countdown, ms: 2800 },
        ...repeat({ do: "raise", plane: "forward", deg: 85, ms: 900, holdMs: 300, back: true }),
      ];
    case "hand_open_close":
      return [
        { do: "hand", open: 0, ms: 400 },
        { ...countdown, ms: 3000 },
        ...repeat({ do: "hand", open: 1, ms: 600, holdMs: 250, back: true }),
      ];
    case "thumb_opposition":
      return [
        { do: "hand", open: 1, ms: 400 },
        { ...countdown, ms: 3000 },
        ...repeat({ do: "thumbTouch", msEach: 800, holdMs: 200 }),
      ];
  }
}

/** The full repetitions shown on an exercise's summary. */
async function fullReps(page: Page, s: Strings): Promise<number> {
  const row = page.locator("div", {
    has: page.locator("dt", { hasText: exactly(s["warmup.summary.fullReps"]) }),
  });
  const text = (await row.locator("dd").first().innerText()).trim();
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * The warm-up: each exercise in `exercises` is played `reps` times; the rest are skipped. Returns
 * the full repetitions each exercise counted.
 */
export async function warmUp(
  page: Page,
  s: Strings,
  side: Side,
  options: {
    reps: number;
    exercises?: ExerciseId[];
    /** The exercises still to do, in order (all six by default). */
    order?: ExerciseId[];
    /** Continue a warm-up left part way through (after a refresh). */
    resume?: boolean;
    /** Stop after this many exercises, on the rest screen, without finishing the warm-up. */
    stopAfter?: number;
  },
): Promise<Partial<Record<ExerciseId, number>>> {
  const order = options.order ?? ALL_EXERCISES;
  const played = new Set(options.exercises ?? order);
  await expect(page).toHaveURL(/\/session\/warmup$/);
  const startKey = options.resume ? "warmup.resumeButton" : "calibrate.intro.start";
  await page.getByRole("button", { name: s[startKey] }).click();
  const counts: Partial<Record<ExerciseId, number>> = {};
  for (let index = 0; index < order.length; index++) {
    const exercise = order[index];
    await sitStill(page, side);
    if (played.has(exercise)) {
      await page.getByRole("button", { name: s["warmup.showMe"] }).click();
      await page.getByRole("button", { name: s["warmup.gotIt"] }).click();
      await play(page, side, exerciseScript(exercise, options.reps));
      const next = page.getByRole("button", { name: s["warmup.next"] });
      await expect(next, exercise).toBeVisible({ timeout: 60_000 });
      counts[exercise] = await fullReps(page, s);
      await next.click();
    } else {
      await page.getByRole("button", { name: s["warmup.showMe"] }).click();
      await page.getByRole("button", { name: s["warmup.gotIt"] }).click();
      await page.getByRole("button", { name: s["warmup.skip"] }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: s["warmup.skip"] }).click();
      await page.getByRole("button", { name: s["warmup.next"] }).click();
    }
    if (options.stopAfter === index + 1) return counts;
    if (index < order.length - 1) {
      await page.getByRole("button", { name: s["warmup.rest.skip"] }).click();
    }
  }
  await sitStill(page, side);
  await page.getByRole("button", { name: s["warmup.complete.continue"] }).click();
  await expect(page).toHaveURL(/\/session\/plan$/);
  return counts;
}

export interface PlanRow {
  name: string;
  chosen: boolean;
  /** The planner's reason, shown with "Why this game?", or null. */
  reason: string | null;
}

/** The plan's games, in order, as shown. */
export async function readPlan(page: Page, s: Strings): Promise<PlanRow[]> {
  const list = page.getByRole("list", { name: s["plan.listLabel"] });
  await expect(list).toBeVisible();
  const rows: PlanRow[] = [];
  for (const item of await list.getByRole("listitem").all()) {
    const name = (await item.locator("label > span").first().innerText()).trim();
    const chosen = await item.getByRole("checkbox").isChecked();
    const why = item.getByText(s["plan.why"]);
    const reason = (await why.count()) > 0 ? (await why.locator("..").innerText()).trim() : null;
    rows.push({ name, chosen, reason });
  }
  return rows;
}

/** Starts the plan's chosen games. */
export async function startPlan(page: Page, s: Strings): Promise<void> {
  await page.getByRole("button", { name: s["plan.start"] }).click();
  await expect(page).toHaveURL(/\/session\/game\//);
}

/** Plays the current game to its end, by itself, and continues. */
export async function playGame(page: Page, s: Strings, side: Side, gameId: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/session/game/${gameId}$`));
  await autoPlay(page, side);
  const next = page
    .getByRole("button", { name: s["game.nextGame"] })
    .or(page.getByRole("button", { name: s["game.continue"] }));
  await expect(next.first()).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByText(s["game.results.title"])).toBeVisible();
  await sitStill(page, side);
  await next.first().click();
}

/** Answers the cool-down questions and finishes. */
export async function coolDown(
  page: Page,
  s: Strings,
  answers: { pain?: number; fatigue?: number; enjoyment?: number } = {},
): Promise<void> {
  await expect(page).toHaveURL(/\/session\/cooldown$/);
  await page.getByRole("button", { name: s["cooldown.relax.skip"] }).click();
  const group = (legendKey: string) => page.getByRole("group", { name: s[legendKey] });
  const scale = (value: number) => s["cooldown.scaleValue"].replace("{value}", String(value));
  await group("cooldown.pain.legend")
    .getByRole("radio", { name: scale(answers.pain ?? 1), exact: true })
    .check({ force: true });
  await group("cooldown.fatigue.legend")
    .getByRole("radio", { name: scale(answers.fatigue ?? 3), exact: true })
    .check({ force: true });
  await group("cooldown.enjoyment.legend")
    .getByRole("radio", {
      name: s["cooldown.enjoyment.stars"].replace("{count}", String(answers.enjoyment ?? 4)),
      exact: true,
    })
    .check({ force: true });
  await group("cooldown.difficulty.legend")
    .getByRole("radio", { name: s["cooldown.difficulty.justRight"], exact: true })
    .check({ force: true });
  await group("cooldown.newSymptoms.legend")
    .getByRole("radio", { name: s["cooldown.no"], exact: true })
    .check({ force: true });
  await page.getByRole("button", { name: s["cooldown.submit"] }).click();
  await expect(page).toHaveURL(/\/session\/summary$/);
}

/** Leaves the session from the top bar and confirms. */
export async function exitSession(page: Page, s: Strings): Promise<void> {
  await page.getByRole("button", { name: s["session.exit"] }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: s["session.exitConfirm.leave"] })
    .click();
  await expect(page).not.toHaveURL(/\/session\//);
}
