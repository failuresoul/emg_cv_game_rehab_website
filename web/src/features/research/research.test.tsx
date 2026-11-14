import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planRows } from "@/features/session/plan";
import { en } from "@/i18n/en";
import type { ConditionResult, Estimate, SessionPlan, StudyResults } from "@/types/api";

import { todayIso } from "./ConsentCard";
import {
  conditionsText,
  EMPTY_DRAFT,
  formatResult,
  RESULT_METRICS,
  resultBars,
  toggleCondition,
  toggleGame,
  toPayload,
  validateStudy,
} from "./studyModel";
import { StudyResultsCharts } from "./StudyResultsView";

const none: Estimate = { mean: null, ci_low: null, ci_high: null, n: 0 };

function condition(name: ConditionResult["condition"], success: Estimate): ConditionResult {
  return {
    condition: name,
    participants: success.n,
    sessions: success.n * 2,
    trials: success.n * 40,
    success_rate: success,
    challenge_error: { mean: 0.12, ci_low: 0.05, ci_high: 0.19, n: 2 },
    time_in_zone: none,
    compensation_rate: none,
    mean_level: none,
    enjoyment: none,
    fatigue: none,
    report_rating: none,
  };
}

const RESULTS: StudyResults = {
  study_id: 1,
  design: "within_subject",
  conditions: [
    condition("L0", { mean: 0.75, ci_low: 0.6, ci_high: 0.9, n: 4 }),
    condition("L2", { mean: 0.7, ci_low: null, ci_high: null, n: 1 }),
  ],
};

describe("the study form", () => {
  it("needs a name, two conditions, 1-20 sessions and a game", () => {
    expect(validateStudy({ ...EMPTY_DRAFT, name: "Pilot" })).toEqual([]);
    expect(validateStudy(EMPTY_DRAFT)).toEqual(["study.error.name"]);
    expect(validateStudy({ ...EMPTY_DRAFT, name: "x", conditions: ["L1"] })).toEqual([
      "study.error.conditions",
    ]);
    expect(validateStudy({ ...EMPTY_DRAFT, name: "x", sessions_per_condition: 0 })).toEqual([
      "study.error.sessions",
    ]);
    expect(
      validateStudy({ ...EMPTY_DRAFT, name: "x", sessions_per_condition: Number.NaN }),
    ).toEqual(["study.error.sessions"]);
    expect(validateStudy({ ...EMPTY_DRAFT, name: "x", games: [] })).toEqual(["study.error.games"]);
  });

  it("keeps conditions in order and games in the order they were turned on", () => {
    const fewer = toggleCondition(EMPTY_DRAFT, "L1", false);
    expect(fewer.conditions).toEqual(["L0", "L2"]);
    expect(toggleCondition(fewer, "L1", true).conditions).toEqual(["L0", "L1", "L2"]);
    const games = toggleGame({ ...EMPTY_DRAFT, games: ["bloom"] }, "reach_activate", true);
    expect(games.games).toEqual(["bloom", "reach_activate"]);
    expect(toggleGame(games, "bloom", false).games).toEqual(["reach_activate"]);
  });

  it("sends trimmed text and no empty description", () => {
    const payload = toPayload({ ...EMPTY_DRAFT, name: "  Pilot  ", description: "   " });
    expect(payload.name).toBe("Pilot");
    expect(payload.description).toBeNull();
  });

  it("describes a participant's conditions for the admin", () => {
    const base = {
      id: 1,
      patient_id: 1,
      patient_code: "P001",
      position: 0,
      current_index: 0,
      enrolled_at: "",
      withdrawn_at: null,
    };
    expect(
      conditionsText({ ...base, condition_order: ["L0", "L2"], assigned_condition: null }),
    ).toBe(`${en["adminLevels.mode.L0"]} → ${en["adminLevels.mode.L2"]}`);
    expect(conditionsText({ ...base, condition_order: null, assigned_condition: "L1" })).toBe(
      en["adminLevels.mode.L1"],
    );
  });
});

describe("the results charts", () => {
  const success = RESULT_METRICS.find((metric) => metric.key === "success_rate")!;
  const challenge = RESULT_METRICS.find((metric) => metric.key === "challenge_error")!;

  it("scales shares to percentages and turns the interval into error bars", () => {
    const [l0, l2] = resultBars(RESULTS, success);
    expect(l0).toMatchObject({ condition: "L0", mean: 75, ciLow: 60, ciHigh: 90, n: 4 });
    expect(l0?.error).toEqual([15, 15]);
    // One participant: a mean without an interval.
    expect(l2?.error).toBeNull();
    expect(resultBars(RESULTS, challenge)[0]?.error).toEqual([0.07, 0.07]);
  });

  it("formats each measure in its own way", () => {
    expect(formatResult(success, 75)).toBe("75%");
    expect(formatResult(challenge, 0.1234)).toBe("0.12");
    expect(formatResult(success, null)).toBe("–");
  });

  it("shows the numbers in a table too, with the interval", () => {
    const html = renderToStaticMarkup(<StudyResultsCharts results={RESULTS} />);
    expect(html).toContain(en["study.results.tableCaption"]);
    expect(html).toContain("75%");
    expect(html).toContain("(60% – 90%)");
    for (const metric of RESULT_METRICS)
      expect(html).toContain(en[metric.titleKey].replace("|", "|"));
  });
});

describe("blinded study sessions", () => {
  it("play a locked plan as it is, without other games to add", () => {
    const plan: SessionPlan = {
      games: [
        {
          game_id: "grip_hold",
          trials: 10,
          minutes: 4,
          reason_key: "keep_practising",
          reason_params: {},
        },
        {
          game_id: "bloom",
          trials: 10,
          minutes: 4,
          reason_key: "keep_practising",
          reason_params: {},
        },
      ],
      total_minutes: 8,
      focus: { movements: [], directions: [] },
      notes: [],
      locked: true,
      version: 1,
      created_at: null,
    };
    expect(planRows(plan, ["reach_activate", "grip_hold", "bloom"])).toEqual([
      { id: "grip_hold", selected: true },
      { id: "bloom", selected: true },
    ]);
    const open = planRows({ ...plan, locked: false }, ["reach_activate", "grip_hold", "bloom"]);
    expect(open).toContainEqual({ id: "reach_activate", selected: false });
  });
});

describe("research consent", () => {
  it("defaults to today's date in the browser's time zone", () => {
    expect(todayIso(new Date("2026-11-14T10:00:00Z"))).toMatch(/^2026-11-1[45]$/);
  });
});
