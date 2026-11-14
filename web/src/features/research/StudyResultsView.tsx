import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/i18n";
import type { StudyResults } from "@/types/api";

import {
  CONDITION_LABEL_KEYS,
  formatResult,
  RESULT_METRICS,
  type ResultBar,
  resultBars,
  type ResultMetric,
  useStudyResults,
} from "./studyModel";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const INK = "var(--color-ink)";
const AXIS_FONT_SIZE = 16;

function BarTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: { payload: ResultBar }[];
  metric: ResultMetric;
}) {
  const bar = payload?.[0]?.payload;
  if (!active || !bar) return null;
  return (
    <div className="bg-surface rounded-lg border border-black/10 px-3 py-2 shadow">
      <p className="font-semibold">{bar.label}</p>
      <p className="tabular-nums">{formatResult(metric, bar.mean)}</p>
      <p className="text-muted text-sm tabular-nums">
        {bar.ciLow !== null && bar.ciHigh !== null
          ? t("study.results.ci", {
              low: formatResult(metric, bar.ciLow),
              high: formatResult(metric, bar.ciHigh),
            })
          : t("study.results.noCi")}
        {" · "}
        {t("study.results.n", { n: bar.n })}
      </p>
    </div>
  );
}

/** One measure, one bar per condition with its 95% interval. */
function MetricChart({ results, metric }: { results: StudyResults; metric: ResultMetric }) {
  const bars = resultBars(results, metric);
  const empty = bars.every((bar) => bar.mean === null);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption>
        <span className="block font-semibold">{t(metric.titleKey)}</span>
        <span className="text-muted block text-sm">{t(metric.hintKey)}</span>
      </figcaption>
      {empty ? (
        <p className="text-muted">{t("study.results.noData")}</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bars}
              accessibilityLayer
              margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
              <XAxis
                dataKey="label"
                tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
                tickLine={false}
              />
              <YAxis
                width={52}
                domain={metric.domain ?? [0, "auto"]}
                tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatResult(metric, value)}
              />
              <Tooltip
                cursor={{ fill: MUTED, fillOpacity: 0.08 }}
                content={<BarTooltip metric={metric} />}
              />
              <Bar
                dataKey="mean"
                name={t(metric.titleKey)}
                fill={PRIMARY}
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
              >
                <ErrorBar dataKey="error" width={10} strokeWidth={2} stroke={INK} direction="y" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

/** The same numbers as a table, for screen readers and copying into the paper. */
function ResultsTable({ results }: { results: StudyResults }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="sr-only">{t("study.results.tableCaption")}</caption>
        <thead>
          <tr className="border-b border-black/10">
            <th scope="col" className="px-3 py-2">
              {t("study.results.measure")}
            </th>
            {results.conditions.map((condition) => (
              <th key={condition.condition} scope="col" className="px-3 py-2">
                {t(CONDITION_LABEL_KEYS[condition.condition])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          <tr>
            <th scope="row" className="px-3 py-2 font-medium">
              {t("study.results.counts")}
            </th>
            {results.conditions.map((condition) => (
              <td key={condition.condition} className="px-3 py-2 tabular-nums">
                {t("study.results.countsValue", {
                  participants: condition.participants,
                  sessions: condition.sessions,
                  trials: condition.trials,
                })}
              </td>
            ))}
          </tr>
          {RESULT_METRICS.map((metric) => (
            <tr key={metric.key}>
              <th scope="row" className="px-3 py-2 font-medium">
                {t(metric.titleKey)}
              </th>
              {resultBars(results, metric).map((bar) => (
                <td key={bar.condition} className="px-3 py-2 tabular-nums">
                  {formatResult(metric, bar.mean)}
                  {bar.ciLow !== null && bar.ciHigh !== null && (
                    <span className="text-muted">
                      {" "}
                      ({formatResult(metric, bar.ciLow)} – {formatResult(metric, bar.ciHigh)})
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StudyResultsCharts({ results }: { results: StudyResults }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
        {RESULT_METRICS.map((metric) => (
          <MetricChart key={metric.key} results={results} metric={metric} />
        ))}
      </div>
      <ResultsTable results={results} />
    </div>
  );
}

export function StudyResultsView({ studyId }: { studyId: number }) {
  const results = useStudyResults(studyId);
  if (results.isPending) return <Skeleton className="h-64" />;
  if (results.isError) return <QueryError onRetry={() => void results.refetch()} />;
  if (results.data.conditions.every((condition) => condition.trials === 0)) {
    return <EmptyState icon={BarChart3} title={t("study.results.empty")} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t("study.results.intro")}</p>
      <StudyResultsCharts results={results.data} />
    </div>
  );
}
