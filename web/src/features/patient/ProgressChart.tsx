import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/ui/EmptyState";

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
}

export function ProgressChart({
  points,
  seriesName,
  emptyTitle,
  size = "md",
  formatValue,
  yDomain,
  allowDecimals = true,
}: ProgressChartProps) {
  if (points.length === 0) {
    return <EmptyState icon={TrendingUp} title={emptyTitle} />;
  }

  return (
    <div className={HEIGHTS[size]}>
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
            tickFormatter={formatValue}
          />
          <Tooltip
            formatter={(value) =>
              formatValue && typeof value === "number" ? formatValue(value) : String(value)
            }
          />
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
