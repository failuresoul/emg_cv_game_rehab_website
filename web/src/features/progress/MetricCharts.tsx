import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  chartScale,
  chartSeries,
  formatMetricValue,
  PATIENT_CHART_IDS,
  PATIENT_CHARTS,
  seriesPoints,
} from "@/features/metrics/metricDisplay";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { t } from "@/i18n";
import { formatShortDate } from "@/lib/format";

import { usePatientMetricSeries } from "./hooks";

/**
 * The patient's measures over their sessions, in plain words: what each one shows and which
 * way is better. No codes and no statistics: those are for the therapist.
 */
export function MetricCharts() {
  const series = usePatientMetricSeries(PATIENT_CHART_IDS);
  if (series.isPending) return <Skeleton className="h-80 rounded-xl" />;
  if (series.isError) {
    return (
      <Card>
        <QueryError onRetry={() => void series.refetch()} />
      </Card>
    );
  }
  return (
    <section aria-labelledby="my-measures" className="flex flex-col gap-4">
      <h2 id="my-measures" className="text-xl font-bold">
        {t("progress.metric.title")}
      </h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {PATIENT_CHARTS.map((chart) => {
          const found = chartSeries(series.data, chart);
          const unit = found?.unit ?? "";
          const scale = chartScale(unit);
          return (
            <Card key={chart.metricId}>
              <h3 className="text-xl font-bold">{t(chart.titleKey)}</h3>
              <p className="text-muted mb-2">{t(chart.hintKey)}</p>
              <ProgressChart
                points={seriesPoints(found, formatShortDate, scale)}
                seriesName={t(chart.titleKey)}
                emptyTitle={t("progress.metric.empty")}
                formatValue={(value) => {
                  const worded = formatMetricValue(unit, value / scale);
                  return t(worded.key, worded.params);
                }}
              />
            </Card>
          );
        })}
      </div>
    </section>
  );
}
