import type { ProgressPoint } from "@/features/patient/ProgressChart";
import type { TranslationKey } from "@/i18n";
import type { GameId, MetricBetterWhen, MetricSeries, MetricStatus, TrialRead } from "@/types/api";

/** Each catalogue measure's name (shared/metrics-catalog.json), via t(). */
export const METRIC_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  K1: "metric.K1",
  K5: "metric.K5",
  K6: "metric.K6",
  K7: "metric.K7",
  K8: "metric.K8",
  K9: "metric.K9",
  K10: "metric.K10",
  K12: "metric.K12",
  R1: "metric.R1",
  R2: "metric.R2",
  R3: "metric.R3",
  R4: "metric.R4",
  H1: "metric.H1",
  H2: "metric.H2",
  H3: "metric.H3",
  H4: "metric.H4",
  H5: "metric.H5",
  H6: "metric.H6",
  G1: "metric.G1",
  G2: "metric.G2",
  G3: "metric.G3",
  G4: "metric.G4",
  P1: "metric.P1",
  P2: "metric.P2",
  P3: "metric.P3",
};

/** The measure's name key, or null for an id this version of the app does not know. */
export function metricNameKey(metricId: string): TranslationKey | null {
  return METRIC_NAME_KEYS[metricId] ?? null;
}

export interface Worded {
  key: TranslationKey;
  params: { value: number | string };
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * A value in its unit, for reading: times in seconds, shares as percentages, scores and counts
 * as they are.
 */
export function formatMetricValue(unit: string, value: number): Worded {
  switch (unit) {
    case "ms":
      return { key: "metricUnit.seconds", params: { value: round(value / 1000, 2) } };
    case "share":
      return { key: "metricUnit.percent", params: { value: round(value * 100, 1) } };
    case "sw2":
      return { key: "metricUnit.sw2", params: { value: round(value, 2) } };
    case "sw_per_s":
      return { key: "metricUnit.swPerS", params: { value: round(value, 2) } };
    case "deg":
      return { key: "metricUnit.deg", params: { value: round(value, 1) } };
    case "palm_ratio":
      return { key: "metricUnit.palm", params: { value: round(value, 2) } };
    case "arm_ratio":
      return { key: "metricUnit.arm", params: { value: round(value, 2) } };
    case "min":
      return { key: "metricUnit.minutes", params: { value: round(value, 1) } };
    case "sparc":
      return { key: "metricUnit.number", params: { value: round(value, 2) } };
    default:
      return { key: "metricUnit.number", params: { value: round(value, 2) } };
  }
}

/** A change with its sign, such as "+0.4 SW²" or "−0.25 s". */
export function formatMetricChange(unit: string, change: number): Worded {
  const worded = formatMetricValue(unit, Math.abs(change));
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return { ...worded, params: { value: `${sign}${worded.params.value}` } };
}

export type StatusTone = "success" | "warning" | "muted";

/** How each status looks: improved green, worse amber, no change and no baseline grey. */
export const STATUS_STYLE: Readonly<
  Record<MetricStatus, { tone: StatusTone; labelKey: TranslationKey }>
> = {
  improved: { tone: "success", labelKey: "metricStatus.improved" },
  worse: { tone: "warning", labelKey: "metricStatus.worse" },
  no_detectable_change: { tone: "muted", labelKey: "metricStatus.noChange" },
  no_baseline: { tone: "muted", labelKey: "metricStatus.noBaseline" },
};

export const BETTER_WHEN_KEYS: Readonly<Record<MetricBetterWhen, TranslationKey>> = {
  higher: "metric.betterHigher",
  lower: "metric.betterLower",
  closer_to_zero: "metric.betterCloserToZero",
};

/** Chart points of a series, labelled with each session's date, values scaled for display. */
export function seriesPoints(
  series: MetricSeries | undefined,
  formatDate: (iso: string) => string,
  scale = 1,
  places = 2,
): ProgressPoint[] {
  return (series?.points ?? []).map((point) => ({
    label: formatDate(point.date),
    value: round(point.value * scale, places),
  }));
}

/** The value a unit is drawn with on a chart: seconds for times, percentages for shares. */
export function chartScale(unit: string): number {
  if (unit === "ms") return 1 / 1000;
  if (unit === "share") return 100;
  return 1;
}

/** A unique key for a measure of one game (or of the session). */
export function seriesKey(item: { metric_id: string; game_id: GameId | null }): string {
  return item.game_id ? `${item.metric_id}:${item.game_id}` : item.metric_id;
}

export type RunQuality = "ok" | "gaps" | "mismatches" | "pending";

/**
 * A game run's data quality, from its trials' server checks: mismatches (a server measure more
 * than 10% from the browser's) come before gaps (tracking gaps over 200 ms); pending until the
 * server has checked every trial.
 */
export function runQuality(trials: readonly Pick<TrialRead, "data_quality">[]): RunQuality {
  if (trials.length === 0 || trials.some((trial) => !trial.data_quality)) return "pending";
  if (trials.some((trial) => Object.keys(trial.data_quality?.mismatches ?? {}).length > 0)) {
    return "mismatches";
  }
  if (trials.some((trial) => (trial.data_quality?.gaps_over_200ms ?? 0) > 0)) return "gaps";
  return "ok";
}

export const RUN_QUALITY_STYLE: Readonly<
  Record<RunQuality, { tone: StatusTone; labelKey: TranslationKey }>
> = {
  ok: { tone: "success", labelKey: "dataQuality.ok" },
  gaps: { tone: "warning", labelKey: "dataQuality.gaps" },
  mismatches: { tone: "warning", labelKey: "dataQuality.mismatches" },
  pending: { tone: "muted", labelKey: "dataQuality.pending" },
};

/** The patient's progress charts, in plain words: no MDC, no measure codes. */
export interface PatientChart {
  metricId: string;
  /** The game to show for a per-game measure; the first one played if it has none. */
  game: GameId | null;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
}

export const PATIENT_CHARTS: readonly PatientChart[] = [
  {
    metricId: "K1",
    game: null,
    titleKey: "progress.metric.reachArea",
    hintKey: "progress.metric.higherBetter",
  },
  {
    metricId: "K6",
    game: "reach_activate",
    titleKey: "progress.metric.movementTime",
    hintKey: "progress.metric.lowerBetter",
  },
  {
    metricId: "K8",
    game: "reach_activate",
    titleKey: "progress.metric.smoothness",
    hintKey: "progress.metric.closerToZeroBetter",
  },
  {
    metricId: "G1",
    game: null,
    titleKey: "progress.metric.successRate",
    hintKey: "progress.metric.higherBetter",
  },
  {
    metricId: "H1",
    game: null,
    titleKey: "progress.metric.handOpening",
    hintKey: "progress.metric.higherBetter",
  },
];

export const PATIENT_CHART_IDS = [...new Set(PATIENT_CHARTS.map((chart) => chart.metricId))];

/** The series a chart shows: its own game's if played, otherwise the first game's. */
export function chartSeries(
  all: readonly MetricSeries[],
  chart: Pick<PatientChart, "metricId" | "game">,
): MetricSeries | undefined {
  const found = all.filter((series) => series.metric_id === chart.metricId);
  return found.find((series) => series.game_id === chart.game) ?? found[0];
}
