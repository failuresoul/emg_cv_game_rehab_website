import { LineChart as LineChartIcon, Table as TableIcon, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { t } from "@/i18n";
import { formatPlain } from "@/lib/format";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 18;
const CHART_MARGIN = { top: 12, right: 12, bottom: 8, left: 0 };

const HEIGHTS = { sm: "h-48", md: "h-64", lg: "h-80" } as const;

export interface ProgressPoint {
  label: string;
  value: number;
}

interface ProgressChartProps {
  points: ProgressPoint[];
  seriesName: string;
  emptyTitle: string;
  size?: keyof typeof HEIGHTS;
  /** Formats values in the tooltip and on the y-axis, such as 80 as "80%". */
  formatValue?: (value: number) => string;
  /** Fixed y-axis range, such as [0, 100] for percentages. */
  yDomain?: [number, number];
  allowDecimals?: boolean;
  /** A dashed horizontal line, such as the patient's baseline, with its label. */
  reference?: { value: number; label: string };
}

export function ProgressChart({
  points,
  seriesName,
  emptyTitle,
  size = "md",
  formatValue,
  yDomain,
  allowDecimals = true,
  reference,
}: ProgressChartProps) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  if (points.length === 0) {
    return <EmptyState icon={TrendingUp} title={emptyTitle} />;
  }
  const show = formatValue ?? ((value: number) => formatPlain(value));
  const last = points[points.length - 1]!;
  // What the chart shows, for screen readers: the series, how many points, the latest value.
  const summary = t("chart.summary", {
    series: seriesName,
    n: points.length,
    latest: show(last.value),
    when: last.label,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          aria-pressed={asTable}
          aria-controls={tableId}
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? <LineChartIcon size={20} aria-hidden /> : <TableIcon size={20} aria-hidden />}
          {t(asTable ? "chart.viewChart" : "chart.viewTable")}
        </Button>
      </div>
      {asTable ? (
        <div id={tableId} className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{seriesName}</caption>
            <thead>
              <tr className="border-b border-black/10">
                <th scope="col" className="px-3 py-2">
                  {t("chart.column.when")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {seriesName}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {points.map((point, index) => (
                <tr key={`${point.label}-${index}`}>
                  <td className="px-3 py-2">{point.label}</td>
                  <td className="px-3 py-2 tabular-nums">{show(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ChartBody
          id={tableId}
          summary={summary}
          size={size}
          points={points}
          seriesName={seriesName}
          formatValue={formatValue}
          yDomain={yDomain}
          allowDecimals={allowDecimals}
          reference={reference}
        />
      )}
    </div>
  );
}

function ChartBody({
  id,
  summary,
  points,
  seriesName,
  size = "md",
  formatValue,
  yDomain,
  allowDecimals = true,
  reference,
}: Omit<ProgressChartProps, "emptyTitle"> & { id: string; summary: string }) {
  return (
    <div id={id} role="img" aria-label={summary} className={HEIGHTS[size]}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} accessibilityLayer margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis
            dataKey="label"
            tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
            tickLine={false}
            tickMargin={10}
            padding={{ left: 20, right: 20 }}
            minTickGap={16}
          />
          <YAxis
            width={56}
            tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
            tickLine={false}
            axisLine={false}
            domain={yDomain}
            allowDecimals={allowDecimals}
            tickFormatter={formatValue ?? ((value: number) => formatPlain(value))}
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? (formatValue ?? formatPlain)(value) : String(value)
            }
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke="var(--color-ink)"
              strokeDasharray="6 4"
              strokeWidth={2}
              ifOverflow="extendDomain"
              label={{
                value: reference.label,
                position: "insideTopLeft",
                fill: "var(--color-ink)",
                fontSize: 16,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            name={seriesName}
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 4, fill: PRIMARY }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
