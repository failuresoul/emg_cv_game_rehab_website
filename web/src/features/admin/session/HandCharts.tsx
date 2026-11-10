import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { FINGER_LABEL_KEYS, fingerTallies, opennessSeries } from "@/features/games/results";
import { t } from "@/i18n";
import type { GameRunDetail } from "@/types/api";

const PRIMARY = "var(--color-primary)";
const INK = "var(--color-ink)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 16;
const PERCENT_TICKS = [0, 25, 50, 75, 100];

/**
 * Bloom: each turn's peak openness, with the openness it asked for as a dashed line. The demand
 * can change from turn to turn, so it is a series rather than a single reference line.
 */
export function OpennessChart({ run }: { run: GameRunDetail }) {
  const data = opennessSeries(run.trials);
  if (!data.some((point) => point.peak !== null)) return null;
  return (
    <figure>
      <figcaption className="mb-2 font-semibold">{t("adminSession.opennessChart")}</figcaption>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            accessibilityLayer
            margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
            <XAxis
              dataKey="trialNo"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[0, 100]}
              ticks={PERCENT_TICKS}
              width={56}
              unit="%"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(trialNo) => t("adminSession.chartTrial", { n: String(trialNo) })}
              formatter={(value, name) => [t("measure.percent", { value: Number(value) }), name]}
            />
            <Legend wrapperStyle={{ color: INK }} />
            <Line
              type="linear"
              dataKey="peak"
              name={t("adminSession.series.peakOpenness")}
              stroke={PRIMARY}
              strokeWidth={2}
              dot={{ r: 4, fill: PRIMARY }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="demand"
              name={t("adminSession.series.openDemand")}
              stroke={INK}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

interface FingerBar {
  finger: string;
  rate: number;
  hits: number;
  attempts: number;
}

/** Finger piano: the share of each finger's notes played, over the whole run. */
export function FingerHitChart({ run }: { run: GameRunDetail }) {
  const data: FingerBar[] = fingerTallies(run.trials).map((tally) => ({
    finger: t(FINGER_LABEL_KEYS[tally.finger]),
    rate: Math.round((tally.hits / tally.attempts) * 100),
    hits: tally.hits,
    attempts: tally.attempts,
  }));
  if (data.length === 0) return null;
  return (
    <figure>
      <figcaption className="mb-2 font-semibold">{t("adminSession.fingerChart")}</figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            accessibilityLayer
            margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
            <XAxis
              dataKey="finger"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[0, 100]}
              ticks={PERCENT_TICKS}
              width={56}
              unit="%"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: MUTED, fillOpacity: 0.1 }}
              formatter={(value, _name, item) => {
                const bar = item.payload as FingerBar;
                const notes = t("adminSession.fingerTooltip", {
                  hits: bar.hits,
                  attempts: bar.attempts,
                });
                return [
                  `${t("measure.percent", { value: Number(value) })} (${notes})`,
                  t("adminSession.series.hitRate"),
                ];
              }}
            />
            <Bar dataKey="rate" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
