import { Info } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  BETTER_WHEN_KEYS,
  chartScale,
  formatMetricChange,
  formatMetricValue,
  metricNameKey,
  seriesKey,
  seriesPoints,
  STATUS_STYLE,
} from "@/features/metrics/metricDisplay";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { GAMES, isGameId } from "@/games/shared/registry";
import { t } from "@/i18n";
import { formatDate, formatNumber } from "@/lib/format";
import type { GameId, MetricChange, PatientMetrics } from "@/types/api";

import { useAdminPatientMetrics } from "./hooks";

const dash = "–";

/** "Movement time (Reach and squeeze)": the measure, and its game for trial measures. */
export function metricLabel(item: { metric_id: string; game_id: GameId | null; name: string }) {
  const key = metricNameKey(item.metric_id);
  const name = key ? t(key) : item.name;
  if (!item.game_id || !isGameId(item.game_id)) return name;
  return t("adminMetrics.game", { name, game: t(GAMES[item.game_id].nameKey) });
}

function valueText(unit: string, value: number | null): string {
  if (value === null) return dash;
  const worded = formatMetricValue(unit, value);
  return t(worded.key, worded.params);
}

function changeText(unit: string, change: number | null): string {
  if (change === null) return dash;
  const worded = formatMetricChange(unit, change);
  return t(worded.key, worded.params);
}

function MetricsTable({ rows }: { rows: MetricChange[] }) {
  const columns = [
    "adminMetrics.column.metric",
    "adminMetrics.column.baseline",
    "adminMetrics.column.latest",
    "adminMetrics.column.change",
    "adminMetrics.column.changeMdc",
    "adminMetrics.column.status",
    "adminMetrics.column.sessions",
  ] as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {columns.map((key) => (
              <th
                key={key}
                scope="col"
                className="text-muted px-3 py-2 font-semibold whitespace-nowrap"
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map((row) => {
            const style = STATUS_STYLE[row.status];
            return (
              <tr key={seriesKey(row)}>
                <th scope="row" className="px-3 py-2 font-semibold">
                  {metricLabel(row)}
                  <span className="text-muted block text-base font-normal">
                    {t(BETTER_WHEN_KEYS[row.better_when])}
                  </span>
                </th>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {valueText(row.unit, row.baseline)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {valueText(row.unit, row.latest)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {changeText(row.unit, row.change)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {row.change_mdc === null ? dash : formatNumber(row.change_mdc, 2)}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={style.tone}>{t(style.labelKey)}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{formatNumber(row.n_sessions, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The patient's catalogue measures: each one's latest session against the baseline, with the
 * provisional-MDC note, and the chosen measure's series with its baseline dashed.
 */
export function MetricsSection({ patientId }: { patientId: number }) {
  const metrics = useAdminPatientMetrics(patientId);
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <section aria-labelledby="patient-metrics" className="flex flex-col gap-4">
      <h2 id="patient-metrics" className="text-xl font-bold">
        {t("adminMetrics.title")}
      </h2>
      <p className="text-muted">{t("adminMetrics.intro")}</p>
      {metrics.isPending && <Skeleton className="h-64" />}
      {metrics.isError && <QueryError onRetry={() => void metrics.refetch()} />}
      {metrics.isSuccess && metrics.data.metrics.length === 0 && (
        <EmptyState title={t("adminMetrics.empty")} />
      )}
      {metrics.isSuccess && metrics.data.metrics.length > 0 && (
        <MetricsBody data={metrics.data} chosen={chosen} onChoose={setChosen} />
      )}
    </section>
  );
}

function MetricsBody({
  data,
  chosen,
  onChoose,
}: {
  data: PatientMetrics;
  chosen: string | null;
  onChoose: (key: string) => void;
}) {
  const current = chosen ?? seriesKey(data.metrics[0]);
  const row = data.metrics.find((item) => seriesKey(item) === current) ?? data.metrics[0];
  const series = data.series.find((item) => seriesKey(item) === seriesKey(row));
  const scale = chartScale(row.unit);
  const format = (value: number) => valueText(row.unit, value / scale);

  return (
    <>
      {data.mdc_provisional && (
        <p className="bg-warning/10 flex items-start gap-2 rounded-lg p-3">
          <Info size={22} aria-hidden className="mt-0.5 shrink-0" />
          {t("adminMetrics.provisional")}
        </p>
      )}
      <MetricsTable rows={data.metrics} />
      <div className="flex flex-col gap-3">
        <div className="max-w-md">
          <Select
            label={t("adminMetrics.picker")}
            value={seriesKey(row)}
            onChange={(event) => onChoose(event.target.value)}
            options={data.metrics.map((item) => ({
              value: seriesKey(item),
              label: metricLabel(item),
            }))}
          />
        </div>
        <ProgressChart
          points={seriesPoints(series, formatDate, scale)}
          seriesName={t("adminMetrics.series")}
          emptyTitle={t("adminMetrics.empty")}
          formatValue={format}
          reference={
            row.baseline === null
              ? undefined
              : {
                  value: Math.round(row.baseline * scale * 100) / 100,
                  label: t("adminMetrics.baselineLine", {
                    value: valueText(row.unit, row.baseline),
                  }),
                }
          }
        />
      </div>
    </>
  );
}
