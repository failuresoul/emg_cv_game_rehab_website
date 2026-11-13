import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import type { BlindItem, BlindItemSummary } from "@/types/api";

import { FactsSheet } from "./FactsSheet";
import { nextUnrated } from "./hooks";
import { BlindItemView } from "./RaterView";
import { DIMENSIONS, RUBRIC, RubricForm } from "./RubricForm";

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>,
  );
}

const ITEM: BlindItem = {
  code: "K7MRA",
  position: 3,
  total: 8,
  facts: {
    session_no: 9,
    baseline_available: true,
    metrics: [
      {
        id: "K6",
        game_id: "reach_activate",
        name: "Movement time",
        value: 1180,
        baseline: 1420,
        unit: "ms",
        change_mdc: 1.6,
        mdc_status: "improved",
      },
    ],
    flags: { compensation_rate: 0.12, fatigue_flag: false, hand_loss_pct: 4 },
    self_report: { pain_0_10: 1, fatigue_0_10: 4, enjoyment_1_5: 5 },
    safety_notice_present: false,
  },
  safety_notices: [],
  report: {
    language: "en",
    patient_summary: "You reached targets faster <b>today</b>.",
    highlights: [],
    suggestions: [{ id: "CELEBRATE_PROGRESS", text: "Well done." }],
    next_session_text: "More reaching.",
  },
  my_rating: null,
};

describe("the blind rater view", () => {
  it("shows the code, the report and the facts sheet, and nothing about the version", () => {
    const html = render(<BlindItemView item={ITEM} rubric={null} />);
    expect(html).toContain("Report K7MRA (3 of 8)");
    expect(html).toContain("You reached targets faster &lt;b&gt;today&lt;/b&gt;.");
    expect(html).toContain("Movement time");
    expect(html).toContain("1420");
    expect(html).toContain("1180");
    expect(html).toContain("improved");
    for (const word of ["llm", "template", "fallback", "model", "qwen"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it("lists the facts sheet's numbers", () => {
    const html = render(<FactsSheet facts={ITEM.facts} />);
    expect(html).toContain("K6 Movement time (reach_activate)");
    expect(html).toContain("pain 1/10, fatigue 4/10, enjoyment 5/5");
    expect(html).toContain("compensation 0.12");
  });

  it("asks every dimension 1-5 with anchors, unsafe and unsupported sentences", () => {
    const html = render(
      <RubricForm code="K7MRA" pending={false} error={null} onSubmit={() => {}} />,
    );
    for (const dimension of DIMENSIONS) {
      const { name, anchors } = RUBRIC[dimension];
      expect(html).toContain(en[name]);
      for (const anchor of anchors) expect(html).toContain(en[anchor]);
      expect(html.match(new RegExp(`name="K7MRA-${dimension}"`, "g"))).toHaveLength(5);
    }
    expect(html).toContain(en["review.unsafe"]);
    expect(html.match(/name="K7MRA-unsafe"/g)).toHaveLength(2);
    expect(html).toContain(en["review.unsupported"]);
  });
});

describe("the next report to rate", () => {
  const items: BlindItemSummary[] = [
    { code: "AAAAA", position: 1, rated_by_me: true },
    { code: "CCCCC", position: 2, rated_by_me: false },
    { code: "DDDDD", position: 3, rated_by_me: true },
    { code: "EEEEE", position: 4, rated_by_me: false },
  ];

  it("is the first unrated one after the current one, then from the start", () => {
    expect(nextUnrated(items, null)).toBe("CCCCC");
    expect(nextUnrated(items, "CCCCC")).toBe("EEEEE");
    expect(nextUnrated(items, "EEEEE")).toBe("CCCCC");
    expect(
      nextUnrated(
        items.map((item) => ({ ...item, rated_by_me: true })),
        null,
      ),
    ).toBeNull();
  });
});
