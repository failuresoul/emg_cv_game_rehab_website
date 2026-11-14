import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { flowReducer, INITIAL_FLOW } from "@/emg/emgFlow";
import {
  defaultEmgSite,
  forcedWarmupPreset,
  warmupOrder,
} from "@/features/programme/patientProgramme";
import { GAME_IDS } from "@/games/shared/registry";
import { en } from "@/i18n/en";
import type { Programme, ProgrammeChange, ProgrammeFields } from "@/types/api";
import { EXERCISE_ORDER } from "@/warmup/exercises";

import {
  changedFields,
  formatProgrammeValue,
  levelMeaningKey,
  levelOf,
  toUpdate,
  validateProgramme,
  withExercise,
  withGame,
  withLevel,
} from "./programmeForm";
import { ProgrammeTab } from "./ProgrammeTab";

const DEFAULTS: ProgrammeFields = {
  enabled_games: [...GAME_IDS],
  max_level: {},
  session_minutes_target: 18,
  games_per_session: { min: 3, max: 4 },
  warmup_exercises: [...EXERCISE_ORDER],
  warmup_preset: "personal",
  rest_every_minutes: 5,
  engine_mode: "L1",
  emg_default_site: null,
  weekly_goal: 5,
  notes: null,
};

const keys = (draft: ProgrammeFields, off: Programme["library_disabled_games"] = []) =>
  validateProgramme(draft, off).map((problem) => problem.key);

describe("programme validation (the server's rules, worded for the admin)", () => {
  it("accepts the defaults", () => {
    expect(keys(DEFAULTS)).toEqual([]);
  });

  it("refuses each setting out of range", () => {
    expect(keys({ ...DEFAULTS, games_per_session: { min: 5, max: 4 } })).toEqual([
      "programme.error.gamesOrder",
    ]);
    expect(keys({ ...DEFAULTS, games_per_session: { min: 1, max: 4 } })).toEqual([
      "programme.error.gamesRange",
    ]);
    expect(keys({ ...DEFAULTS, games_per_session: { min: 3, max: 7 } })).toEqual([
      "programme.error.gamesRange",
    ]);
    expect(keys({ ...DEFAULTS, session_minutes_target: 9 })).toEqual(["programme.error.minutes"]);
    expect(keys({ ...DEFAULTS, session_minutes_target: 41 })).toEqual(["programme.error.minutes"]);
    expect(keys({ ...DEFAULTS, session_minutes_target: Number.NaN })).toEqual([
      "programme.error.minutes",
    ]);
    expect(keys({ ...DEFAULTS, rest_every_minutes: 2 })).toEqual(["programme.error.rest"]);
    expect(keys({ ...DEFAULTS, rest_every_minutes: 11 })).toEqual(["programme.error.rest"]);
    expect(keys({ ...DEFAULTS, weekly_goal: 0 })).toEqual(["programme.error.weeklyGoal"]);
    expect(keys({ ...DEFAULTS, weekly_goal: 15 })).toEqual(["programme.error.weeklyGoal"]);
    expect(keys({ ...DEFAULTS, max_level: { bloom: 11 } })).toEqual(["programme.error.level"]);
    expect(keys({ ...DEFAULTS, warmup_exercises: [] })).toEqual(["programme.error.noExercises"]);
    expect(keys({ ...DEFAULTS, enabled_games: [] })).toEqual(["programme.error.noGames"]);
    expect(keys({ ...DEFAULTS, notes: "x".repeat(2001) })).toEqual(["programme.error.notes"]);
  });

  it("needs as many games as the fewest per session", () => {
    const two = {
      ...DEFAULTS,
      enabled_games: ["bloom", "grip_hold"] as ProgrammeFields["enabled_games"],
    };
    const problems = validateProgramme(two);
    expect(problems.map((p) => p.key)).toEqual(["programme.error.tooFewGames"]);
    expect(problems[0]?.params).toEqual({ n: 3 });
    expect(keys({ ...two, games_per_session: { min: 2, max: 4 } })).toEqual([]);
  });

  it("refuses a game the Game Library turned off, naming it", () => {
    const problems = validateProgramme(DEFAULTS, ["bloom"]);
    expect(problems.map((p) => p.key)).toEqual(["programme.error.libraryOff"]);
    expect(problems[0]?.params).toEqual({ games: en["game.bloom.name"] });
  });
});

