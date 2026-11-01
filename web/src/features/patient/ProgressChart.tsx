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

export interface ProgressPoint {
  label: string;
  value: number;
}

interface ProgressChartProps {
  points: ProgressPoint[];
  seriesName: string;
  emptyTitle: string;
}

export function ProgressChart({ points, seriesName, emptyTitle }: ProgressChartProps) {
  if (points.length === 0) {
    return <EmptyState icon={TrendingUp} title={emptyTitle} />;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} accessibilityLayer margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis
            dataKey="label"
            tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
            tickLine={false}
            tickMargin={10}
            padding={{ left: 20, right: 20 }}
          />
          <YAxis
            width={48}
            tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip />
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
