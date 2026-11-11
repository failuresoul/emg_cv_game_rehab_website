import { Gauge } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { metricLabel } from "@/features/admin/MetricsSection";
import { formatMetricValue, seriesKey } from "@/features/metrics/metricDisplay";
import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { SessionMetricRow } from "@/types/api";

/** The session's catalogue measures, as the server stored them when the session ended. */
export function SessionMetricsCard({ rows }: { rows: readonly SessionMetricRow[] }) {
  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-2 text-xl font-bold">{t("adminSession.sessionMetricsTitle")}</h2>
      {rows.length === 0 ? (
        <EmptyState icon={Gauge} title={t("adminSession.sessionMetricsEmpty")} />
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const worded = formatMetricValue(row.unit, row.value);
            return (
              <div key={seriesKey(row)} className="flex flex-col">
                <dt className="text-muted">{metricLabel({ ...row, name: row.metric_id })}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {t(worded.key, worded.params)}
                  <span className="text-muted ml-2 text-base font-normal">
                    {t("adminSession.sessionMetricsCount", { n: formatNumber(row.n, 0) })}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Card>
  );
}