describe("editing the programme", () => {
  it("keeps the registry's order when turning games and exercises on and off", () => {
    const off = withGame(DEFAULTS, "bloom", false);
    expect(off.enabled_games).not.toContain("bloom");
    expect(withGame(off, "bloom", true).enabled_games).toEqual(GAME_IDS);
    const fewer = withExercise(DEFAULTS, "shoulder_flexion", false);
    expect(withExercise(fewer, "shoulder_flexion", true).warmup_exercises).toEqual(EXERCISE_ORDER);
  });

  it("leaves level 10 out, as the default", () => {
    const capped = withLevel(DEFAULTS, "bloom", 4);
    expect(capped.max_level).toEqual({ bloom: 4 });
    expect(levelOf(capped, "bloom")).toBe(4);
    expect(levelOf(capped, "grip_hold")).toBe(10);
    expect(withLevel(capped, "bloom", 10).max_level).toEqual({});
  });

  it("describes each level band", () => {
    expect([1, 3, 4, 6, 7, 9, 10].map(levelMeaningKey)).toEqual([
      "programme.level.gentle",
      "programme.level.gentle",
      "programme.level.moderate",
      "programme.level.moderate",
      "programme.level.challenging",
      "programme.level.challenging",
      "programme.level.noLimit",
    ]);
  });

  it("finds the changed fields, ignoring order, default levels and spaces", () => {
    expect(changedFields(DEFAULTS, DEFAULTS)).toEqual([]);
    const same = {
      ...DEFAULTS,
      enabled_games: [...GAME_IDS].reverse(),
      max_level: { bloom: 10 },
      notes: "   ",
    };
    expect(changedFields(DEFAULTS, same)).toEqual([]);
    const changed = {
      ...withLevel(DEFAULTS, "bloom", 3),
      rest_every_minutes: 4,
      engine_mode: "L2" as const,
      notes: "Gentle start",
    };
    expect(changedFields(DEFAULTS, changed)).toEqual([
      "max_level",
      "rest_every_minutes",
      "engine_mode",
      "notes",
    ]);
  });

  it("sends the whole programme with a trimmed reason, or none", () => {
    expect(toUpdate(DEFAULTS, "  After review  ").reason).toBe("After review");
    expect(toUpdate(DEFAULTS, "   ").reason).toBeNull();
    expect(toUpdate({ ...DEFAULTS, notes: "  hi " }, "").notes).toBe("hi");
  });

  it("puts values into words for the summary and the history", () => {
    expect(formatProgrammeValue("max_level", { bloom: 4 })).toBe(`${en["game.bloom.name"]} 4`);
    expect(formatProgrammeValue("max_level", {})).toBe(en["programme.value.noLimits"]);
    expect(formatProgrammeValue("games_per_session", { min: 2, max: 5 })).toBe("2 to 5");
    expect(formatProgrammeValue("engine_mode", "L2")).toBe(en["adminLevels.mode.L2"]);
    expect(formatProgrammeValue("emg_default_site", null)).toBe(en["programme.value.none"]);
    expect(formatProgrammeValue("enabled_games", ["bloom", "chess"])).toBe(en["game.bloom.name"]);
  });
});

describe("the patient's browser obeys the programme", () => {
  it("shows only the programme's warm-up exercises, in the warm-up's order", () => {
    expect(
      warmupOrder(EXERCISE_ORDER, { warmup_exercises: ["thumb_opposition", "shoulder_flexion"] }),
    ).toEqual(["shoulder_flexion", "thumb_opposition"]);
    // Without a programme, or with none left, every exercise: the warm-up never blocks.
    expect(warmupOrder(EXERCISE_ORDER, null)).toEqual(EXERCISE_ORDER);
    expect(warmupOrder(EXERCISE_ORDER, { warmup_exercises: [] })).toEqual(EXERCISE_ORDER);
  });

  it("forces the gentle preset only when the programme says so", () => {
    expect(forcedWarmupPreset({ warmup_preset: "gentle" })).toBe("gentle");
    expect(forcedWarmupPreset({ warmup_preset: "personal" })).toBeNull();
    expect(forcedWarmupPreset(undefined)).toBeNull();
  });

  it("pre-selects the programme's muscle-sensor site, without overriding a choice", () => {
    expect(defaultEmgSite({ emg_default_site: "extensors" })).toBe("extensors");
    expect(defaultEmgSite(undefined)).toBeNull();
    const suggested = flowReducer(INITIAL_FLOW, { type: "suggestSite", site: "extensors" });
    expect(suggested.site).toBe("extensors");
    const chosen = flowReducer(INITIAL_FLOW, { type: "chooseSite", site: "flexors" });
    expect(flowReducer(chosen, { type: "suggestSite", site: "extensors" }).site).toBe("flexors");
    expect(flowReducer(INITIAL_FLOW, { type: "suggestSite", site: null }).site).toBeNull();
    const later = { ...INITIAL_FLOW, stage: "check" as const };
    expect(flowReducer(later, { type: "suggestSite", site: "extensors" }).site).toBeNull();
  });
});

describe("the Programme tab", () => {
  function render(programme: Programme, history: ProgrammeChange[]) {
    const client = new QueryClient();
    client.setQueryData(["admin", "patient", 1, "programme"], programme);
    client.setQueryData(["admin", "patient", 1, "programme", "history"], history);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ProgrammeTab patientId={1} />
      </QueryClientProvider>,
    );
  }

  const programme: Programme = {
    ...DEFAULTS,
    max_level: { bloom: 4 },
    patient_id: 1,
    library_disabled_games: ["paint_wall"],
    updated_at: "2026-11-14T10:00:00Z",
  };

  it("shows every section, each game with its level and the library's switched-off games", () => {
    const html = render(programme, []);
    for (const key of [
      "programme.section.games",
      "programme.section.session",
      "programme.section.warmup",
      "programme.section.ai",
      "programme.section.sensor",
      "programme.section.goals",
      "programme.games.libraryOff",
      "programme.level.moderate",
      "programme.history.empty",
      "programme.save",
    ] as const) {
      expect(html).toContain(en[key]);
    }
    for (const game of GAME_IDS) expect(html).toContain(en[`game.${game}.name`]);
    expect(html).toContain(en["programme.games.level"].replace("{n}", "4"));
    expect(html).toContain(en["programme.noChanges"]);
  });

  it("lists the history with the admin, the change and the reason", () => {
    const html = render(programme, [
      {
        id: 1,
        field: "rest_every_minutes",
        before: 5,
        after: 3,
        reason: "Tires quickly",
        admin_id: 1,
        admin_name: "Dr Therapist",
        created_at: "2026-11-14T09:00:00Z",
      },
    ]);
    expect(html).toContain("Dr Therapist");
    expect(html).toContain(en["programme.field.rest_every_minutes"]);
    expect(html).toContain("every 5 min → every 3 min");
    expect(html).toContain("Tires quickly");
  });
});
