import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  chartScale,
  chartSeries,
  formatMetricValue,
  seriesPoints,
} from "@/features/metrics/metricDisplay";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { t, type TranslationKey } from "@/i18n";
import { formatDate } from "@/lib/format";
import type { GameId, MetricSeries } from "@/types/api";

import { useAdminPatientMetrics } from "./hooks";

/** The muscle-sensor trends: MVC, onset latency, relaxation time and grip steadiness. */
export const EMG_TREND_CHARTS: readonly {
  metricId: string;
  game: GameId | null;
  titleKey: TranslationKey;
}[] = [
  { metricId: "E2", game: null, titleKey: "metric.E2" },
  { metricId: "E5", game: "grip_hold", titleKey: "metric.E5" },
  { metricId: "E6", game: "grip_hold", titleKey: "metric.E6" },
  { metricId: "E8", game: "grip_hold", titleKey: "metric.E8" },
];

/** True when any session of the patient has a muscle-sensor measure. */
export function hasEmgSeries(series: readonly MetricSeries[]): boolean {
  return series.some((item) => item.metric_id.startsWith("E") && item.points.length > 0);
}

/** The admin Progress tab's muscle-sensor trends; hidden for patients who never used it. */
export function EmgTrendsSection({ patientId }: { patientId: number }) {
  const metrics = useAdminPatientMetrics(patientId);
  if (metrics.isPending) return <Skeleton className="h-64" />;
  if (metrics.isError) return <QueryError onRetry={() => void metrics.refetch()} />;
  const all = metrics.data.series;
  if (!hasEmgSeries(all)) return null;

  return (
    <section aria-labelledby="emg-trends" className="flex flex-col gap-4">
      <h2 id="emg-trends" className="text-xl font-bold">
        {t("adminProgress.emgTitle")}
      </h2>
      <p className="text-muted">{t("adminProgress.emgHint")}</p>
      <div className="grid gap-6 2xl:grid-cols-2">
        {EMG_TREND_CHARTS.map((chart) => {
          const series = chartSeries(all, chart);
          const unit = series?.unit ?? "ms";
          const scale = chartScale(unit);
          const format = (value: number) => {
            const worded = formatMetricValue(unit, value / scale);
            return t(worded.key, worded.params);
          };
          return (
            <div key={chart.metricId}>
              <h3 className="mb-2 text-lg font-semibold">{t(chart.titleKey)}</h3>
              <ProgressChart
                points={seriesPoints(series, formatDate, scale)}
                seriesName={t(chart.titleKey)}
                emptyTitle={t("adminProgress.emgEmpty")}
                formatValue={format}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
