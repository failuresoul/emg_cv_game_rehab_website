import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import type { MetricChange } from "@/types/api";

import { MdcSourceBadge } from "./MetricsSection";

const row = (overrides: Partial<MetricChange>): MetricChange => ({
  metric_id: "K1",
  game_id: null,
  name: "Reach area",
  unit: "sw2",
  better_when: "higher",
  baseline: 1,
  latest: 1.5,
  change: 0.5,
  change_mdc: 0.8,
  status: "no_detectable_change",
  mdc: 0.6,
  provisional: false,
  n_sessions: 3,
  ...overrides,
});

describe("the MDC source badge", () => {
  it("says measured (n=1, pilot) with the visits in its tooltip", () => {
    const html = renderToStaticMarkup(
      <MdcSourceBadge
        row={row({
          mdc_source: "measured",
          mdc_participants: 1,
          mdc_visits: 3,
          mdc_generated_at: "2026-11-17T10:00:00Z",
        })}
      />,
    );
    expect(html).toContain(en["adminMetrics.mdc.measured"].replace("{n}", "1"));
    expect(html).toContain("3 repeatability visits of 1 participant");
    expect(html).toContain('title="');
  });

  it("says provisional with its own tooltip", () => {
    const html = renderToStaticMarkup(
      <MdcSourceBadge row={row({ mdc_source: "provisional", provisional: true })} />,
    );
    expect(html).toContain(en["adminMetrics.mdc.provisional"]);
    expect(html).toContain(en["adminMetrics.mdc.provisionalTip"]);
  });

  it("shows nothing for a measure without an MDC (or from an older server)", () => {
    expect(renderToStaticMarkup(<MdcSourceBadge row={row({ mdc_source: null })} />)).toBe("");
    expect(renderToStaticMarkup(<MdcSourceBadge row={row({})} />)).toBe("");
  });
});
