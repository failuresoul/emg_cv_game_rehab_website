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
import { t } from "@/i18n";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 18;

export interface ProgressPoint {
  label: string;
  value: number;
}

export function ProgressChart({ points }: { points: ProgressPoint[] }) {
  if (points.length === 0) {
    return <EmptyState icon={TrendingUp} title={t("patient.progress.empty")} />;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis
            dataKey="label"
            tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
            tickLine={false}
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
            name={t("patient.progress.title")}
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
