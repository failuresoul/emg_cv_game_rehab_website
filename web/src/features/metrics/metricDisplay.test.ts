import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import type { MetricSeries, TrialDataQuality } from "@/types/api";

import {
  chartScale,
  chartSeries,
  formatMetricChange,
  formatMetricValue,
  METRIC_NAME_KEYS,
  metricNameKey,
  PATIENT_CHART_IDS,
  PATIENT_CHARTS,
  runQuality,
  seriesKey,
  seriesPoints,
  STATUS_STYLE,
} from "./metricDisplay";

const CATALOGUE_IDS = [
  ...["K1", "K5", "K6", "K7", "K8", "K9", "K10", "K12"],
  ...["R1", "R2", "R3", "R4", "H1", "H2", "H3", "H4", "H5", "H6"],
  ...["G1", "G2", "G3", "G4", "P1", "P2", "P3"],
  ...["E2", "E3", "E5", "E6", "E8", "E9"],
];

function series(metricId: string, gameId: MetricSeries["game_id"], values: number[]): MetricSeries {
  return {
    metric_id: metricId,
    game_id: gameId,
    name: metricId,
    unit: "ms",
    better_when: "lower",
    points: values.map((value, index) => ({
      session_id: index + 1,
      date: `2026-11-0${index + 1}T10:00:00Z`,
      value,
    })),
  };
}

function quality(changes: Partial<TrialDataQuality> = {}): TrialDataQuality {
  return {
    engine_version: 1,
    n_points: 40,
    sampling_hz: 30,
    gaps_over_200ms: 0,
    max_gap_ms: 34,
    source: "trajectory",
    mismatches: {},
    ...changes,
  };
}

describe("metric names", () => {
  it("has a translated name for every catalogue measure", () => {
    expect(Object.keys(METRIC_NAME_KEYS).sort()).toEqual([...CATALOGUE_IDS].sort());
    for (const id of CATALOGUE_IDS) {
      const key = metricNameKey(id);
      expect(key && key in en).toBe(true);
    }
    expect(metricNameKey("Z9")).toBeNull();
  });
});

describe("formatMetricValue", () => {
  it("words each unit for reading", () => {
    expect(formatMetricValue("ms", 1234)).toEqual({
      key: "metricUnit.seconds",
      params: { value: 1.23 },
    });
    expect(formatMetricValue("share", 0.8567).params.value).toBe(85.7);
    expect(formatMetricValue("sw2", 1.456).key).toBe("metricUnit.sw2");
    expect(formatMetricValue("deg", 112.34).params.value).toBe(112.3);
    expect(formatMetricValue("sparc", -1.6234)).toEqual({
      key: "metricUnit.number",
      params: { value: -1.62 },
    });
    expect(formatMetricValue("min", 17.25).key).toBe("metricUnit.minutes");
    expect(formatMetricValue("palm_ratio", 0.55).key).toBe("metricUnit.palm");
    expect(formatMetricValue("arm_ratio", 0.8).key).toBe("metricUnit.arm");
    expect(formatMetricValue("sw_per_s", 1.2).key).toBe("metricUnit.swPerS");
    expect(formatMetricValue("count", 3).key).toBe("metricUnit.number");
  });

  it("puts a sign on changes", () => {
    expect(formatMetricChange("ms", -250).params.value).toBe("−0.25");
    expect(formatMetricChange("sw2", 0.4).params.value).toBe("+0.4");
    expect(formatMetricChange("deg", 0).params.value).toBe("0");
  });
});

describe("statuses", () => {
  it("colours improved green, worse amber and the rest grey", () => {
    expect(STATUS_STYLE.improved.tone).toBe("success");
    expect(STATUS_STYLE.worse.tone).toBe("warning");
    expect(STATUS_STYLE.no_detectable_change.tone).toBe("muted");
    expect(STATUS_STYLE.no_baseline.tone).toBe("muted");
  });
});

describe("series", () => {
  it("labels each point with its date and scales it", () => {
    const points = seriesPoints(
      series("K6", "reach_activate", [1234, 1100]),
      (iso) => iso.slice(5, 10),
      1 / 1000,
    );
    expect(points).toEqual([
      { label: "11-01", value: 1.23 },
      { label: "11-02", value: 1.1 },
    ]);
    expect(seriesPoints(undefined, String)).toEqual([]);
    expect([chartScale("ms"), chartScale("share"), chartScale("deg")]).toEqual([0.001, 100, 1]);
  });

  it("keys a measure by its game", () => {
    expect(seriesKey({ metric_id: "K6", game_id: "bloom" })).toBe("K6:bloom");
    expect(seriesKey({ metric_id: "K1", game_id: null })).toBe("K1");
  });
});

describe("patient charts", () => {
  it("shows reach area, movement time, smoothness, success rate and hand opening", () => {
    expect(PATIENT_CHART_IDS).toEqual(["K1", "K6", "K8", "G1", "H1"]);
    for (const chart of PATIENT_CHARTS) {
      expect(chart.titleKey in en && chart.hintKey in en).toBe(true);
      // No measure codes or MDC in what patients read.
      expect(en[chart.titleKey]).not.toMatch(/MDC|K\d|SPARC/);
    }
  });

  it("prefers the chart's own game, then any game played", () => {
    const all = [
      series("K6", "balloon_pop", [1]),
      series("K6", "reach_activate", [2]),
      series("K8", "pick_place", [3]),
    ];
    expect(chartSeries(all, { metricId: "K6", game: "reach_activate" })?.game_id).toBe(
      "reach_activate",
    );
    expect(chartSeries(all, { metricId: "K8", game: "reach_activate" })?.game_id).toBe(
      "pick_place",
    );
    expect(chartSeries(all, { metricId: "H1", game: null })).toBeUndefined();
  });
});

describe("runQuality", () => {
  it("is pending until every trial is checked", () => {
    expect(runQuality([])).toBe("pending");
    expect(runQuality([{ data_quality: quality() }, { data_quality: null }])).toBe("pending");
  });

  it("puts mismatches before gaps", () => {
    expect(runQuality([{ data_quality: quality() }])).toBe("ok");
    expect(runQuality([{ data_quality: quality({ gaps_over_200ms: 2 }) }])).toBe("gaps");
    const mismatch = quality({
      gaps_over_200ms: 1,
      mismatches: { sparc: { client: -1.5, server: -2 } },
    });
    expect(runQuality([{ data_quality: quality() }, { data_quality: mismatch }])).toBe(
      "mismatches",
    );
  });
});
